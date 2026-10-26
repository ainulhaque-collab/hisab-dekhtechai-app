import test from 'node:test';
import assert from 'node:assert/strict';
import { CapacitorSqliteDriver } from '../storage/drivers/durableStorage';
import { LocalDatabase } from '../storage/db';
import { SyncOrchestrator } from '../sync/orchestrator';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import { computeOwnerSubjectHash } from '../auth/googleAuth';
import { googleErrorMessage } from '../auth/authErrors';

// Reproduce the installed Android SQLite SDK contract: run() defaults to opening
// a transaction, and beginTransaction rejects an already active transaction.
class StrictNativeConnection {
  values = new Map<string, string>();
  snapshot: Map<string, string> | null = null;
  failWrite = false;
  async beginTransaction() {
    if (this.snapshot) throw new Error('Failed in beginTransactionAlready in transaction');
    this.snapshot = new Map(this.values);
  }
  async commitTransaction() {
    if (!this.snapshot) throw new Error('No transaction active');
    this.snapshot = null;
  }
  async rollbackTransaction() {
    if (this.snapshot) this.values = this.snapshot;
    this.snapshot = null;
  }
  async query(_sql: string, values: string[]) {
    const value = this.values.get(values[0]);
    return { values: value == null ? [] : [{ value }] };
  }
  async run(sql: string, values: string[], transaction = true) {
    try {
      if (transaction) await this.beginTransaction();
      if (this.failWrite) throw new Error('synthetic native write failure');
      if (sql.startsWith('DELETE')) this.values.delete(values[0]);
      else this.values.set(values[0], values[1]);
      if (transaction) await this.commitTransaction();
    } finally {
      if (transaction && this.snapshot) await this.rollbackTransaction();
    }
  }
}
function driverFor(connection: StrictNativeConnection) {
  const driver = new CapacitorSqliteDriver('synthetic-native-qa');
  // Inject the native connection at the bridge boundary; financial code is real.
  Object.assign(driver, { db: connection, isInitialized: true });
  return driver;
}

test('Native SQLite writes join the outer transaction and retain commit/rollback semantics', async () => {
  const connection = new StrictNativeConnection();
  const driver = driverFor(connection);
  await driver.setItem('existing', 'original');
  await driver.beginTransaction();
  await driver.setItem('new', 'retained');
  await driver.removeItem('existing');
  await driver.commitTransaction();
  assert.equal(await driver.getItem('new'), 'retained');
  assert.equal(await driver.getItem('existing'), null);
  await driver.beginTransaction();
  await driver.setItem('new', 'discarded');
  await driver.rollbackTransaction();
  assert.equal(await driver.getItem('new'), 'retained');
  await driver.setItem('outside', 'standalone commit');
  assert.equal(connection.snapshot, null);
});

test('Google bootstrap commits identity through strict native SQLite, survives reopening and rolls back write failures', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();
  const connection = new StrictNativeConnection();
  const db = new LocalDatabase('native-bootstrap-qa', driverFor(connection));
  await db.init();
  const profile = { subjectId: 'native-qa-owner', subjectHash: await computeOwnerSubjectHash('native-qa-owner'),
    email: 'qa@example.invalid', displayName: 'QA', isDriveAuthorized: true, accessToken: 'synthetic' };
  const sync = new SyncOrchestrator(db, new SimulatedGoogleDriveTransport());
  await sync.bootstrapAndRestore(profile);
  assert.equal(db.getIdentity()?.ownerSubjectHash, profile.subjectHash);
  assert.equal(sync.getStatus().state, 'synced_verified');
  const reopened = new LocalDatabase('native-bootstrap-qa', driverFor(connection));
  await reopened.init();
  assert.equal(reopened.getIdentity()?.ownerSubjectHash, profile.subjectHash);
  const original = await driverFor(connection).getItem('native-bootstrap-qa');
  await reopened.beginTransaction();
  reopened.createWorkspace('Rolled back', 'business');
  connection.failWrite = true;
  await assert.rejects(reopened.commitTransaction(), /synthetic native write failure/);
  connection.failWrite = false;
  assert.equal(connection.snapshot, null);
  assert.equal(await driverFor(connection).getItem('native-bootstrap-qa'), original);
  assert.equal(reopened.getAllWorkspaces().some(ws => ws.name === 'Rolled back'), false);
});

test('Native bridge error objects show actionable static messages without exposing token data', () => {
  const marker = 'secret-token-must-stay-private';
  assert.match(googleErrorMessage({ code: 'GOOGLE_ANDROID_CONFIG', message: marker }, true), /package and signing SHA-1/);
  assert.match(googleErrorMessage({ message: 'Failed in beginTransactionAlready in transaction' }, true), /local database/);
  assert.match(googleErrorMessage({ code: 'UNIMPLEMENTED', message: '"NativeGoogleDrive" plugin is not implemented on android' }, true), /corrected signed APK/);
  assert.equal(googleErrorMessage({ code: 'AUTH_REQUIRED', message: marker }, true).includes(marker), false);
});
