import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { SimulatedGoogleDriveTransport, RealGoogleDriveTransport } from '../drive/transport';
import { GoogleAuthManager } from '../auth/googleAuth';
import { SyncOrchestrator } from '../sync/orchestrator';
import { generateUUID, buildExpenseJournal } from '../domain/journal';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import { SyncOperation, SyncBatch } from '../contracts/types';

// ============================================================================
// 1. Multiple Concurrent Writes: Serialized Queue Durability
// ============================================================================

test('Multiple concurrent writes: serialized FIFO queue captures all mutations without stale overwrites', async () => {
  const driver = new LocalStorageFallbackDriver();
  const db = new LocalDatabase('test_db_concurrent_writes', driver);
  const wsId = 'ws-personal-default';

  // Issue 15 concurrent asynchronous mutations simultaneously
  const writePromises: Promise<any>[] = [];
  for (let i = 0; i < 15; i++) {
    writePromises.push(
      (async () => {
        db.createCategory(wsId, `Category ${i}`, 'expense');
        db.createParty(wsId, `Party ${i}`, 'partner');
        return await db.persist();
      })()
    );
  }

  // All concurrent writes must resolve without throwing
  await Promise.all(writePromises);
  await db.waitForPendingWrites();

  // Invariant: all 15 categories and 15 parties must be in the database and in driver
  const cats = db.getCategories(wsId);
  const parties = db.getParties(wsId);
  for (let i = 0; i < 15; i++) {
    assert.ok(cats.some((c) => c.name === `Category ${i}`), `Category ${i} must exist in database`);
    assert.ok(parties.some((p) => p.name === `Party ${i}`), `Party ${i} must exist in database`);
  }

  // Verify driver snapshot actually contains all 15 categories
  const persistedRaw = await driver.getItem('test_db_concurrent_writes');
  assert.ok(persistedRaw, 'Persisted raw data must exist in driver');
  const parsed = JSON.parse(persistedRaw);
  for (let i = 0; i < 15; i++) {
    assert.ok(
      parsed.categories.some(([_, c]: [string, any]) => c.name === `Category ${i}`),
      `Category ${i} must be durably stored in driver snapshot`
    );
  }
});

// ============================================================================
// 2. Interrupted Commits and Error Recovery
// ============================================================================

test('Interrupted commits: queue propagates failure and recovers on subsequent writes', async () => {
  const driver = new LocalStorageFallbackDriver();
  const db = new LocalDatabase('test_db_interrupted_queue', driver);
  const wsId = 'ws-personal-default';

  // Arm fault injection to simulate disk I/O interruption
  driver.faultInjection = 'throw_on_write';

  // Attempting persist must reject
  await assert.rejects(
    async () => {
      db.createCategory(wsId, 'Failing Category', 'expense');
      await db.persist();
    },
    /fault injection/,
    'Persist must reject when durable driver write fails'
  );

  // Invariant: lastPersistenceError is recorded
  assert.ok(db.getLastPersistenceError(), 'lastPersistenceError must be recorded');

  // Disarm fault injection (simulating disk space freed / connection restored)
  driver.faultInjection = 'none';

  // Next write must succeed, clear lastPersistenceError, and commit cleanly
  db.createCategory(wsId, 'Recovered Category', 'expense');
  await db.persist();
  await db.waitForPendingWrites();

  assert.equal(db.getLastPersistenceError(), null, 'lastPersistenceError must be cleared after successful write');
  assert.ok(db.getCategories(wsId).some((c) => c.name === 'Recovered Category'));
});

// ============================================================================
// 3. OAuth HTTP 401 Recovery: Forces Legitimate Renewal
// ============================================================================

test('OAuth HTTP 401 recovery: forces legitimate renewal rather than returning cached unexpired token', async () => {
  let renewCallCount = 0;
  let forceRenewFlags: boolean[] = [];

  const mockTokenProvider = async (forceRenew?: boolean) => {
    renewCallCount++;
    forceRenewFlags.push(Boolean(forceRenew));
    return `fresh-token-${renewCallCount}`;
  };

  let fetchCallCount = 0;
  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    fetchCallCount++;
    const authHeader = (init?.headers as Record<string, string>)?.['Authorization'];

    // First call has initial token -> rejected by Google with 401 (e.g. revoked on server)
    if (fetchCallCount === 1) {
      assert.equal(authHeader, 'Bearer initial-token');
      return new Response(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Second call must have renewed fresh token
    if (fetchCallCount === 2) {
      assert.equal(authHeader, 'Bearer fresh-token-1');
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  const transport = new RealGoogleDriveTransport('initial-token', {
    customFetch: mockFetch,
    tokenProvider: mockTokenProvider,
  });

  const files = await transport.listAppDataFiles();
  assert.equal(files.length, 0);
  assert.equal(renewCallCount, 1, 'tokenProvider must be called once on 401');
  assert.equal(forceRenewFlags[0], true, 'tokenProvider must be called with forceRenew=true');
  assert.equal(fetchCallCount, 2, 'fetch must retry with the fresh token');
});

// ============================================================================
// 4. OAuth Infinite Retry Loop Prevention
// ============================================================================

test('OAuth infinite retry loop prevention: 401 with failing renewal stops after 1 attempt', async () => {
  let renewCallCount = 0;
  let fetchCallCount = 0;

  const mockTokenProvider = async (forceRenew?: boolean) => {
    renewCallCount++;
    return 'still-invalid-token';
  };

  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    fetchCallCount++;
    // Always return 401 Unauthorized
    return new Response(JSON.stringify({ error: { code: 401, message: 'Unauthorized' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const transport = new RealGoogleDriveTransport('initial-token', {
    customFetch: mockFetch,
    tokenProvider: mockTokenProvider,
  });

  // Must reject with 401 error and NOT enter an infinite loop!
  await assert.rejects(
    async () => {
      await transport.listAppDataFiles();
    },
    /401 Unauthorized/,
    'Must fail with 401 Unauthorized when renewed token is also rejected'
  );

  // Exactly 2 fetch attempts (initial + 1 retry) and 1 renewal attempt
  assert.equal(renewCallCount, 1, 'Must not attempt renewal more than once per request');
  assert.equal(fetchCallCount, 2, 'Must not retry fetch more than once on 401');
});

// ============================================================================
// 5. Account Switching Prevention on Token Renewal
// ============================================================================

test('Account switching prevention on renewal: rejects token belonging to different Google account', async () => {
  const auth = new GoogleAuthManager();
  // Set initial authenticated user profile
  await auth.setTestProfileForTesting('alice@example.com', 'Alice');
  const aliceHash = auth.getProfile()?.subjectHash;
  assert.ok(aliceHash);

  // Simulate user switching accounts in Google prompt during renewal
  auth.simulatedRenewSubjectHash = 'foreign-attacker-subject-hash';

  // Silent renewal must detect mismatched identity and reject
  await assert.rejects(
    async () => {
      await auth.renewAccessTokenSilent();
    },
    /does not match dataset owner/,
    'Must reject token renewal if renewed account identity mismatches dataset owner'
  );
});

// ============================================================================
// 6. Strict Remote Batch Verification in Production
// ============================================================================

test('Remote batch verification: rejects corrupted hash, missing owner, and foreign owner in production', async () => {
  const origEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    SimulatedGoogleDriveTransport.clearSharedCloud();

    const db = new LocalDatabase('test_db_batch_verification');
    db.seedDefaultEntities();
    db.setDeviceIdentity('dev-alice', 'Alice Device');
    db.setIdentity('owner-alice-hash');

    // Create a mock transport pre-loaded with malicious/corrupted files
    const validOpId = generateUUID();
    const journal = buildExpenseJournal({
      workspaceId: 'ws-personal-default',
      assetAccountId: 'acc-cash-1',
      expenseCategoryId: 'cat-food',
      amountMinor: '10000',
      effectiveDate: '2026-10-23',
      opId: validOpId,
    });

    const op: SyncOperation = {
      protocolVersion: 1,
      ownerHash: 'owner-alice-hash',
      deviceId: 'dev-alice',
      seq: 1,
      operationId: validOpId,
      entityId: journal.transaction.id,
      type: 'journal.post',
      createdAtUtc: new Date().toISOString(),
      payload: { balancedJournal: journal },
      contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })),
    };

    // File 1: Missing ownerHash
    const unownedBatch = {
      protocolVersion: 1 as const,
      ownerHash: '',
      deviceId: 'dev-bob',
      batchId: generateUUID(),
      fromSeq: 1,
      toSeq: 1,
      operations: [op],
      batchSha256: 'some-hash',
      byteLength: 100,
      createdAtUtc: new Date().toISOString(),
    };

    // File 2: Foreign owner
    const foreignBatch = {
      protocolVersion: 1 as const,
      ownerHash: 'foreign-mallory-hash',
      deviceId: 'dev-mallory',
      batchId: generateUUID(),
      fromSeq: 1,
      toSeq: 1,
      operations: [{ ...op, ownerHash: 'foreign-mallory-hash' }],
      batchSha256: 'hash2',
      byteLength: 100,
      createdAtUtc: new Date().toISOString(),
    };

    // File 3: Corrupted hash
    const corruptedBatch = {
      protocolVersion: 1 as const,
      ownerHash: 'owner-alice-hash',
      deviceId: 'dev-alice',
      batchId: generateUUID(),
      fromSeq: 1,
      toSeq: 1,
      operations: [op],
      batchSha256: 'invalid-sha256-hash',
      byteLength: 100,
      createdAtUtc: new Date().toISOString(),
    };

    const filesMap = new Map<string, string>([
      ['f-unowned', JSON.stringify(unownedBatch)],
      ['f-foreign', JSON.stringify(foreignBatch)],
      ['f-corrupt', JSON.stringify(corruptedBatch)],
    ]);

    const mockTransport = {
      listAppDataFiles: async () => [
        { id: 'f-unowned', name: 'hsc-v1-ops-dev-bob-000000000001-000000000001-batch1.json', mimeType: 'application/json' },
        { id: 'f-foreign', name: 'hsc-v1-ops-dev-mallory-000000000001-000000000001-batch2.json', mimeType: 'application/json' },
        { id: 'f-corrupt', name: 'hsc-v1-ops-dev-alice-000000000001-000000000001-batch3.json', mimeType: 'application/json' },
      ],
      downloadBatchFile: async (id: string) => filesMap.get(id) || '{}',
      uploadBatchFile: async () => ({ fileId: '1', name: '1' }),
      getQuotaStatus: async () => ({ usedBytes: 0, totalBytes: 1000, isFull: false }),
    };

    const sync = new SyncOrchestrator(db, mockTransport as any);
    await sync.triggerSync();

    // Invariant: None of the invalid/foreign batches were applied
    assert.equal(db.getTransactions('ws-personal-default').length, 0, 'No corrupt or foreign transaction should be applied');
    assert.equal(db.getRawState().appliedOperations.size, 0, 'No corrupt operations marked applied');
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

// ============================================================================
// 7. Safe First-Device and New-Device Bootstrap and Restore Procedure
// ============================================================================

test('Safe bootstrap and restore: verifies Google owner identity and restores dataset onto fresh device', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();
  const transport = new SimulatedGoogleDriveTransport();

  const ownerHash = 'verified-google-user-hash';
  const wsId = 'ws-personal-default';

  // Step 1: Device 1 records transactions and syncs to cloud
  const dbDevice1 = new LocalDatabase('test_db_bootstrap_dev1');
  dbDevice1.seedDefaultEntities();
  dbDevice1.setDeviceIdentity('dev-1', 'Device 1');
  dbDevice1.setIdentity(ownerHash, 'Alice');

  const syncDevice1 = new SyncOrchestrator(dbDevice1, transport);
  const opId = generateUUID();
  const journal = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: 'acc-cash-1',
    expenseCategoryId: 'cat-food',
    amountMinor: '25000',
    effectiveDate: '2026-10-23',
    note: 'Initial food expense on Device 1',
    opId,
  });

  const op: SyncOperation = {
    protocolVersion: 1,
    ownerHash,
    deviceId: 'dev-1',
    seq: 1,
    operationId: opId,
    entityId: journal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })),
  };

  await dbDevice1.commitJournalWithOutbox(journal, op);
  await syncDevice1.triggerSync();

  // Invariant: Device 1 uploaded the batch to cloud
  const cloudFiles = await transport.listAppDataFiles();
  assert.equal(cloudFiles.length, 1, 'Cloud must contain 1 batch file from Device 1');

  // Step 2: Fresh Device 2 bootstraps and restores from Google Drive
  const dbDevice2Fresh = new LocalDatabase('test_db_bootstrap_dev2');
  dbDevice2Fresh.seedDefaultEntities();
  dbDevice2Fresh.setDeviceIdentity('dev-2', 'Device 2 (Fresh Phone)');

  const syncDevice2 = new SyncOrchestrator(dbDevice2Fresh, transport);

  // Authenticated profile obtained from Google login
  const verifiedProfile = {
    subjectId: 'google-sub-alice',
    subjectHash: ownerHash,
    email: 'alice@gmail.com',
    displayName: 'Alice',
    isDriveAuthorized: true,
  };

  // Perform safe bootstrap and restore
  await syncDevice2.bootstrapAndRestore(verifiedProfile);

  // Invariant: Fresh device restored Device 1's transaction cleanly
  const restoredTxs = dbDevice2Fresh.getTransactions(wsId);
  assert.equal(restoredTxs.length, 1, 'Device 2 must have restored the transaction');
  assert.equal(restoredTxs[0].id, journal.transaction.id, 'Transaction ID must match');
  assert.equal(restoredTxs[0].note, 'Initial food expense on Device 1');
  assert.equal(dbDevice2Fresh.getIdentity()?.ownerSubjectHash, ownerHash, 'Verified owner must be established on device');
});

// ============================================================================
// 8. Drive Duplicate Retries: Verified Remote Batch Idempotency
// ============================================================================

test('Drive duplicate retries: idempotent upload prevention with verified immutable batch', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();
  const transport = new SimulatedGoogleDriveTransport();

  const db = new LocalDatabase('test_db_dup_retries');
  db.seedDefaultEntities();
  db.setDeviceIdentity('dev-dup-retry', 'Device Retry Test');
  db.setIdentity('owner-dup-test');

  const sync = new SyncOrchestrator(db, transport);
  const wsId = 'ws-personal-default';
  const opId = generateUUID();

  const journal = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: 'acc-cash-1',
    expenseCategoryId: 'cat-food',
    amountMinor: '45000',
    effectiveDate: '2026-10-23',
    opId,
  });

  const op: SyncOperation = {
    protocolVersion: 1,
    ownerHash: 'owner-dup-test',
    deviceId: 'dev-dup-retry',
    seq: 1,
    operationId: opId,
    entityId: journal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })),
  };

  await db.commitJournalWithOutbox(journal, op);

  // Initial sync uploads the batch
  await sync.triggerSync();
  const filesFirst = await transport.listAppDataFiles();
  assert.equal(filesFirst.length, 1, 'First sync must upload exactly 1 file');
  assert.equal(db.getPendingOutbox().length, 0, 'Outbox must be empty');

  // Simulate network retry where local outbox status was reset to pending (e.g. process crash before local DB persist)
  db.getRawState().syncOutbox.get(opId)!.uploadedStatus = 'pending';
  assert.equal(db.getPendingOutbox().length, 1, 'Pending outbox simulated for retry');

  // Re-trigger sync: must detect remote verified duplicate and NOT upload a 2nd file!
  await sync.triggerSync();

  const filesSecond = await transport.listAppDataFiles();
  assert.equal(filesSecond.length, 1, 'No duplicate file should be uploaded to Drive');
  assert.equal(db.getPendingOutbox().length, 0, 'Pending outbox must be cleanly marked uploaded');
});
