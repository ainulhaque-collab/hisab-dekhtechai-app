import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import {
  buildIncomeJournal,
  buildExpenseJournal,
  buildTransferJournal,
  generateUUID
} from '../domain/journal';
import { canonicalJson, computeSha256 } from '../sync/canonical';

test('Durable storage fallback: basic get, set, remove', async () => {
  const driver = new LocalStorageFallbackDriver();
  assert.equal(driver.getType(), 'localstorage-fallback');

  await driver.setItem('test_key', 'test_value');
  const read = await driver.getItem('test_key');
  assert.equal(read, 'test_value');

  await driver.removeItem('test_key');
  const empty = await driver.getItem('test_key');
  assert.equal(empty, null);
});

test('LocalDatabase: atomic transactions roll back cleanly on failure', async () => {
  const db = new LocalDatabase('test_db_atomic');
  const initialAccountsCount = db.getAccounts('ws-personal-default').length;

  await db.beginTransaction();
  // Modify state within transaction
  db.createAccount('ws-personal-default', 'Temporary Account', 'cash', '10000');
  assert.equal(db.getAccounts('ws-personal-default').length, initialAccountsCount + 1);

  // Rollback
  await db.rollbackTransaction();
  assert.equal(
    db.getAccounts('ws-personal-default').length,
    initialAccountsCount,
    'Rollback must completely restore previous state'
  );
});

test('LocalDatabase: workspace archive and restore', () => {
  const db = new LocalDatabase('test_db_ws');
  const ws = db.createWorkspace('Old Business Project', 'business');

  // Archive workspace
  const archived = db.archiveWorkspace(ws.id);
  assert.equal(archived, true);

  // Default getWorkspaces should exclude archived
  const activeWorkspaces = db.getWorkspaces();
  assert.equal(activeWorkspaces.some((w) => w.id === ws.id), false);

  // getAllWorkspaces should include archived
  const allWorkspaces = db.getAllWorkspaces();
  const found = allWorkspaces.find((w) => w.id === ws.id);
  assert.ok(found);
  assert.ok(found.archivedAt);

  // Restore workspace
  const restored = db.restoreWorkspace(ws.id);
  assert.equal(restored, true);
  const activeAfterRestore = db.getWorkspaces();
  assert.equal(activeAfterRestore.some((w) => w.id === ws.id), true);
});

test('LocalDatabase fault-injection: durable write failure propagates error and rolls back transaction', async () => {
  const driver = new LocalStorageFallbackDriver();
  const db = new LocalDatabase('test_db_fault_inject', driver);
  const initialAccountsCount = db.getAccounts('ws-personal-default').length;

  // Arm driver fault injection
  driver.faultInjection = 'throw_on_write';

  // 1. Calling persist() directly must reject and propagate error
  await assert.rejects(
    async () => {
      await db.persist();
    },
    /fault injection/,
    'Durable storage failure must propagate to caller rather than being swallowed'
  );

  // 2. Performing transaction when durable storage fails must rollback and propagate error
  await db.beginTransaction();
  db.createAccount('ws-personal-default', 'Uncommitted Account', 'cash', '50000');

  await assert.rejects(
    async () => {
      await db.commitTransaction();
    },
    /fault injection/,
    'commitTransaction must reject on storage failure'
  );

  // State must be cleanly reverted
  assert.equal(
    db.getAccounts('ws-personal-default').length,
    initialAccountsCount,
    'Uncommitted account must be rolled back on durable storage failure'
  );
});

test('LocalDatabase fault-injection: atomic journal posting and outbox rollback on storage failure', async () => {
  const driver = new LocalStorageFallbackDriver();
  const db = new LocalDatabase('test_db_atomic_journal', driver);
  const wsId = 'ws-personal-default';

  const opId = generateUUID();
  const journal = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: 'acc-cash-1',
    expenseCategoryId: 'cat-food',
    amountMinor: '75000',
    effectiveDate: '2026-10-23',
    opId,
  });

  const op = {
    protocolVersion: 1,
    ownerHash: 'test-owner',
    deviceId: db.getDeviceId(),
    seq: db.getNextDeviceSeq(),
    operationId: opId,
    entityId: journal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })),
  };

  // Arm fault injection on commit
  driver.faultInjection = 'throw_on_commit';

  // Commit must fail atomically
  await assert.rejects(
    async () => {
      await db.commitJournalWithOutbox(journal, op);
    },
    /fault injection/,
    'commitJournalWithOutbox must reject when durable transaction commit fails'
  );

  // Invariant: neither transaction nor outbox entry was saved
  assert.equal(
    db.getTransaction(journal.transaction.id),
    undefined,
    'Transaction must not be saved if durable storage commit fails'
  );
  assert.equal(
    db.getPendingOutbox().filter((e) => e.opId === opId).length,
    0,
    'Outbox entry must not exist if durable storage commit fails'
  );
  assert.equal(
    db.getRawState().appliedOperations.has(opId),
    false,
    'Operation must not be marked applied if storage commit fails'
  );
});

test('LocalDatabase: Double-entry trial balance and independent ledger balance verification', async () => {
  const db = new LocalDatabase('test_db_ledger_integrity');
  const wsId = 'ws-personal-default';

  // Helper to post transaction
  const post = async (journal: any) => {
    const opId = generateUUID();
    const op = {
      protocolVersion: 1,
      ownerHash: 'test-owner',
      deviceId: db.getDeviceId(),
      seq: db.getNextDeviceSeq(),
      operationId: opId,
      entityId: journal.transaction.id,
      type: 'journal.post',
      createdAtUtc: new Date().toISOString(),
      payload: { balancedJournal: journal },
      contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })),
    };
    await db.commitJournalWithOutbox(journal, op);
  };

  // 1. Post Income ৳10,000 to Cash
  await post(
    buildIncomeJournal({
      workspaceId: wsId,
      assetAccountId: 'acc-cash-1',
      revenueCategoryId: 'cat-salary',
      amountMinor: '1000000',
      effectiveDate: '2026-10-23',
      opId: generateUUID(),
    })
  );

  // 2. Post Expense ৳2,500 from Cash
  await post(
    buildExpenseJournal({
      workspaceId: wsId,
      assetAccountId: 'acc-cash-1',
      expenseCategoryId: 'cat-food',
      amountMinor: '250000',
      effectiveDate: '2026-10-23',
      opId: generateUUID(),
    })
  );

  // 3. Post Transfer ৳3,000 from Cash to Bank with ৳15 fee
  await post(
    buildTransferJournal({
      workspaceId: wsId,
      fromAssetAccountId: 'acc-cash-1',
      toAssetAccountId: 'acc-bank-1',
      amountMinor: '300000',
      feeMinor: '1500',
      feeExpenseCategoryId: 'cat-food',
      effectiveDate: '2026-10-23',
      opId: generateUUID(),
    })
  );

  // Run independent ledger integrity audit
  const audit = db.verifyLedgerIntegrity(wsId);
  assert.equal(audit.isValid, true, `Audit should pass with 0 discrepancies: ${audit.discrepancies.join(', ')}`);
  assert.equal(audit.trialBalanceMatched, true, 'Grand trial balance debits must equal credits');
  assert.equal(audit.totalDebits, audit.totalCredits, 'Debits and credits must match');

  // Verify account balances match independent expectations:
  // Cash: +1000000 (inc) - 250000 (exp) - 300000 (xfer) - 1500 (fee) = 448500 paisa (৳4,485.00)
  // Bank: +300000 (xfer) = 300000 paisa (৳3,000.00)
  // Total Assets: 448500 + 300000 = 748500 paisa (৳7,485.00)
  // Net Income: 1000000 (rev) - 251500 (exp) = 748500 paisa (৳7,485.00)
  // Assets Net Delta === Net Income! Accounting equation holds!
  assert.equal(audit.netIncome, '748500');
  assert.equal(audit.totalAssetBalance, '748500');
});
