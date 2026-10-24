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

test('BUG-003: SQLite Data Preservation During App Updates and Versioned Migrations', async () => {
  const driver = new LocalStorageFallbackDriver();
  const dbKey = 'test_db_upgrade_safety';
  const wsId = 'ws-personal-default';

  // 1. Setup a previous version database (Schema Version 4) with real customer data
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

  // 2. Perform APK Upgrade / Database Re-initialization to Schema Version 5
  const upgradedDb = new LocalDatabase(dbKey, driver);
  await upgradedDb.init();

  // 3. Verify Version Bump
  assert.equal(upgradedDb.getSchemaVersion(), 5, 'Database must be upgraded to version 5');

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
