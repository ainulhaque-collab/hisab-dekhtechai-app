import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver, IndexedDBDurableDriver } from '../storage/drivers/durableStorage';
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

test('Failed ledger migration preserves the exact original durable bytes and schema', async () => {
  const driver = new LocalStorageFallbackDriver(), key = `failed-migration-${generateUUID()}`;
  const db = new LocalDatabase(key, driver); await db.init();
  const journal = buildIncomeJournal({ workspaceId: 'ws-personal-default', assetAccountId: 'acc-cash-1', revenueCategoryId: 'cat-salary', amountMinor: '100', effectiveDate: '2026-10-26', opId: generateUUID() });
  await postJournalHelper(db, journal); const data = structuredClone(db.toSerializable());
  data.schemaVersion = 4; data.journalTransactions[0][1].lines[0].debitMinor = '101';
  const original = JSON.stringify(data); await driver.setItem(key, original);
  await assert.rejects(new LocalDatabase(key, driver).init(), /integrity verification/);
  assert.equal(await driver.getItem(key), original);
  assert.equal(await driver.getItem(`${key}_pre_migration_v5`), original);
});

test('A future schema is refused without rewriting customer records', async () => {
  const driver = new LocalStorageFallbackDriver(), key = `future-${generateUUID()}`;
  const db = new LocalDatabase(key, driver); await db.init();
  const original = JSON.stringify({ ...db.toSerializable(), schemaVersion: db.getSchemaVersion()+1, futureFinancialCollection: [['synthetic', { amountMinor: '123' }]] });
  await driver.setItem(key, original); await assert.rejects(new LocalDatabase(key, driver).init(), /DATABASE_VERSION_UNSUPPORTED/);
  assert.equal(await driver.getItem(key), original);
});

test('Migrated records, pending UUIDs and schema remain stable over repeated application updates', async () => {
  const driver = new LocalStorageFallbackDriver(), key = `repeat-upgrade-${generateUUID()}`;
  const db = new LocalDatabase(key, driver); await db.init(); db.createWorkspace('Synthetic offline records', 'business'); await db.waitForPendingWrites();
  const data = db.toSerializable(); data.schemaVersion = 4; await driver.setItem(key, JSON.stringify(data));
  const migrated = new LocalDatabase(key, driver); await migrated.init();
  const saved = canonicalJson(migrated.toSerializable()), originalIds = db.getPendingOutbox().map(op => op.operationId);
  for (let i = 0; i < 3; i++) { const next = new LocalDatabase(key, driver); await next.init(); assert.equal(canonicalJson(next.toSerializable()), saved); assert.deepEqual(next.getPendingOutbox().map(op => op.operationId), originalIds); }
});

test('IndexedDB does not acknowledge writes before transaction commit and rejects a late abort', async () => {
  for (const action of ['setItem', 'removeItem'] as const) {
    const driver = new IndexedDBDurableDriver(); let tx: any, request: any;
    (driver as any).db = { transaction: () => {
      request = {}; tx = { error: null, objectStore: () => ({ put: () => request, delete: () => request }) }; return tx;
    } };
    let finished = false;
    const pending = (action === 'setItem' ? driver.setItem('qa', 'synthetic') : driver.removeItem('qa')).then(() => { finished = true; });
    request.onsuccess?.(); await Promise.resolve(); assert.equal(finished, false);
    tx.oncomplete(); await pending; assert.equal(finished, true);
    const aborted = action === 'setItem' ? driver.setItem('qa', 'synthetic') : driver.removeItem('qa');
    request.onsuccess?.(); tx.error = new Error('Synthetic late commit failure'); tx.onabort();
    await assert.rejects(aborted, /late commit failure/);
  }
});

test('BUG-003: synthetic v4-to-v5 migration preserves records, balances and recovery copies', async () => {
  const driver = new LocalStorageFallbackDriver();
  const dbKey = 'test_db_upgrade_safety';
  const wsId = 'ws-personal-default';

  // 1. Setup a previous-version database using synthetic financial records.
  const dbV4 = new LocalDatabase(dbKey, driver);
  await dbV4.init();

  const customAccount = dbV4.createAccount(wsId, 'My Special Gold Savings', 'bank', '100000', 'GLD-777', 'asset', null);
  const cats = dbV4.getCategories(wsId);
  const incomeTx = buildIncomeJournal({
    workspaceId: wsId,
    assetAccountId: customAccount.id,
    revenueCategoryId: cats[0].id,
    amountMinor: '50000',
    effectiveDate: '2026-10-24',
    note: 'Gold profit payout',
    opId: generateUUID(),
  });
  await postJournalHelper(dbV4, incomeTx);
  await dbV4.persist();

  // Inspect raw persisted data to simulate a schema v4 database state
  const rawData = await driver.getItem(dbKey);
  assert.ok(rawData, 'Raw data must be persisted');
  const parsed = JSON.parse(rawData);

  // Artificially set schema version to 4 and omit accountGroups/accountPermissions to emulate v4 state
  parsed.schemaVersion = 4;
  delete parsed.accountGroups;
  delete parsed.accountPermissions;
  await driver.setItem(dbKey, JSON.stringify(parsed));

  // 2. Perform APK Upgrade / Database Re-initialization to the guarded wallet schema.
  const upgradedDb = new LocalDatabase(dbKey, driver);
  await upgradedDb.init();

  // 3. Verify Version Bump
  assert.equal(upgradedDb.getSchemaVersion(), 6, 'Database must be upgraded to version 6');

  // 4. Verify NON-DESTRUCTIVE PRESERVATION of existing financial records
  const accountsAfter = upgradedDb.getAccounts(wsId);
  assert.ok(
    accountsAfter.some((a) => a.id === customAccount.id && a.name === 'My Special Gold Savings'),
    'Existing accounts must survive migration without data loss'
  );

  const txsAfter = upgradedDb.getTransactions(wsId);
  assert.ok(
    txsAfter.some((t) => t.id === incomeTx.transaction.id && t.note === 'Gold profit payout'),
    'Existing transaction history and journal lines must survive migration'
  );

  // 5. Verify pre-migration recovery snapshot was captured
  const preSnapshotRaw = await driver.getItem(`${dbKey}_pre_migration_v5`);
  assert.ok(preSnapshotRaw, 'Pre-migration recovery snapshot must be durably stored in driver');

  // 6. Verify Post-migration ledger integrity
  const integrity = upgradedDb.verifyLedgerIntegrity(wsId);
  assert.equal(integrity.isValid, true, 'Ledger double-entry balance must remain fully valid after migration');

  // 7. Test Corrupted / Failing Migration Safety: NEVER WIPE DATA
  const corruptKey = 'test_db_corrupt_safety';
  const corruptRawContent = '{ "schemaVersion": 4, "brokenJson": true, INVALID }';
  await driver.setItem(corruptKey, corruptRawContent);

  const corruptDb = new LocalDatabase(corruptKey, driver);
  // Initializing corrupt database should throw error and NEVER silently wipe or overwrite raw user records
  await assert.rejects(
    async () => {
      await corruptDb.init();
    },
    (err: any) => err instanceof SyntaxError
  );

  // The emergency backup key must preserve raw customer content
  const emergencyBackup = await driver.getItem(`${corruptKey}_emergency_corrupt_backup`);
  assert.equal(emergencyBackup, corruptRawContent, 'Emergency backup must preserve raw un-wiped user data');
});
