import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';

test('Durable storage fallback: basic get, set, remove', async () => {
  const driver = new LocalStorageFallbackDriver();
  assert.equal(driver.getType(), 'localstorage-fallback');

  await driver.setItem('test_key', 'test_value');
  const read = await driver.getItem('test_key');
  assert.equal(read, 'test_value');

  await driver.removeItem('test_key');
  const empty = await driver.getItem('test_key');
  assert.equal(empty, null);
});

test('LocalDatabase: atomic transactions roll back cleanly on failure', async () => {
  const db = new LocalDatabase('test_db_atomic');
  const initialAccountsCount = db.getAccounts('ws-personal-default').length;

  await db.beginTransaction();
  // Modify state within transaction
  db.createAccount('ws-personal-default', 'Temporary Account', 'cash', '10000');
  assert.equal(db.getAccounts('ws-personal-default').length, initialAccountsCount + 1);

  // Rollback
  await db.rollbackTransaction();
  assert.equal(
    db.getAccounts('ws-personal-default').length,
    initialAccountsCount,
    'Rollback must completely restore previous state'
  );
});

test('LocalDatabase: workspace archive and restore', () => {
  const db = new LocalDatabase('test_db_ws');
  const ws = db.createWorkspace('Old Business Project', 'business');

  // Archive workspace
  const archived = db.archiveWorkspace(ws.id);
  assert.equal(archived, true);

  // Default getWorkspaces should exclude archived
  const activeWorkspaces = db.getWorkspaces();
  assert.equal(activeWorkspaces.some((w) => w.id === ws.id), false);

  // getAllWorkspaces should include archived
  const allWorkspaces = db.getAllWorkspaces();
  const found = allWorkspaces.find((w) => w.id === ws.id);
  assert.ok(found);
  assert.ok(found.archivedAt);

  // Restore workspace
  const restored = db.restoreWorkspace(ws.id);
  assert.equal(restored, true);
  const activeAfterRestore = db.getWorkspaces();
  assert.equal(activeAfterRestore.some((w) => w.id === ws.id), true);
});
