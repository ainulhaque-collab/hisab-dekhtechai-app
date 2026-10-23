import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PinLockManager } from '../security/pinLock';

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
