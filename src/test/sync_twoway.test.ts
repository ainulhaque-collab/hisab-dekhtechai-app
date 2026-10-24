import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import { SyncOrchestrator } from '../sync/orchestrator';
import { GoogleAuthManager, computeOwnerSubjectHash } from '../auth/googleAuth';
import {
  buildIncomeJournal,
  buildExpenseJournal,
  generateUUID,
} from '../domain/journal';
import { BalancedJournal, SyncOperation } from '../contracts/types';
import { canonicalJson, computeSha256 } from '../sync/canonical';

async function commitTxHelper(
  db: LocalDatabase,
  journal: BalancedJournal,
  ownerHash: string,
  deviceId: string
) {
  const opId = generateUUID();
  const op: SyncOperation = {
    protocolVersion: 1,
    ownerHash,
    deviceId,
    seq: db.getNextDeviceSeq(),
    operationId: opId,
    entityId: journal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })),
  };
  await db.commitJournalWithOutbox(journal, op);
  return op;
}

test('BUG-004: Real Two-Way Synchronization Roundtrip between Android and Web', async () => {
  // Shared remote Google Drive storage simulator (represents user's private drive.appdata)
  const sharedTransport = new SimulatedGoogleDriveTransport();

  // Test Google owner credentials
  const ownerSub = 'google-owner-unique-999';
  const ownerHash = await computeOwnerSubjectHash(ownerSub);
  const ownerEmail = 'hisab.owner@gmail.com';

  const wsId = 'ws-personal-default';

  // 1. Android Device Setup
  const androidDriver = new LocalStorageFallbackDriver();
  const androidDb = new LocalDatabase('db_android_phone', androidDriver);
  await androidDb.init();

  const androidSync = new SyncOrchestrator(androidDb, sharedTransport);
  const androidAuth = new GoogleAuthManager();
  const androidProfile = await androidAuth.setTestProfileForTesting(ownerEmail, 'Hisab Owner', ownerSub, 'token-android-123');
  await androidSync.bootstrapAndRestore(androidProfile);

  // 2. Android creates an account and goes OFFLINE
  const androidCash = androidDb.createAccount(wsId, 'Pocket Cash', 'cash', '10000', '', 'asset', null);
  androidSync.setOnline(false);

  // 3. Android adds an Expense while OFFLINE (e.g. Lunch expense: 2,500 paisa)
  const cats = androidDb.getCategories(wsId);
  const lunchJournal = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: androidCash.id,
    expenseCategoryId: cats[0].id,
    amountMinor: '2500',
    effectiveDate: '2026-10-24',
    note: 'Offline Lunch with client',
    opId: generateUUID(),
  });
  await commitTxHelper(androidDb, lunchJournal, ownerHash, 'device-android-phone');

  // Verify operations are queued in Android outbox waiting for connectivity (account.create + journal.post)
  assert.equal(androidDb.getPendingOutbox().length, 2, 'Android outbox must have 2 pending operations');

  // 4. Android comes ONLINE and syncs to Google Drive
  androidSync.setOnline(true);
  await androidSync.triggerSync();
  assert.equal(androidDb.getPendingOutbox().length, 0, 'Android outbox must be empty after sync');

  // 5. Web App Setup (Same Google Owner Identity)
  const webDriver = new LocalStorageFallbackDriver();
  const webDb = new LocalDatabase('db_web_laptop', webDriver);
  await webDb.init();

  const webSync = new SyncOrchestrator(webDb, sharedTransport);
  const webAuth = new GoogleAuthManager();
  const webProfile = await webAuth.setTestProfileForTesting(ownerEmail, 'Hisab Owner', ownerSub, 'token-web-456');
  await webSync.bootstrapAndRestore(webProfile);

  // Web synchronizes from Google Drive
  await webSync.triggerSync();

  // 6. Verify Web received Android transaction
  const webTxs = webDb.getTransactions(wsId);
  assert.ok(
    webTxs.some((t) => t.id === lunchJournal.transaction.id),
    'Web must have received the offline lunch transaction from Android'
  );

  // 7. Web creates a DIFFERENT transaction (Income: 12,000 paisa) and syncs
  const consultingJournal = buildIncomeJournal({
    workspaceId: wsId,
    assetAccountId: androidCash.id,
    revenueCategoryId: cats[1]?.id || cats[0].id,
    amountMinor: '12000',
    effectiveDate: '2026-10-24',
    note: 'Web Consulting Payment',
    opId: generateUUID(),
  });
  await commitTxHelper(webDb, consultingJournal, ownerHash, 'device-web-laptop');

  await webSync.triggerSync();

  // 8. Android synchronizes again to receive Web transaction
  await androidSync.triggerSync();

  // 9. RECONCILIATION VERIFICATION: Android and Web must match perfectly!
  const androidFinalTxs = androidDb.getTransactions(wsId);
  const webFinalTxs = webDb.getTransactions(wsId);

  assert.equal(
    androidFinalTxs.length,
    webFinalTxs.length,
    'Both devices must have the exact same transaction count'
  );

  const androidDashboard = androidDb.getDashboardData(wsId);
  const webDashboard = webDb.getDashboardData(wsId);

  assert.equal(
    androidDashboard?.totalConsolidatedBalanceMinor,
    webDashboard?.totalConsolidatedBalanceMinor,
    'Both devices must have identical consolidated balance after two-way sync'
  );

  // 10. IDEMPOTENT REAPPLICATION: Re-syncing does not duplicate transactions
  await androidSync.triggerSync();
  await webSync.triggerSync();

  const androidAfterResyncTxs = androidDb.getTransactions(wsId);
  assert.equal(
    androidAfterResyncTxs.length,
    webFinalTxs.length,
    'Re-syncing must be strictly idempotent and never duplicate financial entries'
  );

  // Verify double-entry integrity on both devices
  assert.equal(androidDb.verifyLedgerIntegrity(wsId).isValid, true);
  assert.equal(webDb.verifyLedgerIntegrity(wsId).isValid, true);
});
