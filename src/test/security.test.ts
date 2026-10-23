import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PinLockManager } from '../security/pinLock';

test('PinLockManager: salted SHA-256 hashing and verification', async () => {
  const pin = '4321';
  const salt = PinLockManager.generateSalt();
  const hash = await PinLockManager.hashPin(pin, salt);

  assert.ok(hash.length === 64, 'SHA-256 hash must be 64 hex characters');
  assert.notEqual(hash, pin, 'PIN must never be stored plaintext');

  const valid = await PinLockManager.verifyPin(pin, salt, hash);
  assert.equal(valid, true, 'Correct PIN must verify successfully');

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
