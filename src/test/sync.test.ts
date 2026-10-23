import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import { LocalDatabase } from '../storage/db';
import { SimulatedGoogleDriveTransport, RealGoogleDriveTransport } from '../drive/transport';
import { SyncOrchestrator } from '../sync/orchestrator';
import {
  buildIncomeJournal,
  buildExpenseJournal,
  buildTransferJournal,
  buildReversalJournal,
  generateUUID,
} from '../domain/journal';
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

  // Net movement: +90000 - 35000 = +55000 paisa (৳550.00). Clean slate starting balance 0 paisa -> 55000 paisa
  assert.equal(cashA?.currentBalanceMinor, '55000');
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

test('Google Drive Sync: Dataset owner identity mismatch rejection', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();

  // Device A is registered to owner-alice
  const dbA = new LocalDatabase('test_db_owner_alice');
  dbA.seedDefaultEntities();
  dbA.setDeviceIdentity('dev-alice', 'Alice Phone');
  dbA.setIdentity('owner-alice-hash', 'alice@gmail.com');
  const transportA = new SimulatedGoogleDriveTransport();
  const syncA = new SyncOrchestrator(dbA, transportA);

  // Pre-seed cloud with a batch from a different owner (owner-mallory-hash)
  const opMalloryId = generateUUID();
  const journalMallory = buildIncomeJournal({
    workspaceId: 'ws-personal-default',
    assetAccountId: 'acc-cash-1',
    revenueCategoryId: 'cat-salary',
    amountMinor: '500000',
    effectiveDate: '2026-10-22',
    opId: opMalloryId,
  });
  const malloryBatchData = {
    protocolVersion: 1 as const,
    ownerHash: 'owner-mallory-hash',
    deviceId: 'dev-mallory',
    batchId: generateUUID(),
    fromSeq: 1,
    toSeq: 1,
    operations: [
      {
        protocolVersion: 1 as const,
        ownerHash: 'owner-mallory-hash',
        deviceId: 'dev-mallory',
        seq: 1,
        operationId: opMalloryId,
        entityId: journalMallory.transaction.id,
        type: 'journal.post' as const,
        createdAtUtc: new Date().toISOString(),
        payload: { balancedJournal: journalMallory },
        contentSha256: await computeSha256(canonicalJson({ balancedJournal: journalMallory })),
      },
    ],
    createdAtUtc: new Date().toISOString(),
  };
  const mallorySha = await SyncOrchestrator.computeBatchHash(malloryBatchData);
  const malloryFullBatch = {
    ...malloryBatchData,
    batchSha256: mallorySha,
    byteLength: 200,
  };
  await transportA.uploadBatchFile(
    `hsc-v1-ops-dev-mallory-000000000001-000000000001-${malloryBatchData.batchId}.json`,
    JSON.stringify(malloryFullBatch)
  );

  // Alice triggers sync
  await syncA.triggerSync();

  // Assert Alice's database rejected Mallory's foreign batch
  const aliceTxs = dbA.getTransactions('ws-personal-default');
  assert.equal(aliceTxs.length, 0, 'Foreign owner transactions must be rejected and not imported');
  assert.equal(
    dbA.getRawState().appliedOperations.has(opMalloryId),
    false,
    'Foreign operation ID must not be recorded as applied'
  );
});

test('Google Drive Sync: Duplicate batch upload prevention', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();

  const db = new LocalDatabase('test_db_dup_prevent');
  db.seedDefaultEntities();
  db.setDeviceIdentity('dev-dup-test', 'Device Dup Test');
  db.setIdentity('owner-dup-test');
  const transport = new SimulatedGoogleDriveTransport();
  const sync = new SyncOrchestrator(db, transport);

  const wsId = 'ws-personal-default';
  const opId = generateUUID();
  const journal = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: 'acc-cash-1',
    expenseCategoryId: 'cat-food',
    amountMinor: '15000',
    effectiveDate: '2026-10-22',
    opId,
  });
  const op: SyncOperation = {
    protocolVersion: 1,
    ownerHash: 'owner-dup-test',
    deviceId: 'dev-dup-test',
    seq: 1,
    operationId: opId,
    entityId: journal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })),
  };
  await db.commitJournalWithOutbox(journal, op);

  // Step 1: Verify that a file with matching sequence prefix but MISMATCHED / corrupted content
  // is NOT accepted as duplicate!
  const mismatchedFileName = `hsc-v1-ops-dev-dup-test-000000000001-000000000001-corrupt-uuid.json`;
  await transport.uploadBatchFile(mismatchedFileName, JSON.stringify({ corrupt: true }));

  // Step 2: Upload the verified matching batch to Drive (as if an earlier upload completed before receipt)
  const matchingBatchId = generateUUID();
  const batchData = {
    protocolVersion: 1 as const,
    ownerHash: 'owner-dup-test',
    deviceId: 'dev-dup-test',
    batchId: matchingBatchId,
    fromSeq: 1,
    toSeq: 1,
    operations: [op],
    createdAtUtc: new Date().toISOString(),
  };
  const batchSha256 = await SyncOrchestrator.computeBatchHash(batchData);
  const fullBatch = {
    ...batchData,
    batchSha256,
    byteLength: JSON.stringify(batchData).length,
  };
  const verifiedFileName = `hsc-v1-ops-dev-dup-test-000000000001-000000000001-${matchingBatchId}.json`;
  await transport.uploadBatchFile(verifiedFileName, JSON.stringify(fullBatch, null, 2));

  const filesBefore = await transport.listAppDataFiles();
  assert.equal(filesBefore.length, 2);

  // Trigger sync on device:
  // Must verify remote content and hash against the matching batch, and mark outbox uploaded without uploading a 3rd file!
  await sync.triggerSync();

  assert.equal(db.getPendingOutbox().length, 0, 'Pending outbox must be marked uploaded');
  const filesAfter = await transport.listAppDataFiles();
  assert.equal(filesAfter.length, 2, 'No duplicate file should have been uploaded');
});

test('Google Drive Sync: Interrupted upload maintains pending outbox and recovers on retry', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();

  const db = new LocalDatabase('test_db_interrupted');
  db.seedDefaultEntities();
  db.setDeviceIdentity('dev-interrupted', 'Device Interrupted');
  const transport = new SimulatedGoogleDriveTransport();
  const sync = new SyncOrchestrator(db, transport);

  const wsId = 'ws-personal-default';
  const opId = generateUUID();
  const journal = buildIncomeJournal({
    workspaceId: wsId,
    assetAccountId: 'acc-cash-1',
    revenueCategoryId: 'cat-salary',
    amountMinor: '250000',
    effectiveDate: '2026-10-22',
    opId,
  });
  const op: SyncOperation = {
    protocolVersion: 1,
    ownerHash: 'owner-test',
    deviceId: 'dev-interrupted',
    seq: db.getNextDeviceSeq(),
    operationId: opId,
    entityId: journal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })),
  };
  await db.commitJournalWithOutbox(journal, op);

  assert.equal(db.getPendingOutbox().length, 1, 'Initial outbox must have 1 pending op');

  // Inject upload interruption fault
  transport.simulateFault = 'upload_interrupted';
  await sync.triggerSync();

  // Outbox MUST remain pending because upload did not complete!
  assert.equal(
    db.getPendingOutbox().length,
    1,
    'Outbox must remain pending after interrupted upload'
  );
  const statusAfterFault = sync.getStatus();
  assert.equal(
    statusAfterFault.state,
    'error_retryable',
    'Sync status must reflect retryable error'
  );

  // Clear fault and trigger sync again
  transport.simulateFault = 'none';
  await sync.triggerSync();

  // Outbox is now uploaded and verified
  assert.equal(db.getPendingOutbox().length, 0, 'Outbox must be empty after successful recovery');
  assert.equal(sync.getStatus().state, 'synced_verified');
});

test('Cross-platform sync: 3-device simulation (Android Phone, Android Tablet, Web Browser) eventual convergence', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();
  const ownerHash = 'owner-sha-user-family-123';
  const wsId = 'ws-personal-default';
  const accCash = 'acc-cash-1';
  const accBank = 'acc-bank-1';

  // Device 1: Android Phone (Redmi Note)
  const dbPhone = new LocalDatabase('test_db_dev_phone');
  dbPhone.seedDefaultEntities();
  dbPhone.setDeviceIdentity('dev-android-phone', 'Redmi Note 12');
  dbPhone.setIdentity(ownerHash);
  const transportPhone = new SimulatedGoogleDriveTransport();
  const syncPhone = new SyncOrchestrator(dbPhone, transportPhone);

  // Device 2: Android Tablet (Galaxy Tab)
  const dbTablet = new LocalDatabase('test_db_dev_tablet');
  dbTablet.seedDefaultEntities();
  dbTablet.setDeviceIdentity('dev-android-tablet', 'Galaxy Tab S9');
  dbTablet.setIdentity(ownerHash);
  const transportTablet = new SimulatedGoogleDriveTransport();
  const syncTablet = new SyncOrchestrator(dbTablet, transportTablet);

  // Device 3: Web Browser (Chrome Desktop)
  const dbWeb = new LocalDatabase('test_db_dev_web');
  dbWeb.seedDefaultEntities();
  dbWeb.setDeviceIdentity('dev-web-desktop', 'Chrome Desktop (Windows)');
  dbWeb.setIdentity(ownerHash);
  const transportWeb = new SimulatedGoogleDriveTransport();
  const syncWeb = new SyncOrchestrator(dbWeb, transportWeb);

  // Step 1: All 3 devices go offline and perform concurrent independent operations
  syncPhone.setOnline(false);
  syncTablet.setOnline(false);
  syncWeb.setOnline(false);

  // Phone: Income ৳5,000 (500000 paisa)
  const phoneOpId = generateUUID();
  const phoneJournal = buildIncomeJournal({
    workspaceId: wsId,
    assetAccountId: accCash,
    revenueCategoryId: 'cat-salary',
    amountMinor: '500000',
    effectiveDate: '2026-10-23',
    note: 'Salary received via Phone',
    opId: phoneOpId,
  });
  const phoneOp: SyncOperation = {
    protocolVersion: 1,
    ownerHash,
    deviceId: 'dev-android-phone',
    seq: dbPhone.getNextDeviceSeq(),
    operationId: phoneOpId,
    entityId: phoneJournal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: phoneJournal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: phoneJournal })),
  };
  await dbPhone.commitJournalWithOutbox(phoneJournal, phoneOp);

  // Tablet: Expense ৳1,200 (120000 paisa)
  const tabletOpId = generateUUID();
  const tabletJournal = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: accCash,
    expenseCategoryId: 'cat-groceries',
    amountMinor: '120000',
    effectiveDate: '2026-10-23',
    note: 'Groceries purchased via Tablet',
    opId: tabletOpId,
  });
  const tabletOp: SyncOperation = {
    protocolVersion: 1,
    ownerHash,
    deviceId: 'dev-android-tablet',
    seq: dbTablet.getNextDeviceSeq(),
    operationId: tabletOpId,
    entityId: tabletJournal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: tabletJournal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: tabletJournal })),
  };
  await dbTablet.commitJournalWithOutbox(tabletJournal, tabletOp);

  // Web Browser: Transfer ৳2,000 (200000 paisa) with ৳25 (2500 paisa) transfer fee from Cash to Bank
  const webOpId = generateUUID();
  const webJournal = buildTransferJournal({
    workspaceId: wsId,
    fromAssetAccountId: accCash,
    toAssetAccountId: accBank,
    amountMinor: '200000',
    feeMinor: '2500',
    feeExpenseCategoryId: 'cat-food',
    effectiveDate: '2026-10-23',
    note: 'Online Transfer Cash to Bank via Web',
    opId: webOpId,
  });
  const webOp: SyncOperation = {
    protocolVersion: 1,
    ownerHash,
    deviceId: 'dev-web-desktop',
    seq: dbWeb.getNextDeviceSeq(),
    operationId: webOpId,
    entityId: webJournal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: webJournal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: webJournal })),
  };
  await dbWeb.commitJournalWithOutbox(webJournal, webOp);

  // Step 2: All 3 devices come online and sync in rounds until fully propagated
  syncPhone.setOnline(true);
  syncTablet.setOnline(true);
  syncWeb.setOnline(true);

  // Round 1: Each uploads their batch and downloads what's available
  await syncPhone.triggerSync();
  await syncTablet.triggerSync();
  await syncWeb.triggerSync();

  // Round 2: Propagate all remote batches to all peers
  await syncPhone.triggerSync();
  await syncTablet.triggerSync();
  await syncWeb.triggerSync();

  // Step 3: Verify eventual convergence on all 3 platforms
  const txsPhone = dbPhone.getTransactions(wsId);
  const txsTablet = dbTablet.getTransactions(wsId);
  const txsWeb = dbWeb.getTransactions(wsId);

  assert.equal(txsPhone.length, 3, 'Phone must have all 3 transactions');
  assert.equal(txsTablet.length, 3, 'Tablet must have all 3 transactions');
  assert.equal(txsWeb.length, 3, 'Web must have all 3 transactions');

  // Verify financial balance convergence:
  // Expected Cash: 0 + 500000 (Income) - 120000 (Expense) - 200000 (Transfer) - 2500 (Fee) = 177500 paisa
  // Expected Bank: 0 + 200000 (Transfer) = 200000 paisa
  const summariesPhone = dbPhone.calculateAccountSummaries(wsId);
  const summariesTablet = dbTablet.calculateAccountSummaries(wsId);
  const summariesWeb = dbWeb.calculateAccountSummaries(wsId);

  const cashPhone = summariesPhone.find((s) => s.accountId === accCash)?.currentBalanceMinor;
  const cashTablet = summariesTablet.find((s) => s.accountId === accCash)?.currentBalanceMinor;
  const cashWeb = summariesWeb.find((s) => s.accountId === accCash)?.currentBalanceMinor;

  const bankPhone = summariesPhone.find((s) => s.accountId === accBank)?.currentBalanceMinor;
  const bankTablet = summariesTablet.find((s) => s.accountId === accBank)?.currentBalanceMinor;
  const bankWeb = summariesWeb.find((s) => s.accountId === accBank)?.currentBalanceMinor;

  assert.equal(cashPhone, '177500', 'Cash on Phone must be exactly 177500 paisa (৳1,775.00)');
  assert.equal(cashTablet, '177500', 'Cash on Tablet must be exactly 177500 paisa (৳1,775.00)');
  assert.equal(cashWeb, '177500', 'Cash on Web must be exactly 177500 paisa (৳1,775.00)');

  assert.equal(bankPhone, '200000', 'Bank on Phone must be exactly 200000 paisa (৳2,000.00)');
  assert.equal(bankTablet, '200000', 'Bank on Tablet must be exactly 200000 paisa (৳2,000.00)');
  assert.equal(bankWeb, '200000', 'Bank on Web must be exactly 200000 paisa (৳2,000.00)');

  // Step 4: Verify ledger and trial balance integrity across all 3 platforms
  const auditPhone = dbPhone.verifyLedgerIntegrity(wsId);
  const auditTablet = dbTablet.verifyLedgerIntegrity(wsId);
  const auditWeb = dbWeb.verifyLedgerIntegrity(wsId);

  assert.equal(auditPhone.isValid, true);
  assert.equal(auditPhone.trialBalanceMatched, true);
  assert.equal(auditTablet.isValid, true);
  assert.equal(auditTablet.trialBalanceMatched, true);
  assert.equal(auditWeb.isValid, true);
  assert.equal(auditWeb.trialBalanceMatched, true);
});

test('RealGoogleDriveTransport: Pagination across multiple pages and retry on 429 backoff', async () => {
  let callCount = 0;
  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    callCount++;
    const urlStr = String(input);

    // Call 1: Simulate 429 Rate Limit error on first attempt
    if (callCount === 1) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Call 2: Retry succeeds with Page 1 containing nextPageToken
    if (callCount === 2) {
      return new Response(
        JSON.stringify({
          files: [{ id: 'f-page-1', name: 'hsc-v1-ops-batch1.json', mimeType: 'application/json' }],
          nextPageToken: 'token-page-2',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Call 3: Page 2 request using pageToken
    if (callCount === 3) {
      assert.ok(urlStr.includes('pageToken=token-page-2'), 'Must pass pageToken in pagination URL');
      return new Response(
        JSON.stringify({
          files: [{ id: 'f-page-2', name: 'hsc-v1-ops-batch2.json', mimeType: 'application/json' }],
          nextPageToken: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  const transport = new RealGoogleDriveTransport('test-access-token', {
    customFetch: mockFetch,
    initialRetryDelayMs: 1, // fast backoff for tests
  });

  const files = await transport.listAppDataFiles();
  assert.equal(files.length, 2, 'Must paginate and collect files from both pages');
  assert.equal(files[0].id, 'f-page-1');
  assert.equal(files[1].id, 'f-page-2');
  assert.equal(callCount, 3, 'Must have executed 3 calls (1 initial 429 + 1 retry page 1 + 1 page 2)');
});
