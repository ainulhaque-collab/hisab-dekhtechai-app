import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { decodeBackup, encodeBackup } from '../storage/backup';
import { buildExpenseJournal, buildIncomeJournal, generateUUID } from '../domain/journal';
import { BalancedJournal, SyncOperation } from '../contracts/types';
import { SyncOrchestrator } from '../sync/orchestrator';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import { financialFingerprint } from '../sync/cloudBackup';
import { computeOwnerSubjectHash } from '../auth/googleAuth';

const workspaceId = 'ws-personal-default';

async function database() {
  const driver = new LocalStorageFallbackDriver();
  const key = `savings-${generateUUID()}`;
  const db = new LocalDatabase(key, driver);
  await db.init();
  return { db, driver, key };
}

async function fundedDatabase() {
  const result = await database();
  const account = result.db.createAccount(workspaceId, 'Synthetic savings cash', 'cash', '10000');
  await result.db.waitForPendingWrites();
  return { ...result, account };
}

async function replica(source: LocalDatabase) {
  const result = await database();
  await result.db.loadFromSerializable(structuredClone(source.toSerializable()));
  result.db.setDeviceIdentity(generateUUID(), 'Synthetic second device');
  await result.db.persist();
  return result;
}

async function replay(db: LocalDatabase, operations: SyncOperation[]) {
  const sync = new SyncOrchestrator(db, new SimulatedGoogleDriveTransport());
  const groups = new Map<string, SyncOperation[]>();
  for (const operation of operations) {
    const records = groups.get(operation.deviceId) || [];
    records.push(structuredClone(operation));
    groups.set(operation.deviceId, records);
  }
  for (const [deviceId, records] of groups) {
    records.sort((a, b) => a.seq - b.seq);
    await sync.applyBatchOperations({ protocolVersion: 1, ownerHash: records[0].ownerHash,
      deviceId, batchId: generateUUID(), fromSeq: records[0].seq, toSeq: records.at(-1)!.seq,
      operations: records, batchSha256: '', byteLength: 0, createdAtUtc: new Date().toISOString() });
  }
}

function savingsOperations(db: LocalDatabase) {
  return Array.from(db.getRawState().syncOperations.values()).filter(op => op.payload.savingsEvent);
}

function allocationId(db: LocalDatabase, goalId: string): string {
  const event = savingsOperations(db).map(op => op.payload.savingsEvent)
    .find(event => event.action === 'allocation.add' && event.goalId === goalId);
  assert.ok(event, 'A saved allocation must have a retained immutable event');
  return event.allocationId;
}

async function post(db: LocalDatabase, journal: BalancedJournal) {
  const payload = { balancedJournal: journal };
  await db.commitJournalWithOutbox(journal, { protocolVersion: 1,
    ownerHash: db.getIdentity()?.ownerSubjectHash || 'local-owner', deviceId: db.getDeviceId(),
    seq: db.getNextDeviceSeq(), operationId: journal.transaction.createdOpId,
    entityId: journal.transaction.id, type: 'journal.post', payload,
    createdAtUtc: new Date().toISOString(), contentSha256: await computeSha256(canonicalJson(payload)) });
}

test('Savings earmarks preserve schema 5, journals, balances and existing operation IDs', async () => {
  const { db, account } = await fundedDatabase();
  await post(db, buildIncomeJournal({ workspaceId, assetAccountId: account.id,
    revenueCategoryId: 'cat-salary', amountMinor: '2500', effectiveDate: '2026-10-27', opId: generateUUID() }));
  const before = structuredClone(db.toSerializable());
  const balances = canonicalJson(db.calculateAccountSummaries(workspaceId));
  const goal = await db.saveSavingsGoal(workspaceId, { name: 'Synthetic car goal', kind: 'general', targetMinor: '50000' });
  await db.allocateSavingsGoal(workspaceId, goal.id, account.id, '4000', 'Synthetic allocation');
  assert.equal(db.getSchemaVersion(), 5);
  assert.equal(canonicalJson(db.calculateAccountSummaries(workspaceId)), balances);
  assert.equal(canonicalJson(db.toSerializable().journalTransactions), canonicalJson(before.journalTransactions));
  assert.equal(canonicalJson(db.toSerializable().journalLines), canonicalJson(before.journalLines));
  for (const [id, operation] of before.syncOperations) {
    assert.equal(canonicalJson(db.getRawState().syncOperations.get(id)), canonicalJson(operation));
  }
  const saved = db.getSavingsProjection(workspaceId).goals.find(item => item.goal.id === goal.id)!;
  assert.equal(saved.fundedMinor, '4000');
  assert.equal(saved.remainingMinor, '46000');
  for (const operation of savingsOperations(db)) {
    assert.equal(operation.type, 'workspace.update');
    assert.equal(operation.entityId, workspaceId);
    assert.deepEqual(Object.keys(operation.payload).sort(), ['id', 'savingsEvent']);
    assert.equal(operation.payload.id, workspaceId);
  }
});

test('Spending and reversal recalculate backed savings without writing or changing allocation events', async () => {
  const { db, account } = await fundedDatabase();
  const goal = await db.saveSavingsGoal(workspaceId, { name: 'Synthetic funded goal', kind: 'general', targetMinor: '10000' });
  await db.allocateSavingsGoal(workspaceId, goal.id, account.id, '8000');
  const retained = canonicalJson(savingsOperations(db));
  const expense = buildExpenseJournal({ workspaceId, assetAccountId: account.id,
    expenseCategoryId: 'cat-food', amountMinor: '7000', effectiveDate: '2026-10-27', opId: generateUUID() });
  await post(db, expense);
  let item = db.getSavingsProjection(workspaceId).goals.find(item => item.goal.id === goal.id)!;
  assert.equal(item.fundedMinor, '3000');
  assert.equal(item.requestedMinor, '8000');
  assert.equal(item.shortfallMinor, '5000');
  assert.equal(canonicalJson(savingsOperations(db)), retained);
  await db.deleteTransaction(expense.transaction.id, 'Synthetic reversal');
  item = db.getSavingsProjection(workspaceId).goals.find(item => item.goal.id === goal.id)!;
  assert.equal(item.fundedMinor, '8000');
  assert.equal(item.shortfallMinor, '0');
  assert.equal(canonicalJson(savingsOperations(db)), retained);
  assert.equal(db.verifyLedgerIntegrity(workspaceId).isValid, true);
});

test('Goals, emergency template and allocations survive restart and idempotent file restore', async () => {
  const { db, driver, key, account } = await fundedDatabase();
  const goal = await db.saveSavingsGoal(workspaceId, { name: 'Synthetic emergency fund', kind: 'emergency',
    targetMinor: '60000', essentialMonthlyMinor: '20000', coverageMonths: 3 });
  await db.allocateSavingsGoal(workspaceId, goal.id, account.id, '3000');
  const restarted = new LocalDatabase(key, driver); await restarted.init();
  assert.equal(restarted.getSavingsProjection(workspaceId).goals[0].fundedMinor, '3000');
  const file = await restarted.exportBackupFile();
  const { db: restored } = await database();
  await restored.importBackupFile(file);
  const ids = savingsOperations(restored).map(op => op.operationId).sort();
  await restored.importBackupFile(file);
  assert.deepEqual(savingsOperations(restored).map(op => op.operationId).sort(), ids);
  const restoredGoal = restored.getSavingsProjection(workspaceId).goals.find(item => item.goal.id === goal.id)!;
  assert.equal(restoredGoal.goal.kind, 'emergency');
  assert.equal(restoredGoal.goal.targetMinor, '60000');
  assert.equal(restoredGoal.fundedMinor, '3000');
  assert.equal(restored.getAccount(account.id)?.openingBalanceMinor, '10000');
  assert.equal(restored.getTransactions(workspaceId).length, 0);
});

test('Offline devices allocating the same balance converge with visible shortfall and no invented money', async () => {
  const { db: first, account } = await fundedDatabase();
  const firstGoal = await first.saveSavingsGoal(workspaceId, { name: 'Synthetic car', kind: 'general', targetMinor: '10000' });
  const secondGoal = await first.saveSavingsGoal(workspaceId, { name: 'Synthetic education', kind: 'general', targetMinor: '10000' });
  const { db: second } = await replica(first);
  await first.allocateSavingsGoal(workspaceId, firstGoal.id, account.id, '8000');
  await second.allocateSavingsGoal(workspaceId, secondGoal.id, account.id, '8000');
  const firstOps = Array.from(first.getRawState().syncOperations.values());
  const secondOps = Array.from(second.getRawState().syncOperations.values());
  await replay(first, secondOps);
  await replay(second, firstOps);
  const projection = first.getSavingsProjection(workspaceId);
  assert.equal(projection.goals.reduce((sum, item) => sum + BigInt(item.fundedMinor), 0n), 10000n);
  assert.equal(projection.goals.reduce((sum, item) => sum + BigInt(item.requestedMinor), 0n), 16000n);
  assert.equal(projection.goals.reduce((sum, item) => sum + BigInt(item.shortfallMinor), 0n), 6000n);
  assert.equal(projection.accounts.find(item => item.accountId === account.id)?.availableMinor, '0');
  const funds = (db: LocalDatabase) => db.getSavingsProjection(workspaceId).goals
    .map(item => [item.goal.id, item.fundedMinor, item.shortfallMinor]).sort();
  assert.deepEqual(funds(first), funds(second));
  await replay(first, secondOps);
  assert.deepEqual(funds(first), funds(second), 'Repeated batches must not repeat deposits');
  assert.equal(first.getAccount(account.id)?.openingBalanceMinor, '10000');
  assert.equal(first.getTransactions(workspaceId).length, 0);
});

test('Release replay before its add is retained and duplicate batches never release twice', async () => {
  const { db: source, account } = await fundedDatabase();
  const goal = await source.saveSavingsGoal(workspaceId, { name: 'Synthetic travel', kind: 'general', targetMinor: '20000' });
  const { db: destination } = await replica(source);
  await source.allocateSavingsGoal(workspaceId, goal.id, account.id, '8000');
  const id = allocationId(source, goal.id);
  await source.releaseSavingsAllocation(workspaceId, goal.id, id, '3000');
  const events = savingsOperations(source);
  const add = events.find(op => op.payload.savingsEvent.action === 'allocation.add')!;
  const release = events.find(op => op.payload.savingsEvent.action === 'allocation.release')!;
  await replay(destination, [release]);
  await replay(destination, [add]);
  await replay(destination, [release, add]);
  const item = destination.getSavingsProjection(workspaceId).goals.find(item => item.goal.id === goal.id)!;
  assert.equal(item.requestedMinor, '5000');
  assert.equal(item.fundedMinor, '5000');
  assert.equal(destination.getSavingsProjection(workspaceId).accounts.find(item => item.accountId === account.id)?.availableMinor, '5000');
});

test('Concurrent releases cannot make an allocation negative or consume a later deposit', async () => {
  const { db: first, account } = await fundedDatabase();
  const goal = await first.saveSavingsGoal(workspaceId, { name: 'Synthetic shared goal', kind: 'general', targetMinor: '30000' });
  await first.allocateSavingsGoal(workspaceId, goal.id, account.id, '8000');
  const id = allocationId(first, goal.id);
  const { db: second } = await replica(first);
  await first.releaseSavingsAllocation(workspaceId, goal.id, id, '6000');
  await second.releaseSavingsAllocation(workspaceId, goal.id, id, '6000');
  await first.allocateSavingsGoal(workspaceId, goal.id, account.id, '2000');
  await replay(first, Array.from(second.getRawState().syncOperations.values()));
  const item = first.getSavingsProjection(workspaceId).goals.find(item => item.goal.id === goal.id)!;
  assert.equal(item.requestedMinor, '2000');
  assert.equal(item.fundedMinor, '2000');
  assert.equal(first.getSavingsProjection(workspaceId).accounts.find(item => item.accountId === account.id)?.availableMinor, '8000');
});

test('Failed savings commit restores durable state, event IDs and outbox before reporting failure', async () => {
  const { db, driver, key, account } = await fundedDatabase();
  const goal = await db.saveSavingsGoal(workspaceId, { name: 'Synthetic durable goal', kind: 'general', targetMinor: '10000' });
  const before = canonicalJson(db.toSerializable());
  driver.faultInjection = 'throw_on_commit';
  await assert.rejects(db.allocateSavingsGoal(workspaceId, goal.id, account.id, '2500'));
  assert.equal(canonicalJson(db.toSerializable()), before);
  assert.equal(db.isTransactionInProgress(), false);
  driver.faultInjection = 'none';
  const restarted = new LocalDatabase(key, driver); await restarted.init();
  assert.equal(canonicalJson(restarted.toSerializable()), before);
  assert.equal(restarted.getSavingsProjection(workspaceId).goals[0].fundedMinor, '0');
});

test('Invalid amounts, foreign workspace accounts and unavailable goals reject atomically', async () => {
  const { db, account } = await fundedDatabase();
  const foreignAccount = db.createAccount('ws-business-default', 'Synthetic other workspace', 'bank', '90000');
  await db.waitForPendingWrites();
  const goal = await db.saveSavingsGoal(workspaceId, { name: 'Synthetic guarded goal', kind: 'general', targetMinor: '10000' });
  const before = canonicalJson(db.toSerializable());
  for (const amount of ['0', '-1', '1.5', 'not-money']) {
    await assert.rejects(db.allocateSavingsGoal(workspaceId, goal.id, account.id, amount));
    assert.equal(canonicalJson(db.toSerializable()), before);
  }
  await assert.rejects(db.allocateSavingsGoal(workspaceId, goal.id, foreignAccount.id, '1000'));
  await assert.rejects(db.allocateSavingsGoal(workspaceId, generateUUID(), account.id, '1000'));
  await assert.rejects(db.releaseSavingsAllocation(workspaceId, goal.id, generateUUID(), '1000'));
  assert.equal(canonicalJson(db.toSerializable()), before);
  const foreign = db.getWorkspace('ws-business-default')!;
  foreign.ownerSubjectHash = 'synthetic-foreign-owner';
  await db.persist();
  const foreignBefore = canonicalJson(db.toSerializable());
  await assert.rejects(db.saveSavingsGoal(foreign.id, { name: 'Rejected', kind: 'general', targetMinor: '10000' }));
  assert.equal(canonicalJson(db.toSerializable()), foreignBefore);
});

test('Goal targets and monthly plans never supply wallet money; reservations reject above the shared available balance', async () => {
  const { db, account } = await fundedDatabase();
  const empty = db.createAccount(workspaceId, 'Synthetic empty wallet', 'cash', '0');
  await db.waitForPendingWrites();
  const first = await db.saveSavingsGoal(workspaceId, { name: 'First plan', kind: 'general', targetMinor: '100000', monthlyContributionMinor: '50000' });
  const second = await db.saveSavingsGoal(workspaceId, { name: 'Second plan', kind: 'general', targetMinor: '100000' });
  let before = canonicalJson(db.toSerializable());
  await assert.rejects(db.allocateSavingsGoal(workspaceId, first.id, empty.id, '1'), /SAVINGS_INSUFFICIENT_AVAILABLE/);
  assert.equal(canonicalJson(db.toSerializable()), before);
  await db.allocateSavingsGoal(workspaceId, first.id, account.id, '8000');
  assert.equal(db.getSavingsProjection(workspaceId).accounts.find(row => row.accountId === account.id)?.availableMinor, '2000');
  before = canonicalJson(db.toSerializable());
  await assert.rejects(db.allocateSavingsGoal(workspaceId, second.id, account.id, '2001'), /SAVINGS_INSUFFICIENT_AVAILABLE/);
  assert.equal(canonicalJson(db.toSerializable()), before);
  await db.allocateSavingsGoal(workspaceId, second.id, account.id, '2000');
  before = canonicalJson(db.toSerializable());
  await assert.rejects(db.allocateSavingsGoal(workspaceId, second.id, account.id, '1'), /SAVINGS_INSUFFICIENT_AVAILABLE/);
  assert.equal(canonicalJson(db.toSerializable()), before);
  assert.equal(db.getTransactions(workspaceId).length, 0);
});

test('Uploaded savings references protect empty account and goal-only workspace deletion', async () => {
  const { db } = await database();
  const account = db.createAccount(workspaceId, 'Synthetic empty wallet', 'cash', '0');
  const goal = await db.saveSavingsGoal(workspaceId, { name: 'Synthetic future goal', kind: 'general', targetMinor: '10000' });
  // Seed an old allocation against this previously funded account without inventing a journal.
  account.openingBalanceMinor = '1000'; await db.persist();
  await db.allocateSavingsGoal(workspaceId, goal.id, account.id, '1000');
  account.openingBalanceMinor = '0'; await db.persist();
  await db.markOutboxUploaded(db.getPendingOutbox().map(op => op.operationId), 'synthetic-cloud-file');
  const deletion = db.safeDeleteAccount(account.id, 'DELETE');
  assert.equal(deletion.mode, 'archived');
  assert.ok(db.getAccount(account.id)?.archivedAt);
  const { db: goalOnly } = await database();
  await goalOnly.saveSavingsGoal(workspaceId, { name: 'Synthetic plan only', kind: 'general', targetMinor: '10000' });
  assert.ok(goalOnly.workspaceDeleteBlocker(workspaceId));
  assert.throws(() => goalOnly.safeDeleteWorkspace(workspaceId, 'DELETE'));
});

test('A goal-only edit changes the verified cloud backup fingerprint without changing balances', async () => {
  const { db } = await database();
  const before = await financialFingerprint(db.toSerializable());
  const balances = canonicalJson(db.calculateAccountSummaries(workspaceId));
  const goal = await db.saveSavingsGoal(workspaceId, { name: 'Synthetic checkpoint goal', kind: 'general', targetMinor: '10000' });
  const created = await financialFingerprint(db.toSerializable());
  assert.notEqual(created, before);
  await db.saveSavingsGoal(workspaceId, { id: goal.id, name: 'Synthetic updated goal', kind: 'general', targetMinor: '20000' });
  assert.notEqual(await financialFingerprint(db.toSerializable()), created);
  assert.equal(canonicalJson(db.calculateAccountSummaries(workspaceId)), balances);
});

test('Retained old-client workspace updates rebuild savings after hydration without changing workspace metadata', async () => {
  const { db: source, account } = await fundedDatabase();
  const legacyData = structuredClone(source.toSerializable());
  const workspaceBefore = canonicalJson(source.getWorkspace(workspaceId));
  const goal = await source.saveSavingsGoal(workspaceId, { name: 'Synthetic retained goal', kind: 'general', targetMinor: '10000' });
  await source.allocateSavingsGoal(workspaceId, goal.id, account.id, '4500');
  // An old client ignores the extension fields but retains complete applied operations.
  for (const op of savingsOperations(source)) {
    legacyData.syncOperations.push([op.operationId, structuredClone(op)]);
    legacyData.appliedOperations.push(op.operationId);
  }
  const { db: upgraded } = await database();
  await upgraded.loadFromSerializable(legacyData);
  assert.equal(canonicalJson(upgraded.getWorkspace(workspaceId)), workspaceBefore);
  assert.equal(upgraded.getSavingsProjection(workspaceId).goals[0].fundedMinor, '4500');
  assert.equal(upgraded.getSchemaVersion(), 5);
  assert.equal(upgraded.getTransactions(workspaceId).length, 0);
});

test('A valid backup checksum cannot authorize malformed retained savings events', async () => {
  const { db: source } = await database();
  await source.saveSavingsGoal(workspaceId, { name: 'Synthetic checked goal', kind: 'general', targetMinor: '10000' });
  const incoming = await decodeBackup(await source.exportBackupFile());
  const [, op] = incoming.syncOperations.find(([, operation]: [string, SyncOperation]) => operation.payload.savingsEvent);
  op.payload.savingsEvent.goal.targetMinor = '-100';
  op.contentSha256 = await computeSha256(canonicalJson(op.payload));
  const { db } = await database();
  const before = canonicalJson(db.toSerializable());
  await assert.rejects(db.importBackupFile(await encodeBackup(incoming)));
  assert.equal(canonicalJson(db.toSerializable()), before);
});

test('Conflicting savings operation IDs in one remote batch reject atomically instead of choosing batch order', async () => {
  const { db: source } = await database();
  const { db: destination } = await replica(source);
  await source.saveSavingsGoal(workspaceId, { name: 'Synthetic original goal', kind: 'general', targetMinor: '10000' });
  const original = savingsOperations(source)[0];
  const conflicting = structuredClone(original);
  conflicting.payload.savingsEvent.goal.name = 'Synthetic conflicting replacement';
  conflicting.contentSha256 = await computeSha256(canonicalJson(conflicting.payload));
  const before = canonicalJson(destination.toSerializable());
  await assert.rejects(replay(destination, [original, conflicting]), /SAVINGS_EVENT_CONFLICT/);
  assert.equal(canonicalJson(destination.toSerializable()), before);
  assert.equal(destination.getSavingsProjection(workspaceId).goals.length, 0);
});

test('Offline savings require consent for first Google owner binding and survive authorized bootstrap unchanged', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();
  const { db, account } = await fundedDatabase();
  const goal = await db.saveSavingsGoal(workspaceId, { name: 'Synthetic offline owner goal', kind: 'general', targetMinor: '10000' });
  await db.allocateSavingsGoal(workspaceId, goal.id, account.id, '3500');
  const retained = savingsOperations(db).map(op => [op.operationId, canonicalJson(op.payload), op.contentSha256]);
  const subjectId = `synthetic-savings-owner-${generateUUID()}`;
  const subjectHash = await computeOwnerSubjectHash(subjectId);
  const profile = { subjectId, subjectHash, email: 'savings@example.invalid', displayName: 'Synthetic savings owner',
    accessToken: 'synthetic-test-only', isDriveAuthorized: true };
  const sync = new SyncOrchestrator(db, new SimulatedGoogleDriveTransport());
  const before = canonicalJson(db.toSerializable());
  await assert.rejects(sync.bootstrapAndRestore(profile), /consent/);
  assert.equal(canonicalJson(db.toSerializable()), before);
  await sync.bootstrapAndRestore(profile, true);
  assert.equal(db.getIdentity()?.ownerSubjectHash, subjectHash);
  assert.equal(db.getWorkspace(workspaceId)?.ownerSubjectHash, subjectHash);
  assert.deepEqual(savingsOperations(db).map(op => [op.operationId, canonicalJson(op.payload), op.contentSha256]), retained);
  assert.ok(savingsOperations(db).every(op => op.ownerHash === subjectHash));
  assert.equal(db.getSavingsProjection(workspaceId).goals.find(item => item.goal.id === goal.id)?.fundedMinor, '3500');
});

test('A late offline allocation on an archived goal stays unfunded and can be released without restoring the goal', async () => {
  const { db, account } = await fundedDatabase();
  const goal = await db.saveSavingsGoal(workspaceId, { name: 'Synthetic archived race', kind: 'general', targetMinor: '10000' });
  const { db: offline } = await replica(db);
  await db.setSavingsGoalArchived(workspaceId, goal.id, true);
  await offline.allocateSavingsGoal(workspaceId, goal.id, account.id, '8000');
  await replay(db, savingsOperations(offline));
  let item = db.getSavingsProjection(workspaceId).goals[0];
  assert.equal(item.goal.archived, true);
  assert.equal(item.requestedMinor, '8000');
  assert.equal(item.fundedMinor, '0');
  await db.releaseSavingsAllocation(workspaceId, goal.id, item.contributions[0].allocationId, '8000');
  item = db.getSavingsProjection(workspaceId).goals[0];
  assert.equal(item.goal.archived, true);
  assert.equal(item.requestedMinor, '0');
  assert.equal(item.contributions[0].releasedMinor, '8000');
  assert.equal(db.getTransactions(workspaceId).length, 0);
  assert.equal(db.calculateAccountSummaries(workspaceId).find(value => value.accountId === account.id)?.currentBalanceMinor, '10000');
});
