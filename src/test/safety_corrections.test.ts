import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { SimulatedGoogleDriveTransport, RealGoogleDriveTransport } from '../drive/transport';
import { GoogleAuthManager, computeOwnerSubjectHash } from '../auth/googleAuth';
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

test('Interrupted commits: queue propagates failure and preserves error until explicitly cleared', async () => {
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

  // Invariant: lastPersistenceError is preserved
  assert.ok(db.getLastPersistenceError(), 'lastPersistenceError must be recorded');

  // Disarm fault injection (simulating disk space freed / connection restored)
  driver.faultInjection = 'none';

  // Invariant: error is preserved until explicitly cleared
  await assert.rejects(
    async () => {
      await db.waitForPendingWrites();
    },
    /fault injection/,
    'waitForPendingWrites must rethrow preserved error'
  );

  // Explicitly clear handled error
  db.clearPersistenceError();

  // Next write must succeed and commit cleanly
  db.createCategory(wsId, 'Recovered Category', 'expense');
  await db.persist();
  await db.waitForPendingWrites();

  assert.equal(db.getLastPersistenceError(), null, 'lastPersistenceError must be null after explicit clear and successful write');
  assert.ok(db.getCategories(wsId).some((c) => c.name === 'Recovered Category'));
});

test('Serialized write queue: overlapping transactions blocked and persistence errors preserved until cleared', async () => {
  const driver = new LocalStorageFallbackDriver();
  const db = new LocalDatabase('test_db_tx_blocked_on_error', driver);
  const wsId = 'ws-personal-default';

  // 1. Arm fault injection to trigger storage failure
  driver.faultInjection = 'throw_on_write';
  await assert.rejects(async () => {
    db.createCategory(wsId, 'Failing Cat', 'expense');
    await db.persist();
  }, /fault injection/);

  assert.ok(db.getLastPersistenceError(), 'Error must be pending on database');

  // Attempting waitForPendingWrites must reject repeatedly due to preserved persistence error
  await assert.rejects(
    async () => {
      await db.waitForPendingWrites();
    },
    /fault injection/,
    'waitForPendingWrites must re-throw preserved error'
  );

  // Once explicitly cleared and disk freed
  driver.faultInjection = 'none';
  db.clearPersistenceError();

  // Transaction now proceeds cleanly
  await db.beginTransaction();
  db.createCategory(wsId, 'Clean Tx Cat', 'expense');

  // 2. Overlapping transaction attempt must be strictly blocked
  await assert.rejects(
    async () => {
      await db.beginTransaction();
    },
    /Transaction already in progress/,
    'Overlapping transaction must be blocked while another transaction is open'
  );

  await db.commitTransaction();
  await db.waitForPendingWrites();
  assert.equal(db.getLastPersistenceError(), null);
  assert.ok(db.getCategories(wsId).some((c) => c.name === 'Clean Tx Cat'));
});

// ============================================================================
// 3. OAuth HTTP 401 Recovery: Forces Legitimate Renewal
// ============================================================================

test('OAuth HTTP 401 recovery: forces legitimate renewal rather than returning cached unexpired token', async () => {
  let renewCallCount = 0;
  let forceRenewFlags: boolean[] = [];

  const mockTokenProvider = async (forceRenew?: boolean) => {
    if (!forceRenew) return 'initial-token';
    renewCallCount++;
    forceRenewFlags.push(Boolean(forceRenew));
    return `fresh-token-${renewCallCount}`;
  };

  let fetchCallCount = 0;
  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    fetchCallCount++;
    const authHeader = new Headers(init?.headers).get('Authorization');

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
    if (!forceRenew) return 'initial-token';
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

test('OAuth owner hash verification: canonical hash identical in login & renewal, same account succeeds, different account fails, unverified rejected', async () => {
  const googleSub = 'google-user-sub-998877';
  const canonicalHash = await computeOwnerSubjectHash(googleSub);
  assert.ok(canonicalHash, 'Canonical hash must be generated');

  const auth = new GoogleAuthManager();
  await auth.setTestProfileForTesting('alice@example.com', 'Alice', googleSub, 'initial-token');
  assert.equal(
    auth.getProfile()?.subjectHash,
    canonicalHash,
    'Initial login subjectHash must exactly match canonical computeOwnerSubjectHash'
  );

  // 1. Renewal with the SAME Google account succeeds
  auth.simulatedRenewSubjectHash = canonicalHash;
  const renewedToken = await auth.renewAccessTokenSilent();
  assert.ok(renewedToken.startsWith('renewed-simulated-token-'), 'Renewal with same account must succeed');

  // 2. Renewal with a DIFFERENT Google account fails
  const attackerSub = 'attacker-google-sub-666';
  const attackerHash = await computeOwnerSubjectHash(attackerSub);
  auth.simulatedRenewSubjectHash = attackerHash;

  await assert.rejects(
    async () => {
      await auth.renewAccessTokenSilent();
    },
    /does not match dataset owner/,
    'Must reject token renewal if renewed account identity mismatches dataset owner'
  );

  // 3. Renewal with UNVERIFIED userinfo fails
  auth.simulatedRenewSubjectHash = 'unverified';
  await assert.rejects(
    async () => {
      await auth.renewAccessTokenSilent();
    },
    /Failed to verify Google userinfo/,
    'Must reject token renewal when Google userinfo cannot be verified'
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

test('Safe bootstrap and restore: single owner enforcement, offline transaction preservation, and new-device restore', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();
  const transport = new SimulatedGoogleDriveTransport();
  const wsId = 'ws-personal-default';

  const aliceSub = 'google-alice-123';
  const aliceHash = await computeOwnerSubjectHash(aliceSub);
  const aliceProfile = {
    subjectId: aliceSub,
    subjectHash: aliceHash,
    email: 'alice@gmail.com',
    accessToken: 'test-alice-token',
    displayName: 'Alice',
    isDriveAuthorized: true,
  };

  const bobSub = 'google-bob-456';
  const bobHash = await computeOwnerSubjectHash(bobSub);
  const bobProfile = {
    subjectId: bobSub,
    subjectHash: bobHash,
    email: 'bob@gmail.com',
    accessToken: 'test-bob-token',
    displayName: 'Bob',
    isDriveAuthorized: true,
  };

  // Step 1: Device 1 records transactions OFFLINE before signing in
  const dbDevice1 = new LocalDatabase('test_db_bootstrap_dev1');
  dbDevice1.seedDefaultEntities();
  dbDevice1.setDeviceIdentity('dev-1', 'Device 1');

  const opId1 = generateUUID();
  const journal1 = buildExpenseJournal({
    workspaceId: wsId,
    assetAccountId: 'acc-cash-1',
    expenseCategoryId: 'cat-food',
    amountMinor: '25000',
    effectiveDate: '2026-10-23',
    note: 'Initial offline food expense on Device 1 before login',
    opId: opId1,
  });

  const op1: SyncOperation = {
    protocolVersion: 1,
    ownerHash: 'local-owner', // Created offline before Google sign-in
    deviceId: 'dev-1',
    seq: 1,
    operationId: opId1,
    entityId: journal1.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journal1 },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal1 })),
  };

  await dbDevice1.commitJournalWithOutbox(journal1, op1);
  assert.equal(dbDevice1.getTransactions(wsId).length, 1, 'Offline transaction exists before login');

  // Step 2: User signs in with Alice -> bootstrapAndRestore must PRESERVE offline transaction
  const syncDevice1 = new SyncOrchestrator(dbDevice1, transport);
  const restoreRes1 = await syncDevice1.bootstrapAndRestore(aliceProfile, true);
  assert.equal(restoreRes1.preservedOfflineOpsCount, 1, 'Offline transaction must be preserved and adopted');
  assert.equal(dbDevice1.getIdentity()?.ownerSubjectHash, aliceHash, 'Alice is now verified owner');

  // Invariant: Device 1 uploaded the adopted batch to cloud
  const cloudFiles = await transport.listAppDataFiles();
  assert.equal(cloudFiles.length, 1, 'Cloud must contain 1 batch file adopted from Device 1');

  // Step 3: Prevent silent reassignment: Bob attempts to sign in on Alice's device with non-empty dataset
  await assert.rejects(
    async () => {
      await syncDevice1.bootstrapAndRestore(bobProfile);
    },
    /Security Error: Cannot reassign existing non-empty dataset/,
    'Must block Bob from overwriting Alice dataset'
  );

  // Step 4: Fresh Device 2 bootstraps and restores from Google Drive
  const dbDevice2Fresh = new LocalDatabase('test_db_bootstrap_dev2');
  dbDevice2Fresh.seedDefaultEntities();
  dbDevice2Fresh.setDeviceIdentity('dev-2', 'Device 2 (Fresh Phone)');

  const syncDevice2 = new SyncOrchestrator(dbDevice2Fresh, transport);

  // Perform safe bootstrap and restore on fresh device
  await syncDevice2.bootstrapAndRestore(aliceProfile, true);

  // Invariant: Fresh device restored Device 1's transaction cleanly
  const restoredTxs = dbDevice2Fresh.getTransactions(wsId);
  assert.equal(restoredTxs.length, 1, 'Device 2 must have restored the transaction');
  assert.equal(restoredTxs[0].id, journal1.transaction.id, 'Transaction ID must match');
  assert.equal(restoredTxs[0].note, 'Initial offline food expense on Device 1 before login');
  assert.equal(dbDevice2Fresh.getIdentity()?.ownerSubjectHash, aliceHash, 'Verified owner must be established on fresh device');
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

// ============================================================================
// 9. AppContext tokenProvider: forceRenew Forwarding & Account Identity Verification
// ============================================================================

test('AppContext tokenProvider: forwards forceRenew on 401 and rejects mismatched renewed account identity', async () => {
  const aliceSub = 'google-sub-alice-12345';
  const aliceHash = await computeOwnerSubjectHash(aliceSub);

  // 1. Setup LocalDatabase with Alice as established dataset owner
  const db = new LocalDatabase('test_db_token_provider_reg');
  db.seedDefaultEntities();
  db.setDeviceIdentity('dev-alice', 'Alice Phone');
  db.setIdentity(aliceHash);

  // 2. Setup GoogleAuthManager with Alice profile
  const auth = new GoogleAuthManager();
  await auth.setTestProfileForTesting('alice@example.com', 'Alice', aliceSub, 'initial-unexpired-token');

  // Verify initial auth token is marked unexpired locally
  assert.equal(auth.isTokenExpired(), false, 'Token is locally unexpired');

  let forceRenewReceivedByAuth: boolean | undefined = undefined;
  const originalGetValidAccessToken = auth.getValidAccessToken.bind(auth);
  auth.getValidAccessToken = async (forceRenew?: boolean) => {
    forceRenewReceivedByAuth = forceRenew;
    return originalGetValidAccessToken(forceRenew);
  };

  // Replicate the exact tokenProvider factory from AppContext.tsx
  const createSecureTokenProvider = (targetDb: LocalDatabase) => {
    return async (forceRenew?: boolean): Promise<string> => {
      const token = await auth.getValidAccessToken(forceRenew);
      const activeOwnerHash = targetDb.getIdentity()?.ownerSubjectHash;
      const currentAuthOwnerHash = auth.getProfile()?.subjectHash;
      if (activeOwnerHash && currentAuthOwnerHash && activeOwnerHash !== currentAuthOwnerHash) {
        throw new Error(
          `Security Error: Renewed Google account owner (${currentAuthOwnerHash}) does not match dataset owner (${activeOwnerHash}).`
        );
      }
      return token;
    };
  };

  // Case A: 401 occurs -> transport calls tokenProvider(true) -> forceRenew is forwarded -> renewal succeeds with same account
  auth.simulatedRenewSubjectHash = aliceHash;
  let fetchCountA = 0;
  const mockFetchA = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    fetchCountA++;
    const authHeader = new Headers(init?.headers).get('Authorization');
    if (fetchCountA === 1) {
      assert.equal(authHeader, 'Bearer initial-unexpired-token');
      // Server returns 401 (token revoked or invalidated on server side)
      return new Response(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (fetchCountA === 2) {
      assert.ok(authHeader?.startsWith('Bearer renewed-simulated-token-'), 'Must use renewed token');
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  const transportA = new RealGoogleDriveTransport('initial-unexpired-token', {
    customFetch: mockFetchA,
    tokenProvider: createSecureTokenProvider(db),
  });

  const filesA = await transportA.listAppDataFiles();
  assert.equal(filesA.length, 0);
  assert.equal(forceRenewReceivedByAuth, true, 'forceRenew=true must be forwarded to auth.getValidAccessToken');
  assert.equal(fetchCountA, 2, 'Transport must retry after successful renewal');

  // Case B: Mismatched dataset owner identity rejection in createSecureTokenProvider
  const charlieHash = await computeOwnerSubjectHash('google-sub-charlie-999');
  const dbCharlie = new LocalDatabase('test_db_charlie_owner');
  dbCharlie.setIdentity(charlieHash);
  const providerCharlie = createSecureTokenProvider(dbCharlie);

  await assert.rejects(
    async () => {
      await providerCharlie(false);
    },
    /Security Error: Renewed Google account owner.*does not match dataset owner/,
    'createSecureTokenProvider must reject when targetDb owner does not match auth profile owner'
  );
});

