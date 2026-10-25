import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { LocalDatabase } from '../src/storage/db';
import { LocalStorageFallbackDriver } from '../src/storage/drivers/durableStorage';
import { buildIncomeJournal, buildExpenseJournal, buildTransferJournal, generateUUID } from '../src/domain/journal';
import { canonicalJson, computeSha256 } from '../src/sync/canonical';

// Synthetic fixture only. No installed app storage, customer data, or Google account is accessed.
const driver = new LocalStorageFallbackDriver();
const key = 'approved-upgrade-synthetic';
const db = new LocalDatabase(key, driver); await db.init();
const ws = db.createWorkspace('Synthetic business', 'business');
const group = db.createAccountGroup(ws.id, 'Synthetic wallets');
const cash = db.createAccount(ws.id, 'QA cash', 'cash', '100000', '', 'asset', group.id);
const bank = db.createAccount(ws.id, 'QA bank', 'bank', '200000', '', 'asset', group.id);
const income = db.createCategory(ws.id, 'QA income', 'income');
const expense = db.createCategory(ws.id, 'QA expense', 'expense');
const journals = [
  buildIncomeJournal({ workspaceId: ws.id, assetAccountId: cash.id, revenueCategoryId: income.id, amountMinor: '50000', effectiveDate: '2026-10-25', opId: generateUUID() }),
  buildExpenseJournal({ workspaceId: ws.id, assetAccountId: bank.id, expenseCategoryId: expense.id, amountMinor: '7000', effectiveDate: '2026-10-25', opId: generateUUID() }),
  buildTransferJournal({ workspaceId: ws.id, fromAssetAccountId: cash.id, toAssetAccountId: bank.id, amountMinor: '11000', effectiveDate: '2026-10-25', opId: generateUUID() }),
];
for (const journal of journals) {
  const payload = { balancedJournal: journal };
  await db.commitJournalWithOutbox(journal, { protocolVersion: 1, ownerHash: 'local-owner', deviceId: db.getDeviceId(), seq: db.getNextDeviceSeq(), operationId: journal.transaction.createdOpId, entityId: journal.transaction.id, type: 'journal.post', createdAtUtc: new Date().toISOString(), payload, contentSha256: await computeSha256(canonicalJson(payload)) });
}
db.archiveAccount(bank.id);
db.getRawState().preferences.set('soundVolume', 0.4);
db.getRawState().preferences.set('syntheticProfile', 'QA preferences');
await db.persist();
function snapshot(target: LocalDatabase) {
  const raw = target.getRawState();
  return { schema: target.getSchemaVersion(), workspaces: raw.workspaces.size, accounts: raw.accounts.size,
    transactions: raw.journalTransactions.size, journalLines: raw.journalLines.size,
    balances: target.calculateAccountSummaries(ws.id), groupTotal: target.getAccountGroupSummary(group.id)?.currentBalanceMinor,
    consolidated: target.getDashboardData(ws.id).totalConsolidatedBalanceMinor,
    pendingOperationIds: target.getPendingOutbox().map(o => o.operationId), ownerIdentity: target.getIdentity(),
    financialIntegrity: target.verifyLedgerIntegrity(ws.id).isValid, preferences: Array.from(raw.preferences.entries()) };
}
const before = snapshot(db);
const serializedBaseline = db.toSerializable();
const upgraded = new LocalDatabase(key, driver); await upgraded.init();
assert.deepEqual(snapshot(upgraded), before);
upgraded.editWorkspace(ws.id, { name: 'Renamed synthetic business' });
upgraded.archiveWorkspace(ws.id); upgraded.restoreWorkspace(ws.id); await upgraded.waitForPendingWrites();
const after = snapshot(upgraded);
for (const field of ['workspaces', 'accounts', 'transactions', 'journalLines', 'balances', 'groupTotal', 'consolidated', 'ownerIdentity', 'financialIntegrity', 'preferences'] as const) assert.deepEqual(after[field], before[field], field);
assert.ok(before.pendingOperationIds.every(id => after.pendingOperationIds.includes(id)));
assert.equal(after.consolidated, '343000');
assert.equal(after.groupTotal, '343000');
mkdirSync('docs/qa', { recursive: true });
writeFileSync('docs/qa/synthetic-v5-baseline.json', JSON.stringify(serializedBaseline, null, 2));
writeFileSync('docs/qa/upgrade-evidence.json', JSON.stringify({ fixture: 'Synthetic Node fallback driver; not physical SQLite or APK upgrade', baselineCommit: '35e0b7c499bdb0f0e271fe2ec7de5e7dc6b3b415', before, after, recordAndBalanceParity: true, originalPendingOperationsRetained: true, apkUpgrade: 'BLOCKED — REAL DEVICE / GOOGLE AUTH VERIFICATION REQUIRED' }, null, 2));
console.log(`Synthetic upgrade PASS: ${after.accounts} accounts, ${after.transactions} transactions, ${after.journalLines} journal lines; BDT 3430.00 reconciled; all ${before.pendingOperationIds.length} original pending operations retained.`);
