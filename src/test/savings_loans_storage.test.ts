import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { generateUUID } from '../domain/journal';
import { canonicalJson, computeSha256Sync } from '../sync/canonical';
import { decodeBackup, encodeBackup } from '../storage/backup';
import { isLoanJournal, isLoanLedgerAccount, loanToday } from '../storage/loanBook';
import { SyncOrchestrator } from '../sync/orchestrator';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import type { SyncOperation } from '../contracts/types';
import { runForegroundLoanRepayments } from '../services/loanAutoRepayment';
import { planLoanAutoRepayment } from '../domain/savingsLoans';

const issued = new Date('2026-10-28T06:00:00Z');
async function empty() {
  const key = `synthetic-loans-${generateUUID()}`, driver = new LocalStorageFallbackDriver();
  const db = new LocalDatabase(key, driver); await db.init();
  db.setIdentity('synthetic-owner');
  for (const ws of db.getRawState().workspaces.values()) ws.ownerSubjectHash = 'synthetic-owner';
  await db.persist();
  return { db, driver, key };
}
async function setup() {
  const base = await empty(), { db } = base;
  const sourceWs = db.createWorkspace('Synthetic personal', 'personal'), borrowerWs = db.createWorkspace('Synthetic business', 'business');
  const source = db.createAccount(sourceWs.id, 'Synthetic savings cash', 'cash', '100000');
  const borrower = db.createAccount(borrowerWs.id, 'Synthetic shop cash', 'cash', '0');
  await db.waitForPendingWrites();
  const goal = await db.saveSavingsGoal(sourceWs.id, { name: 'Synthetic goal', kind: 'general', targetMinor: '100000' });
  await db.allocateSavingsGoal(sourceWs.id, goal.id, source.id, '60000');
  const intent = { id: generateUUID(), goalId: goal.id, sourceWorkspaceId: sourceWs.id, sourceAccountId: source.id,
    borrowerWorkspaceId: borrowerWs.id, borrowerAccountId: borrower.id, principalMinor: '50000', dueDate: '2026-10-28',
    monthlyRateBps: 200, repaymentOrder: 'principal-first' as const, purpose: 'Synthetic business stock' };
  return { ...base, sourceWs, borrowerWs, source, borrower, goal, intent };
}
const cash = (db: LocalDatabase, workspaceId: string, accountId: string) => db.calculateAccountSummaries(workspaceId).find(a => a.accountId === accountId)!.currentBalanceMinor;
async function replay(db: LocalDatabase, operations: SyncOperation[]) {
  const sync = new SyncOrchestrator(db, new SimulatedGoogleDriveTransport());
  const byDevice = new Map<string, SyncOperation[]>();
  for (const op of operations) byDevice.set(op.deviceId, [...(byDevice.get(op.deviceId) || []), structuredClone(op)]);
  for (const [deviceId, ops] of byDevice) await sync.applyBatchOperations({ protocolVersion: 1, ownerHash: 'synthetic-owner', deviceId,
    batchId: generateUUID(), fromSeq: Math.min(...ops.map(o => o.seq)), toSeq: Math.max(...ops.map(o => o.seq)),
    operations: ops, batchSha256: '', byteLength: 0, createdAtUtc: issued.toISOString() });
}

test('Loan book: issuance atomically moves cash across workspaces, preserves principal accounting and keeps other reservations', async () => {
  const { db, sourceWs, borrowerWs, source, borrower, goal, intent } = await setup();
  const original = structuredClone(db.toSerializable());
  await db.issueSavingsLoan(intent, issued);
  assert.equal(cash(db, sourceWs.id, source.id), '50000');
  assert.equal(cash(db, borrowerWs.id, borrower.id), '50000');
  assert.equal(db.getSavingsProjection(sourceWs.id).goals.find(g => g.goal.id === goal.id)?.fundedMinor, '10000');
  const row = db.getSavingsLoans(sourceWs.id, '2026-10-28')[0];
  assert.equal(row.pendingReferences, 0);
  assert.equal(row.balance.principalOutstandingMinor, '50000');
  assert.equal(row.issue.terms.interestBasis, 'daily-30');
  assert.equal(row.issue.terms.reminderMinute, 1140);
  assert.equal(db.getSchemaVersion(), 6);
  for (const ws of [sourceWs, borrowerWs]) {
    assert.equal(db.verifyLedgerIntegrity(ws.id).isValid, true);
    const report = db.getDashboardData(ws.id);
    assert.equal(report.totalIncomeThisMonthMinor, '0'); assert.equal(report.totalExpenseThisMonthMinor, '0');
    assert.ok(report.accountSummaries.every(a => !isLoanLedgerAccount(a.accountId)));
    assert.ok(db.getAccounts(ws.id, true).every(a => !isLoanLedgerAccount(a.id)));
  }
  for (const [id, op] of original.syncOperations) assert.equal(canonicalJson(db.getRawState().syncOperations.get(id)), canonicalJson(op));
  const saved = canonicalJson(db.toSerializable());
  await db.issueSavingsLoan(intent, issued);
  assert.equal(canonicalJson(db.toSerializable()), saved, 'Retrying a saved request must not lend twice');
  await assert.rejects(db.issueSavingsLoan({ ...intent, principalMinor: '40000' }, issued), /LOAN_EVENT_CONFLICT/);
});

test('Loan book: partial repayment protects other goals, returns principal to original goal and separates outstanding interest', async () => {
  const { db, sourceWs, borrowerWs, source, borrower, goal, intent } = await setup();
  await db.issueSavingsLoan(intent, issued);
  const businessGoal = await db.saveSavingsGoal(borrowerWs.id, { name: 'Keep business money', kind: 'general', targetMinor: '20000' });
  await db.allocateSavingsGoal(borrowerWs.id, businessGoal.id, borrower.id, '20000');
  const requestId = generateUUID(), now = new Date('2026-11-12T13:00:00Z');
  await db.repaySavingsLoan(intent.id, requestId, undefined, now);
  assert.equal(cash(db, borrowerWs.id, borrower.id), '20000');
  assert.equal(cash(db, sourceWs.id, source.id), '80000');
  assert.equal(db.getSavingsProjection(sourceWs.id).goals.find(g => g.goal.id === goal.id)?.fundedMinor, '40000');
  assert.equal(db.getSavingsProjection(borrowerWs.id).goals.find(g => g.goal.id === businessGoal.id)?.fundedMinor, '20000');
  const row = db.getSavingsLoans(sourceWs.id, '2026-11-12')[0];
  assert.equal(row.balance.principalOutstandingMinor, '20000');
  assert.equal(row.balance.interestOutstandingMinor, '500');
  assert.equal(row.pendingReferences, 0);
  assert.equal(db.verifyLedgerIntegrity(sourceWs.id).isValid, true);
  assert.equal(db.verifyLedgerIntegrity(borrowerWs.id).isValid, true);
  const saved = canonicalJson(db.toSerializable());
  await db.repaySavingsLoan(intent.id, requestId, undefined, now);
  assert.equal(canonicalJson(db.toSerializable()), saved);
  await assert.rejects(db.repaySavingsLoan(intent.id, generateUUID(), undefined, now), /LOAN_INSUFFICIENT_AVAILABLE/);
  assert.equal(canonicalJson(db.toSerializable()), saved);
});

test('Loan book: full repayment clears receivable/payable and posts interest independently of principal', async () => {
  const { db, sourceWs, borrowerWs, source, borrower, goal, intent } = await setup();
  await db.issueSavingsLoan(intent, issued);
  // Synthetic opening cash top-up via an ordinary second wallet, not a live account.
  const now = new Date('2026-11-27T13:00:00Z');
  const state = db.getRawState();
  state.accounts.get(borrower.id)!.openingBalanceMinor = '1000';
  // Test-only fixture adjusts the retained definition before any backup export.
  const creation = [...state.syncOperations.values()].find(op => op.type === 'account.create' && op.entityId === borrower.id)!;
  creation.payload.account.openingBalanceMinor = '1000'; creation.contentSha256 = computeSha256Sync(canonicalJson(creation.payload));
  await db.repaySavingsLoan(intent.id, generateUUID(), undefined, now);
  const row = db.getSavingsLoans(sourceWs.id, '2026-11-27')[0];
  assert.equal(row.balance.status, 'paid');
  assert.equal(row.balance.interestRepaidMinor, '1000');
  assert.equal(cash(db, sourceWs.id, source.id), '101000');
  assert.equal(cash(db, borrowerWs.id, borrower.id), '0');
  assert.equal(db.getSavingsProjection(sourceWs.id).goals.find(g => g.goal.id === goal.id)?.fundedMinor, '60000');
  const interest = db.getTransactions(borrowerWs.id).filter(tx => tx.transactionType === 'expense');
  assert.equal(interest.length, 1);
  assert.equal(interest[0].lines.find(l => !!l.categoryId)?.debitMinor, '1000');
  assert.ok(db.calculateAccountSummaries(sourceWs.id).filter(a => isLoanLedgerAccount(a.accountId)).every(a => a.currentBalanceMinor === '0'));
  assert.ok(db.calculateAccountSummaries(borrowerWs.id).filter(a => isLoanLedgerAccount(a.accountId)).every(a => a.currentBalanceMinor === '0'));
});

test('Loan book: insufficient funds, foreign owners, protected journals/accounts and outstanding-goal archive are rejected', async () => {
  const { db, sourceWs, borrower, goal, intent } = await setup();
  const before = canonicalJson(db.toSerializable());
  await assert.rejects(db.issueSavingsLoan({ ...intent, principalMinor: '60001' }, issued), /LOAN_INSUFFICIENT_RESERVED/);
  assert.equal(canonicalJson(db.toSerializable()), before);
  db.getWorkspace(intent.borrowerWorkspaceId)!.ownerSubjectHash = 'foreign';
  await assert.rejects(db.issueSavingsLoan(intent, issued), /LOAN_OWNER_MISMATCH/);
  db.getWorkspace(intent.borrowerWorkspaceId)!.ownerSubjectHash = 'synthetic-owner';
  await db.issueSavingsLoan(intent, issued);
  await assert.rejects(db.setSavingsGoalArchived(sourceWs.id, goal.id, true), /LOAN_OUTSTANDING/);
  const journal = db.getTransactions(sourceWs.id).find(t => isLoanJournal(t.id))!;
  await assert.rejects(db.deleteTransaction(journal.id), /LOAN_PROTECTED_JOURNAL/);
  await assert.rejects(db.editTransaction(journal.id, { amountMinor: '1', effectiveDate: '2026-10-28', assetAccountId: borrower.id, categoryId: 'cat-food' }), /LOAN_PROTECTED_JOURNAL/);
  const account = db.getAllAccounts(sourceWs.id).find(a => isLoanLedgerAccount(a.id))!;
  assert.throws(() => db.restoreAccount(account.id), /LOAN_PROTECTED_ACCOUNT/);
  assert.equal(db.canUserWriteAccount('synthetic-owner', account.id), false);
});

test('Loan book: restart and idempotent backup restore retain linked loan, journals and repayment history', async () => {
  const { db, driver, key, intent, sourceWs } = await setup();
  await db.issueSavingsLoan(intent, issued);
  await db.repaySavingsLoan(intent.id, generateUUID(), '10000', issued);
  const restarted = new LocalDatabase(key, driver); await restarted.init();
  assert.equal(restarted.getSavingsLoans(sourceWs.id, '2026-10-28')[0].balance.principalOutstandingMinor, '40000');
  const file = await restarted.exportBackupFile(), { db: restored } = await empty();
  await restored.importBackupFile(file);
  const before = canonicalJson(restored.getSavingsLoans(sourceWs.id, '2026-10-28'));
  await restored.importBackupFile(file);
  assert.equal(canonicalJson(restored.getSavingsLoans(sourceWs.id, '2026-10-28')), before);
  assert.equal(restored.getSavingsLoans(sourceWs.id, '2026-10-28')[0].pendingReferences, 0);
  restored.setDeviceIdentity(generateUUID(), 'Read-only replica');
  await assert.rejects(restored.repaySavingsLoan(intent.id, generateUUID(), '1', issued), /LOAN_EXECUTOR_REQUIRED/);
});

test('Loan book: metadata arriving before linked journals stays pending, then converges on replay without duplicate payment', async () => {
  const { db, intent, sourceWs } = await setup(), { db: replica } = await empty();
  await replica.loadFromSerializable(structuredClone(db.toSerializable()));
  replica.setDeviceIdentity(generateUUID(), 'Synthetic replica');
  await db.issueSavingsLoan(intent, issued);
  await db.repaySavingsLoan(intent.id, generateUUID(), '10000', issued);
  const operations = [...db.getRawState().syncOperations.values()];
  await replay(replica, operations.filter(op => op.payload.loanEvent));
  assert.ok(replica.getSavingsLoans(sourceWs.id, '2026-10-28')[0].pendingReferences > 0);
  await replay(replica, operations);
  assert.equal(replica.getSavingsLoans(sourceWs.id, '2026-10-28')[0].pendingReferences, 0);
  assert.equal(replica.getSavingsLoans(sourceWs.id, '2026-10-28')[0].balance.principalOutstandingMinor, '40000');
  const count = replica.getRawState().journalTransactions.size;
  await replay(replica, operations);
  assert.equal(replica.getRawState().journalTransactions.size, count);
});

test('Loan book: forged retained metadata/journal backups reject atomically even with recomputed envelope hash', async () => {
  const { db, intent, sourceWs } = await setup();
  await db.issueSavingsLoan(intent, issued);
  const backup = await decodeBackup(await db.exportBackupFile());
  const issue = backup.syncOperations.find(([, op]: [string, SyncOperation]) => op.payload.loanEvent)![1];
  issue.payload.loanEvent.terms.ownerHash = 'foreign'; issue.contentSha256 = computeSha256Sync(canonicalJson(issue.payload));
  const { db: target } = await empty(), before = canonicalJson(target.toSerializable());
  await assert.rejects(target.importBackupFile(await encodeBackup(backup)), /LOAN_INVALID_EVENT/);
  assert.equal(canonicalJson(target.toSerializable()), before);
  const changed = await decodeBackup(await db.exportBackupFile());
  const journal = changed.journalTransactions.find(([, tx]: [string, { workspaceId: string }]) => tx.workspaceId === sourceWs.id)![1];
  journal.lines.reverse();
  await assert.rejects(target.importBackupFile(await encodeBackup(changed)), /LOAN_LEDGER_CONFLICT/);
  assert.equal(canonicalJson(target.toSerializable()), before);
});

test('Loan book: durable save failure rolls back cash, reservations, loan metadata and outbox together', async () => {
  const { db, driver, intent } = await setup();
  const before = canonicalJson(db.toSerializable()), original = driver.setItem.bind(driver);
  let reject = true;
  driver.setItem = async (key, value) => { if (reject) { reject = false; throw new Error('synthetic disk failure'); } await original(key, value); };
  await assert.rejects(db.issueSavingsLoan(intent, issued), /synthetic disk failure/);
  assert.equal(canonicalJson(db.toSerializable()), before);
  assert.equal(db.isTransactionInProgress(), false);
  await db.issueSavingsLoan(intent, issued);
  assert.equal(db.getSavingsLoans(undefined, loanToday(issued)).length, 1);
});

test('Loan automation: verified sync, due clock and opt-in gate partial repayment; retries and replicas cannot debit twice', async () => {
  const { db, intent, borrowerWs, borrower, sourceWs } = await setup();
  await db.issueSavingsLoan({ ...intent, autoRepay: true }, issued);
  const goal = await db.saveSavingsGoal(borrowerWs.id, { name: 'Protected business reserve', kind: 'general', targetMinor: '20000' });
  await db.allocateSavingsGoal(borrowerWs.id, goal.id, borrower.id, '20000');
  const now = new Date('2026-10-28T13:00:00Z');
  assert.deepEqual(await runForegroundLoanRepayments(db, now), { paid: 0, failed: 0 });
  db.getRawState().preferences.set('last-verified-sync-v1', { ownerHash: 'foreign', at: now.toISOString() });
  assert.deepEqual(await runForegroundLoanRepayments(db, now), { paid: 0, failed: 0 });
  db.getRawState().preferences.set('last-verified-sync-v1', { ownerHash: 'synthetic-owner', at: '2026-10-28T12:50:00.000Z' });
  assert.deepEqual(await runForegroundLoanRepayments(db, now), { paid: 0, failed: 0 });
  const before = new Date('2026-10-28T12:59:59Z');
  db.getRawState().preferences.set('last-verified-sync-v1', { ownerHash: 'synthetic-owner', at: before.toISOString() });
  assert.deepEqual(await runForegroundLoanRepayments(db, before), { paid: 0, failed: 0 });
  db.getRawState().preferences.set('last-verified-sync-v1', { ownerHash: 'synthetic-owner', at: now.toISOString() });
  assert.deepEqual(await runForegroundLoanRepayments(db, now), { paid: 1, failed: 0 });
  assert.equal(db.getSavingsLoans(sourceWs.id, '2026-10-28')[0].balance.principalOutstandingMinor, '20000');
  assert.equal(cash(db, borrowerWs.id, borrower.id), '20000');
  const count = db.getRawState().journalTransactions.size;
  assert.deepEqual(await runForegroundLoanRepayments(db, now), { paid: 0, failed: 0 });
  assert.equal(db.getRawState().journalTransactions.size, count);
  db.setDeviceIdentity(generateUUID(), 'Synthetic secondary device');
  assert.deepEqual(await runForegroundLoanRepayments(db, now), { paid: 0, failed: 0 });
  assert.equal(db.getRawState().journalTransactions.size, count);
});

test('Loan automation: new money permits another same-day partial payment without reusing a committed operation', async () => {
  const { db, intent, borrowerWs, borrower, sourceWs } = await setup();
  await db.issueSavingsLoan({ ...intent, autoRepay: true }, issued);
  const goal = await db.saveSavingsGoal(borrowerWs.id, { name: 'Protected reserve', kind: 'general', targetMinor: '20000' });
  await db.allocateSavingsGoal(borrowerWs.id, goal.id, borrower.id, '20000');
  const now = new Date('2026-10-28T13:00:00Z');
  db.getRawState().preferences.set('last-verified-sync-v1', { ownerHash: 'synthetic-owner', at: now.toISOString() });
  assert.equal((await runForegroundLoanRepayments(db, now)).paid, 1);
  // Releasing this synthetic reservation makes another 10,000 paisa available.
  const allocation = db.getSavingsProjection(borrowerWs.id).goals.find(g => g.goal.id === goal.id)!.contributions[0];
  await db.releaseSavingsAllocation(borrowerWs.id, goal.id, allocation.allocationId, '10000');
  db.getRawState().preferences.set('last-verified-sync-v1', { ownerHash: 'synthetic-owner', at: now.toISOString() });
  assert.equal((await runForegroundLoanRepayments(db, now)).paid, 1);
  const row = db.getSavingsLoans(sourceWs.id, '2026-10-28')[0];
  assert.equal(row.balance.principalOutstandingMinor, '10000');
  assert.equal(new Set(row.payments.map(p => p.id)).size, 2);
  assert.equal(cash(db, borrowerWs.id, borrower.id), '10000');
  assert.equal((await runForegroundLoanRepayments(db, now)).paid, 0);
});

test('Loan automation: any owner replica can stop; unseen stops beat stale enables and are rechecked inside payment commit', async () => {
  const { db, intent, sourceWs } = await setup(), { db: replica } = await empty();
  await db.issueSavingsLoan({ ...intent, autoRepay: true }, issued);
  await replica.loadFromSerializable(structuredClone(db.toSerializable()));
  replica.setDeviceIdentity(generateUUID(), 'Synthetic secondary');
  for (let i = 0; i < 4; i++) await db.setLoanAutoRepayment(intent.id, true);
  const row = db.getSavingsLoans(sourceWs.id, '2026-10-28')[0];
  const proposed = planLoanAutoRepayment(row.issue.terms, row.payments, '2026-10-28', '50000');
  assert.equal(proposed.status, 'proposal');
  await replica.setLoanAutoRepayment(intent.id, false);
  await assert.rejects(replica.setLoanAutoRepayment(intent.id, true), /LOAN_EXECUTOR_REQUIRED/);
  await replay(db, [...replica.getRawState().syncOperations.values()]);
  assert.equal(db.getSavingsLoans(sourceWs.id, '2026-10-28')[0].autoRepayEnabled, false, 'Lower numeric revision must still cancel an unseen enable');
  const now = new Date('2026-10-28T13:00:00Z');
  db.getRawState().preferences.set('last-verified-sync-v1', { ownerHash: 'synthetic-owner', at: now.toISOString() });
  assert.equal((await runForegroundLoanRepayments(db, now)).paid, 0);
  if (proposed.status !== 'proposal') throw new Error('Expected proposal');
  await assert.rejects(db.repaySavingsLoan(intent.id, proposed.payment.id, proposed.amountMinor, now, true), /LOAN_AUTOMATION_DISABLED/);
  assert.equal(db.getRawState().journalTransactions.size, 2);
  await db.setLoanAutoRepayment(intent.id, true);
  assert.equal(db.getSavingsLoans(sourceWs.id, '2026-10-28')[0].autoRepayEnabled, true);
  await replica.setLoanAutoRepayment(intent.id, false);
  await replay(db, [...replica.getRawState().syncOperations.values()]);
  assert.equal(db.getSavingsLoans(sourceWs.id, '2026-10-28')[0].autoRepayEnabled, false, 'New unseen stop cancels an acknowledged earlier stop');
  const restored = await empty();
  await restored.db.importBackupFile(await db.exportBackupFile());
  assert.equal(restored.db.getSavingsLoans(sourceWs.id, '2026-10-28')[0].autoRepayEnabled, false);
  assert.equal(db.getRawState().journalTransactions.size, 2);
});
