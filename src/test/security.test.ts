import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PinLockManager } from '../security/pinLock';
import { SimulatedGoogleDriveTransport, RealGoogleDriveTransport } from '../drive/transport';
import { SyncOrchestrator } from '../sync/orchestrator';
import { LocalDatabase } from '../storage/db';

test('PinLockManager: PBKDF2 slow KDF derivation and verification', async () => {
  const pin = '4321';
  const salt = PinLockManager.generateSalt();
  const startTime = Date.now();
  const hash = await PinLockManager.hashPin(pin, salt);
  const elapsed = Date.now() - startTime;

  assert.ok(hash.length === 64, 'Derived PBKDF2 hash must be 64 hex characters (256 bits)');
  assert.notEqual(hash, pin, 'PIN must never be stored in plaintext');

  const valid = await PinLockManager.verifyPin(pin, salt, hash);
  assert.equal(valid, true, 'Correct PIN must verify successfully with PBKDF2');

  const invalid = await PinLockManager.verifyPin('9999', salt, hash);
  assert.equal(invalid, false, 'Incorrect PIN must fail verification');
});

test('PinLockManager: brute-force rate limiting and lockout', async () => {
  const manager = new PinLockManager();
  await manager.setPin('1234');
  manager.resetAttempts();

  assert.equal(manager.isLockedOut().locked, false);

  // Attempt 4 wrong entries
  for (let i = 0; i < 4; i++) {
    const res = await manager.verifyPin('0000');
    assert.equal(res.success, false);
    assert.equal(manager.isLockedOut().locked, false);
  }

  // 5th wrong entry triggers lockout
  const fifth = await manager.verifyPin('0000');
  assert.equal(fifth.success, false);
  const lockoutStatus = manager.isLockedOut();
  assert.equal(lockoutStatus.locked, true);
  assert.ok(lockoutStatus.remainingSeconds > 0, 'Must have remaining lockout seconds');

  // Verify that during lockout, even correct PIN is rejected
  const attemptDuringLockout = await manager.verifyPin('1234');
  assert.equal(attemptDuringLockout.success, false, 'Must reject PIN while locked out');

  // Reset attempts clears lockout
  manager.resetAttempts();
  assert.equal(manager.isLockedOut().locked, false);
  const success = await manager.verifyPin('1234');
  assert.equal(success.success, true);
});

test('PinLockManager: lockout behavior persists after simulated application restart', async () => {
  // Instance 1: sets PIN and triggers lockout
  const appSession1 = new PinLockManager();
  await appSession1.setPin('5678');
  appSession1.resetAttempts();

  // Fail 5 times to trigger lockout
  for (let i = 0; i < 5; i++) {
    await appSession1.verifyPin('0000');
  }
  assert.equal(appSession1.isLockedOut().locked, true, 'App session 1 must be locked out');

  // Simulate app restart: Create completely new instance from persistent storage
  const appSession2AfterRestart = new PinLockManager();
  const restartStatus = appSession2AfterRestart.isLockedOut();
  assert.equal(
    restartStatus.locked,
    true,
    'Lockout must persist across app restart / reloads'
  );
  assert.ok(
    restartStatus.remainingSeconds > 0,
    'Lockout cooldown timer must persist across restart'
  );

  // Even with correct PIN, restart session must deny entry while locked out
  const enterCorrectPin = await appSession2AfterRestart.verifyPin('5678');
  assert.equal(
    enterCorrectPin.success,
    false,
    'Must remain locked out on restart until cooldown expires'
  );

  // Clean up
  appSession2AfterRestart.resetAttempts();
});

test('Production isolation: SimulatedGoogleDriveTransport throws in production mode', () => {
  const origEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(
      () => {
        new SimulatedGoogleDriveTransport();
      },
      /Simulated Google Drive cloud storage is strictly forbidden in production mode/,
      'Must reject simulated transport in production'
    );
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

test('RealGoogleDriveTransport: 401 Unauthorized triggers tokenProvider renewal and succeeds on retry', async () => {
  let renewCallCount = 0;
  let fetchCallCount = 0;

  const mockTokenProvider = async () => {
    renewCallCount++;
    return 'new-valid-token';
  };

  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    fetchCallCount++;
    const authHeader = (init?.headers as Record<string, string>)?.['Authorization'];

    // First call has expired token -> return 401
    if (fetchCallCount === 1) {
      assert.equal(authHeader, 'Bearer expired-token');
      return new Response(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Second call should have new-valid-token -> return 200
    if (fetchCallCount === 2) {
      assert.equal(authHeader, 'Bearer new-valid-token');
      return new Response(
        JSON.stringify({ files: [{ id: 'f-1', name: 'batch-1.json', mimeType: 'application/json' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  const transport = new RealGoogleDriveTransport('expired-token', {
    customFetch: mockFetch,
    tokenProvider: mockTokenProvider,
  });

  const files = await transport.listAppDataFiles();
  assert.equal(files.length, 1);
  assert.equal(files[0].id, 'f-1');
  assert.equal(renewCallCount, 1, 'tokenProvider must be called once on 401');
  assert.equal(fetchCallCount, 2, 'fetch must be retried with the renewed token');
});

test('SyncOrchestrator: Rejects authenticated sync in production without verified owner identity', async () => {
  const origEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const db = new LocalDatabase('test_db_prod_owner_check');
    // Deliberately do NOT set owner identity on db
    const mockTransport = {
      listAppDataFiles: async () => [],
      uploadBatchFile: async () => ({ fileId: '1', name: '1', mimeType: 'application/json' }),
      downloadBatchFile: async () => '{}',
    };

    const sync = new SyncOrchestrator(db, mockTransport as any);
    sync.setAuthorized(true);

    await assert.rejects(
      async () => {
        await sync.triggerSync();
      },
      /Strict dataset ownership requires authenticated user owner identity in production/,
      'Authenticated production sync must fail without owner identity'
    );
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

