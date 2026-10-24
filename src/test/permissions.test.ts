import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { computeSha256 } from '../sync/canonical';

test('FEAT-003: Employee Role-Based Access Control and Permission Layer', async () => {
  const driver = new LocalStorageFallbackDriver();
  const db = new LocalDatabase('test_db_permissions', driver);
  await db.init();
  const wsId = 'ws-business-default';

  const cashAcc = db.createAccount(wsId, 'Front Desk Cash', 'cash', '5000', '', 'asset', null);
  const secretVault = db.createAccount(wsId, 'Owner Private Vault', 'bank', '500000', '', 'asset', null);

  const employeeEmail = 'staff.sales@example.com';
  const employeeHash = await computeSha256(`employee:${employeeEmail}`);

  // 1. Owner always has full read and write access to all accounts
  assert.equal(db.canUserReadAccount(undefined, cashAcc.id), true);
  assert.equal(db.canUserWriteAccount(undefined, secretVault.id), true);

  // 2. Unregistered employee has NO access
  assert.equal(db.canUserReadAccount(employeeHash, cashAcc.id), false);
  assert.equal(db.canUserWriteAccount(employeeHash, cashAcc.id), false);

  // 3. Grant Editor role to staff only for Front Desk Cash
  const editorGrant = db.grantAccountPermission(
    wsId,
    employeeEmail,
    employeeHash,
    [cashAcc.id],
    'editor'
  );
  assert.ok(editorGrant.id);
  assert.equal(editorGrant.role, 'editor');

  // Verify Editor can read and write authorized account
  assert.equal(db.canUserReadAccount(employeeHash, cashAcc.id), true);
  assert.equal(db.canUserWriteAccount(employeeHash, cashAcc.id), true);

  // Verify Editor CANNOT read or write unauthorized account (Owner Private Vault)
  assert.equal(db.canUserReadAccount(employeeHash, secretVault.id), false);
  assert.equal(db.canUserWriteAccount(employeeHash, secretVault.id), false);

  // 4. Test Viewer Role
  const auditorEmail = 'auditor@example.com';
  const auditorHash = await computeSha256(`employee:${auditorEmail}`);

  const viewerGrant = db.grantAccountPermission(
    wsId,
    auditorEmail,
    auditorHash,
    [cashAcc.id, secretVault.id],
    'viewer'
  );

  // Viewer can read both accounts
  assert.equal(db.canUserReadAccount(auditorHash, cashAcc.id), true);
  assert.equal(db.canUserReadAccount(auditorHash, secretVault.id), true);

  // Viewer CANNOT write to either account
  assert.equal(db.canUserWriteAccount(auditorHash, cashAcc.id), false);
  assert.equal(db.canUserWriteAccount(auditorHash, secretVault.id), false);

  // 5. Revocation
  db.revokeAccountPermission(editorGrant.id);

  // After revocation, editor has no access
  assert.equal(db.canUserReadAccount(employeeHash, cashAcc.id), false);
  assert.equal(db.canUserWriteAccount(employeeHash, cashAcc.id), false);
});
