import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import {
  buildIncomeJournal,
  buildExpenseJournal,
  buildTransferJournal,
  generateUUID,
} from '../domain/journal';
import { BalancedJournal, SyncOperation } from '../contracts/types';
import { canonicalJson, computeSha256 } from '../sync/canonical';

async function postJournalHelper(db: LocalDatabase, journal: BalancedJournal, ownerHash = 'local-owner') {
  const op: SyncOperation = {
    protocolVersion: 1,
    ownerHash,
    deviceId: 'device-test',
    seq: db.getNextDeviceSeq(),
    operationId: journal.transaction.createdOpId || generateUUID(),
    entityId: journal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })),
  };
  await db.commitJournalWithOutbox(journal, op);
}

test('FEAT-001: Multiple Account Group Management & Accounting Reconciliation', async () => {
  const driver = new LocalStorageFallbackDriver();
  const db = new LocalDatabase('test_db_groups', driver);
  await db.init();
  const wsId = 'ws-business-default';

  // 1. Create a business account group: "PestGurd Business Group"
  const group = db.createAccountGroup(
    wsId,
    'PestGurd Business Group',
    'briefcase',
    'Operating accounts for PestGurd pest control service'
  );
  assert.ok(group.id, 'Group ID must be generated');
  assert.equal(group.name, 'PestGurd Business Group');
  assert.equal(group.archivedAt, null);

  // 2. Create accounts inside the workspace
  const cashAcc = db.createAccount(wsId, 'Cash Wallet', 'cash', '10000', 'CW-01', 'asset', group.id);
  const bkashAcc = db.createAccount(wsId, 'bKash Merchant', 'bkash', '5000', '01700000000', 'asset', group.id);
  const bankAcc = db.createAccount(wsId, 'City Bank Corporate', 'bank', '50000', '1102938475', 'asset', group.id);
  // Standalone personal cash account not in group
  const standaloneAcc = db.createAccount(wsId, 'Standalone Vault', 'cash', '20000', 'SV-01', 'asset', null);

  assert.equal(cashAcc.groupId, group.id);
  assert.equal(bkashAcc.groupId, group.id);
  assert.equal(bankAcc.groupId, group.id);
  assert.equal(standaloneAcc.groupId, null);

  // 3. Initial group summary reconciliation (Opening balances: 10000 + 5000 + 50000 = 65000)
  let summary = db.getAccountGroupSummary(group.id);
  assert.ok(summary, 'Group summary must exist');
  assert.equal(summary.accounts.length, 3);
  assert.equal(summary.currentBalanceMinor, '65000');
  assert.equal(summary.totalIncomeMinor, '0');
  assert.equal(summary.totalExpenseMinor, '0');

  // 4. Post Income into Cash Wallet: 15,000 paisa
  const cats = db.getCategories(wsId);
  const salesCat = cats.find((c) => c.kind === 'income') || cats[0];
  const expenseCat = cats.find((c) => c.kind === 'expense') || cats[1];

  const incomeJournal = buildIncomeJournal({
    workspaceId: wsId,
    assetAccountId: cashAcc.id,
    revenueCategoryId: salesCat.id,
    amountMinor: '15000',
    effectiveDate: '2026-10-24',
    note: 'Pest control service payment',
    opId: generateUUID(),
  });
  await postJournalHelper(db, incomeJournal);

  summary = db.getAccountGroupSummary(group.id);
  assert.equal(summary?.totalIncomeMinor, '15000', 'Group total income must reflect 15,000');
  assert.equal(summary?.currentBalanceMinor, '80000', 'Group balance must be 65,000 + 15,000 = 80,000');

  // 5. Post Expense from Bank Account: 6,000 paisa
  const expenseJournal = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: bankAcc.id,
    expenseCategoryId: expenseCat.id,
    amountMinor: '6000',
    effectiveDate: '2026-10-24',
    note: 'Chemical supplies purchase',
    opId: generateUUID(),
  });
  await postJournalHelper(db, expenseJournal);

  summary = db.getAccountGroupSummary(group.id);
  assert.equal(summary?.totalExpenseMinor, '6000', 'Group total expense must reflect 6,000');
  assert.equal(summary?.currentBalanceMinor, '74000', 'Group balance must be 80,000 - 6,000 = 74,000');

  // 6. INTRA-GROUP TRANSFER NEUTRALITY TEST
  // Transfer 5,000 from Cash Wallet to Bank Account (both in PestGurd group).
  // Accounting Rule: Transfers between accounts in the same group must NOT count as fresh income or expense!
  const intraTransfer = buildTransferJournal({
    workspaceId: wsId,
    fromAssetAccountId: cashAcc.id,
    toAssetAccountId: bankAcc.id,
    amountMinor: '5000',
    effectiveDate: '2026-10-24',
    note: 'Bank cash deposit',
    opId: generateUUID(),
  });
  await postJournalHelper(db, intraTransfer);

  summary = db.getAccountGroupSummary(group.id);
  assert.equal(summary?.totalIncomeMinor, '15000', 'Intra-group transfer must NOT inflate group income');
  assert.equal(summary?.totalExpenseMinor, '6000', 'Intra-group transfer must NOT inflate group expense');
  assert.equal(summary?.currentBalanceMinor, '74000', 'Group balance must remain exactly 74,000');

  // 7. INTER-GROUP TRANSFER TEST
  // Transfer 10,000 from Standalone Vault (outside group) into bKash Merchant (inside group)
  const interTransfer = buildTransferJournal({
    workspaceId: wsId,
    fromAssetAccountId: standaloneAcc.id,
    toAssetAccountId: bkashAcc.id,
    amountMinor: '10000',
    effectiveDate: '2026-10-24',
    note: 'Capital injection into bKash',
    opId: generateUUID(),
  });
  await postJournalHelper(db, interTransfer);

  summary = db.getAccountGroupSummary(group.id);
  assert.equal(summary?.currentBalanceMinor, '84000', 'Group balance must now be 74,000 + 10,000 = 84,000');

  // 8. Dynamic Group Membership (Remove and Add)
  db.removeAccountFromGroup(bkashAcc.id);
  let updatedBkash = db.getAccounts(wsId).find((a) => a.id === bkashAcc.id);
  assert.equal(updatedBkash?.groupId, null, 'bKash must no longer be in group');

  summary = db.getAccountGroupSummary(group.id);
  assert.equal(summary?.accounts.length, 2, 'Group must have 2 accounts now');

  db.addAccountToGroup(bkashAcc.id, group.id);
  updatedBkash = db.getAccounts(wsId).find((a) => a.id === bkashAcc.id);
  assert.equal(updatedBkash?.groupId, group.id, 'bKash must be back in group');

  // 9. Group Archive and Restore
  const archiveRes = db.archiveAccountGroup(group.id);
  assert.ok(archiveRes, 'Group archive must succeed');
  assert.ok(db.getAccountGroups(wsId).find((g) => g.id === group.id)?.archivedAt !== null);

  const restoreRes = db.restoreAccountGroup(group.id);
  assert.ok(restoreRes, 'Group restore must succeed');
  assert.equal(db.getAccountGroups(wsId).find((g) => g.id === group.id)?.archivedAt, null);
});
