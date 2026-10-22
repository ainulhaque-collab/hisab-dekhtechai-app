import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import { LocalDatabase } from '../storage/db';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import { SyncOrchestrator } from '../sync/orchestrator';
import { buildIncomeJournal, buildExpenseJournal, buildReversalJournal, generateUUID } from '../domain/journal';
import { SyncOperation } from '../contracts/types';
import { toPaisa } from '../domain/money';

test('Canonical JSON serialization: deterministic keys and SHA-256', async () => {
  const obj1 = { z: 1, a: 'hello', m: { b: 2, a: 1 } };
  const obj2 = { a: 'hello', m: { a: 1, b: 2 }, z: 1 };

  const c1 = canonicalJson(obj1);
  const c2 = canonicalJson(obj2);

  assert.equal(c1, c2, 'Canonical JSON must sort keys identically regardless of insertion order');
  assert.equal(c1, '{"a":"hello","m":{"a":1,"b":2},"z":1}');

  const h1 = await computeSha256(c1);
  const h2 = await computeSha256(c2);
  assert.equal(h1, h2);
});

test('Two-device offline concurrent sync and eventual convergence', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();

  // Setup Device A (Android Phone 1)
  const dbA = new LocalDatabase('test_db_dev_a');
  dbA.seedDefaultEntities();
  dbA.setDeviceIdentity('device-android-A', 'Device A (Redmi Note)');
  const transportA = new SimulatedGoogleDriveTransport();
  const syncA = new SyncOrchestrator(dbA, transportA);

  // Setup Device B (Android Phone 2)
  const dbB = new LocalDatabase('test_db_dev_b');
  dbB.seedDefaultEntities();
  dbB.setDeviceIdentity('device-android-B', 'Device B (Galaxy A54)');
  const transportB = new SimulatedGoogleDriveTransport();
  const syncB = new SyncOrchestrator(dbB, transportB);

  const wsId = 'ws-personal-default';
  const accCash = 'acc-cash-1';

  // --- Step 1: Both devices work offline ---
  syncA.setOnline(false);
  syncB.setOnline(false);

  // Device A records expense of ৳350 (35000 paisa)
  const opAId = generateUUID();
  const journalA = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: accCash,
    expenseCategoryId: 'cat-food',
    amountMinor: '35000',
    effectiveDate: '2026-10-22',
    note: 'Device A lunch expense',
    opId: opAId,
  });
  const opA: SyncOperation = {
    protocolVersion: 1,
    ownerHash: 'owner-test-hash',
    deviceId: 'device-android-A',
    seq: dbA.getNextDeviceSeq(),
    operationId: opAId,
    entityId: journalA.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journalA },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journalA })),
  };
  await dbA.commitJournalWithOutbox(journalA, opA);

  // Device B records income of ৳900 (90000 paisa)
  const opBId = generateUUID();
  const journalB = buildIncomeJournal({
    workspaceId: wsId,
    assetAccountId: accCash,
    revenueCategoryId: 'cat-freelance',
    amountMinor: '90000',
    effectiveDate: '2026-10-22',
    note: 'Device B freelance income',
    opId: opBId,
  });
  const opB: SyncOperation = {
    protocolVersion: 1,
    ownerHash: 'owner-test-hash',
    deviceId: 'device-android-B',
    seq: dbB.getNextDeviceSeq(),
    operationId: opBId,
    entityId: journalB.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journalB },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journalB })),
  };
  await dbB.commitJournalWithOutbox(journalB, opB);

  // Verify before sync: both devices have 1 pending outbox op and divergent balances
  assert.equal(dbA.getPendingOutbox().length, 1);
  assert.equal(dbB.getPendingOutbox().length, 1);

  // --- Step 2: Both devices come online and sync ---
  syncA.setOnline(true);
  syncB.setOnline(true);

  // A syncs: uploads A's batch to cloud
  await syncA.triggerSync();
  assert.equal(dbA.getPendingOutbox().length, 0, 'A pending outbox must be empty after upload');

  // B syncs: uploads B's batch, downloads A's batch
  await syncB.triggerSync();
  assert.equal(dbB.getPendingOutbox().length, 0, 'B pending outbox must be empty after upload');

  // A syncs again: downloads B's batch
  await syncA.triggerSync();

  // --- Step 3: Eventual Convergence Invariant ---
  const txsA = dbA.getTransactions(wsId);
  const txsB = dbB.getTransactions(wsId);
  assert.equal(txsA.length, 2, 'Device A must have both transactions');
  assert.equal(txsB.length, 2, 'Device B must have both transactions');

  const summariesA = dbA.calculateAccountSummaries(wsId);
  const summariesB = dbB.calculateAccountSummaries(wsId);
  const cashA = summariesA.find((s) => s.accountId === accCash);
  const cashB = summariesB.find((s) => s.accountId === accCash);

  assert.equal(cashA?.currentBalanceMinor, cashB?.currentBalanceMinor, 'Consolidated balances must exactly match across devices');

  // Net movement: +90000 - 35000 = +55000 paisa (৳550.00). Starting balance ৳15,000 = 1500000 paisa -> 1555000 paisa
  assert.equal(cashA?.currentBalanceMinor, '1555000');
});

test('Idempotency: Re-syncing duplicate batches never duplicates transactions', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();

  const db = new LocalDatabase('test_db_idempotency');
  db.seedDefaultEntities();
  db.setDeviceIdentity('device-idemp', 'Device Idemp');
  const transport = new SimulatedGoogleDriveTransport();
  const sync = new SyncOrchestrator(db, transport);

  const wsId = 'ws-personal-default';
  const opId = generateUUID();
  const journal = buildIncomeJournal({
    workspaceId: wsId,
    assetAccountId: 'acc-cash-1',
    revenueCategoryId: 'cat-salary',
    amountMinor: '100000',
    effectiveDate: '2026-10-22',
    opId,
  });
  const op: SyncOperation = {
    protocolVersion: 1,
    ownerHash: 'owner-test',
    deviceId: 'device-idemp',
    seq: 1,
    operationId: opId,
    entityId: journal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })),
  };
  await db.commitJournalWithOutbox(journal, op);

  await sync.triggerSync();
  assert.equal(db.getTransactions(wsId).length, 1);

  // Trigger sync multiple times
  await sync.triggerSync();
  await sync.triggerSync();

  assert.equal(db.getTransactions(wsId).length, 1, 'Transaction count must remain exactly 1 after repeated syncs');
});

test('Conflict quarantine: concurrent incompatible corrections do NOT use silent last-writer-wins', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();

  const dbA = new LocalDatabase('test_db_conflict_a');
  dbA.seedDefaultEntities();
  dbA.setDeviceIdentity('dev-conf-A', 'Device A');
  const transportA = new SimulatedGoogleDriveTransport();
  const syncA = new SyncOrchestrator(dbA, transportA);

  const dbB = new LocalDatabase('test_db_conflict_b');
  dbB.seedDefaultEntities();
  dbB.setDeviceIdentity('dev-conf-B', 'Device B');
  const transportB = new SimulatedGoogleDriveTransport();
  const syncB = new SyncOrchestrator(dbB, transportB);

  const wsId = 'ws-personal-default';

  // 1. Post original transaction on Device A and sync to Device B
  const origOpId = generateUUID();
  const origJournal = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: 'acc-cash-1',
    expenseCategoryId: 'cat-food',
    amountMinor: '20000', // ৳200
    effectiveDate: '2026-10-22',
    note: 'Original lunch',
    opId: origOpId,
  });
  const origOp: SyncOperation = {
    protocolVersion: 1,
    ownerHash: 'owner-test',
    deviceId: 'dev-conf-A',
    seq: dbA.getNextDeviceSeq(),
    operationId: origOpId,
    entityId: origJournal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: origJournal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: origJournal })),
  };
  await dbA.commitJournalWithOutbox(origJournal, origOp);
  await syncA.triggerSync();
  await syncB.triggerSync();

  // Both have original
  assert.equal(dbA.getTransactions(wsId).length, 1);
  assert.equal(dbB.getTransactions(wsId).length, 1);

  // 2. Both go offline and create competing corrections on the SAME original transaction!
  syncA.setOnline(false);
  syncB.setOnline(false);

  // Device A corrects to ৳250
  const revA = buildReversalJournal(dbA.getTransaction(origJournal.transaction.id)!, 'rev-op-A', 'A fix');
  const repA = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: 'acc-cash-1',
    expenseCategoryId: 'cat-food',
    amountMinor: '25000',
    effectiveDate: '2026-10-22',
    note: 'A corrected to 250',
    opId: 'rep-op-A',
  });
  const corrOpA: SyncOperation = {
    protocolVersion: 1,
    ownerHash: 'owner-test',
    deviceId: 'dev-conf-A',
    seq: dbA.getNextDeviceSeq(),
    operationId: generateUUID(),
    entityId: origJournal.transaction.id,
    type: 'journal.correct',
    baseRevision: 'v1',
    createdAtUtc: new Date().toISOString(),
    payload: {
      originalTransactionId: origJournal.transaction.id,
      reversalBalanced: revA,
      replacementBalanced: repA,
      baseRevision: 'v1',
      note: 'Correction A',
    },
    contentSha256: '',
  };
  corrOpA.contentSha256 = await computeSha256(canonicalJson(corrOpA.payload));
  // Apply locally on A
  await syncA.applyBatchOperations({
    protocolVersion: 1,
    ownerHash: 'owner-test',
    deviceId: 'dev-conf-A',
    batchId: 'batch-A',
    fromSeq: 2,
    toSeq: 2,
    operations: [corrOpA],
    batchSha256: '',
    byteLength: 100,
    createdAtUtc: new Date().toISOString(),
  });

  // Device B corrects to ৳300
  const revB = buildReversalJournal(dbB.getTransaction(origJournal.transaction.id)!, 'rev-op-B', 'B fix');
  const repB = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: 'acc-cash-1',
    expenseCategoryId: 'cat-food',
    amountMinor: '30000',
    effectiveDate: '2026-10-22',
    note: 'B corrected to 300',
    opId: 'rep-op-B',
  });
  const corrOpB: SyncOperation = {
    protocolVersion: 1,
    ownerHash: 'owner-test',
    deviceId: 'dev-conf-B',
    seq: dbB.getNextDeviceSeq(),
    operationId: generateUUID(),
    entityId: origJournal.transaction.id,
    type: 'journal.correct',
    baseRevision: 'v1',
    createdAtUtc: new Date().toISOString(),
    payload: {
      originalTransactionId: origJournal.transaction.id,
      reversalBalanced: revB,
      replacementBalanced: repB,
      baseRevision: 'v1',
      note: 'Correction B',
    },
    contentSha256: '',
  };
  corrOpB.contentSha256 = await computeSha256(canonicalJson(corrOpB.payload));

  // 3. When Device A receives Device B's competing correction, conflict must be quarantined!
  await syncA.applyBatchOperations({
    protocolVersion: 1,
    ownerHash: 'owner-test',
    deviceId: 'dev-conf-B',
    batchId: 'batch-B',
    fromSeq: 1,
    toSeq: 1,
    operations: [corrOpB],
    batchSha256: '',
    byteLength: 100,
    createdAtUtc: new Date().toISOString(),
  });

  const conflictsA = dbA.getConflicts();
  assert.equal(conflictsA.length, 1, 'Conflict must be quarantined in conflicts table');
  assert.equal(conflictsA[0].status, 'needs_review');
  assert.equal(conflictsA[0].entityId, origJournal.transaction.id);
});

test('Sync error handling: 403 quota and 401 unauthorized status reporting', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();

  const db = new LocalDatabase('test_db_quota');
  db.seedDefaultEntities();
  const transport = new SimulatedGoogleDriveTransport();
  const sync = new SyncOrchestrator(db, transport);

  // Test 403 quota full fault
  transport.simulateFault = '403_quota';
  await sync.triggerSync();
  let status = sync.getStatus();
  assert.equal(status.state, 'quota_full', 'Status must report quota_full on 403');

  // Test 401 unauthorized fault
  transport.simulateFault = '401_expired';
  await sync.triggerSync();
  status = sync.getStatus();
  assert.equal(status.state, 'auth_required', 'Status must report auth_required on 401');
});
