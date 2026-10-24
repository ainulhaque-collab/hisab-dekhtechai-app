import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { buildIncomeJournal, generateUUID } from '../domain/journal';
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

test('FEAT-002: Account Editing and Safe Deletion with exact DELET confirmation', async () => {
  const driver = new LocalStorageFallbackDriver();
  const db = new LocalDatabase('test_db_account_manage', driver);
  await db.init();
  const wsId = 'ws-personal-default';

  // 1. Create Account
  const testAcc = db.createAccount(wsId, 'Primary Savings', 'bank', '5000', '1234', 'asset', null);
  assert.equal(testAcc.name, 'Primary Savings');
  assert.equal(testAcc.kind, 'bank');
  assert.equal(testAcc.archivedAt, null);

  // 2. Edit Account properties
  const updated = db.updateAccount(testAcc.id, {
    name: 'Primary Savings Premium',
    accountNumberMasked: '****5678',
    kind: 'bank',
  });
  assert.ok(updated);
  assert.equal(updated.name, 'Primary Savings Premium');
  assert.equal(updated.accountNumberMasked, '****5678');

  // 3. Archive and Restore
  db.archiveAccount(testAcc.id);
  let accState = db.getAccounts(wsId).find((a) => a.id === testAcc.id);
  assert.ok(accState?.archivedAt !== null, 'Account must be archived');

  db.restoreAccount(testAcc.id);
  accState = db.getAccounts(wsId).find((a) => a.id === testAcc.id);
  assert.equal(accState?.archivedAt, null, 'Account must be unarchived');

  // 4. Exact DELET confirmation enforcement
  // Test wrong confirmation texts: 'DELETE', 'delet', 'DEL', 'YES', etc.
  const wrong1 = db.safeDeleteAccount(testAcc.id, 'DELETE');
  assert.equal(wrong1.success, false, 'DELETE must be rejected');
  assert.ok(wrong1.error?.includes('DELET'));

  const wrong2 = db.safeDeleteAccount(testAcc.id, 'delet');
  assert.equal(wrong2.success, false, 'lowercase delet must be rejected');

  const wrong3 = db.safeDeleteAccount(testAcc.id, '');
  assert.equal(wrong3.success, false, 'empty confirmation must be rejected');

  // 5. Zero transactions: Safe hard deletion
  const emptyAcc = db.createAccount(wsId, 'Unused Wallet', 'cash', '0', '', 'asset', null);
  const deleteEmptyRes = db.safeDeleteAccount(emptyAcc.id, 'DELET');
  assert.equal(deleteEmptyRes.success, true);
  assert.equal(deleteEmptyRes.mode, 'deleted');
  assert.equal(
    db.getAccounts(wsId).some((a) => a.id === emptyAcc.id),
    false,
    'Account with zero transactions must be deleted from database'
  );

  // 6. Account WITH Transactions: Safe Archival (Double-entry history preservation)
  const activeAcc = db.createAccount(wsId, 'Active Trading Account', 'bank', '1000', '', 'asset', null);
  const cats = db.getCategories(wsId);
  const incomeJournal = buildIncomeJournal({
    workspaceId: wsId,
    assetAccountId: activeAcc.id,
    revenueCategoryId: cats[0].id,
    amountMinor: '25000',
    effectiveDate: '2026-10-24',
    note: 'Trading dividend payout',
    opId: generateUUID(),
  });
  await postJournalHelper(db, incomeJournal);

  // Perform safe deletion with exact DELET
  const deleteActiveRes = db.safeDeleteAccount(activeAcc.id, 'DELET');
  assert.equal(deleteActiveRes.success, true);
  assert.equal(deleteActiveRes.mode, 'archived', 'Account with transactions must be archived instead of purged');

  // Verify account is marked archived and its transactions & journals remain intact
  const preservedAcc = db.getAccount(activeAcc.id);
  assert.ok(preservedAcc, 'Account record must remain in database');
  assert.ok(preservedAcc.archivedAt !== null, 'Account must be marked as archived');
  assert.equal(db.getAccounts(wsId).find((a) => a.id === activeAcc.id), undefined, 'Archived account must not appear in active accounts list');
  assert.ok(db.getAccounts(wsId, true).find((a) => a.id === activeAcc.id), 'Archived account appears when includeArchived is true');

  const txs = db.getTransactions(wsId);
  assert.ok(
    txs.some((t) => t.id === incomeJournal.transaction.id),
    'Accounting journal lines must be preserved without data loss'
  );

  // Verify double-entry ledger balance integrity remains intact
  const integrity = db.verifyLedgerIntegrity(wsId);
  assert.equal(integrity.isValid, true, 'Ledger double-entry balance must remain completely valid');
});
