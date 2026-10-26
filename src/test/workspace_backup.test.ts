import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { decodeBackup, encodeBackup } from '../storage/backup';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import { buildIncomeJournal, generateUUID } from '../domain/journal';
import { SyncOrchestrator } from '../sync/orchestrator';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import { GoogleAuthManager } from '../auth/googleAuth';
import { googleErrorMessage } from '../auth/authErrors';

async function database() {
  const driver = new LocalStorageFallbackDriver(); const key = `backup-${generateUUID()}`;
  const db = new LocalDatabase(key, driver); await db.init(); return { db, driver, key };
}
async function post(db: LocalDatabase, amount = '12345') {
  const journal = buildIncomeJournal({ workspaceId: 'ws-personal-default', assetAccountId: 'acc-cash-1',
    revenueCategoryId: 'cat-salary', amountMinor: amount, effectiveDate: '2026-10-26', opId: generateUUID() });
  const payload = { balancedJournal: journal };
  await db.commitJournalWithOutbox(journal, { protocolVersion: 1, ownerHash: 'local-owner', deviceId: db.getDeviceId(),
    seq: db.getNextDeviceSeq(), operationId: journal.transaction.createdOpId, entityId: journal.transaction.id,
    type: 'journal.post', payload, createdAtUtc: new Date().toISOString(), contentSha256: await computeSha256(canonicalJson(payload)) });
  return journal;
}

test('Unused default workspaces delete even after a starter recovery point, and stay deleted after restart', async () => {
  const { db, driver, key } = await database(); await db.captureRecoverySnapshot();
  const originalAccounts = db.getRawState().accounts.size;
  for (const id of ['ws-personal-default', 'ws-business-default']) {
    assert.equal(db.workspaceDeleteBlocker(id), null);
    db.safeDeleteWorkspace(id, 'DELETE');
  }
  await db.waitForPendingWrites();
  const restarted = new LocalDatabase(key, driver); await restarted.init();
  assert.equal(restarted.getWorkspaces().length, 0);
  assert.equal(restarted.getRawState().accounts.size, originalAccounts, 'Starter records stay behind retained parent tombstones');
  assert.equal(restarted.getRawState().workspaces.size, 2);
});

test('A changed starter account, opening balance or journal still prevents workspace deletion', async () => {
  const { db } = await database(); db.getAccount('acc-cash-1')!.name = 'My edited account';
  assert.ok(db.workspaceDeleteBlocker('ws-personal-default'));
  assert.throws(() => db.safeDeleteWorkspace('ws-personal-default', 'DELETE'));
  const { db: used } = await database(); await post(used);
  assert.ok(used.workspaceDeleteBlocker('ws-personal-default'));
  assert.equal(used.getTransactions('ws-personal-default').length, 1);
});

test('Workspace optional description survives restart and operation replay', async () => {
  const { db, driver, key } = await database(); const ws = db.createWorkspace('Shop', 'business', '  দোকানের হিসাব  ');
  assert.equal(ws.description, 'দোকানের হিসাব');
  db.editWorkspace(ws.id, { description: 'নতুন বিবরণ' }); await db.waitForPendingWrites();
  const restarted = new LocalDatabase(key, driver); await restarted.init();
  assert.equal(restarted.getWorkspace(ws.id)?.description, 'নতুন বিবরণ');
  const { db: other } = await database(); const sync = new SyncOrchestrator(other, new SimulatedGoogleDriveTransport());
  const operations = db.getPendingOutbox();
  await sync.applyBatchOperations({ protocolVersion: 1, ownerHash: 'local-owner', deviceId: db.getDeviceId(), batchId: generateUUID(),
    fromSeq: operations[0].seq, toSeq: operations.at(-1)!.seq, operations, batchSha256: '', byteLength: 0, createdAtUtc: new Date().toISOString() });
  assert.equal(other.getWorkspace(ws.id)?.description, 'নতুন বিবরণ');
});

test('SHA-256 uses identical real UTF-8 hashes without browser WebCrypto', async () => {
  assert.equal(await computeSha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const text of ['', 'হিসাব ০১২৩৪৫৬৭৮৯', 'hisab-owner:qa-owner'])
    assert.equal(await computeSha256(text), createHash('sha256').update(text).digest('hex'));
});

test('Recovery points do not recursively copy earlier snapshots', async () => {
  const { db } = await database(); const first = await db.captureRecoverySnapshot();
  const second = await db.captureRecoverySnapshot(); const third = await db.captureRecoverySnapshot();
  assert.equal(first.dataJson?.length, second.dataJson?.length); assert.equal(second.dataJson?.length, third.dataJson?.length);
  assert.deepEqual(JSON.parse(third.dataJson!).localSnapshots, []);
});

test('Backup file roundtrip is idempotent, restores missing journals and retains newer records, outbox and device', async () => {
  const { db: source } = await database(); const old = await post(source); const file = await source.exportBackupFile();
  const { db, driver, key } = await database(); const newer = await post(db, '98765');
  const account = db.createAccount('ws-personal-default', 'New wallet', 'cash'); await db.waitForPendingWrites();
  const device = db.getDeviceId(), pending = db.getPendingOutbox().map(op => op.operationId);
  await db.importBackupFile(file); await db.importBackupFile(file);
  assert.deepEqual(new Set(db.getTransactions('ws-personal-default').map(tx => tx.id)), new Set([old.transaction.id, newer.transaction.id]));
  assert.ok(db.getAccount(account.id)); assert.equal(db.getDeviceId(), device);
  for (const id of pending) assert.ok(db.getPendingOutbox().some(op => op.operationId === id));
  assert.equal(db.getPendingOutbox().length, 3); assert.equal(db.verifyLedgerIntegrity('ws-personal-default').isValid, true);
  const restarted = new LocalDatabase(key, driver); await restarted.init(); assert.equal(restarted.getTransactions('ws-personal-default').length, 2);
});

test('Modified backup text is rejected before financial state or recovery points change', async () => {
  const { db } = await database(); const envelope = JSON.parse(await db.exportBackupFile());
  envelope.dataJson += ' '; const before = canonicalJson(db.toSerializable());
  await assert.rejects(db.importBackupFile(JSON.stringify(envelope)), /BACKUP_CHECKSUM/);
  assert.equal(canonicalJson(db.toSerializable()), before);
  await assert.rejects(decodeBackup('{bad json'), /BACKUP_INVALID/);
});

test('Fresh installation restores customized starter names and opening balances, while used accounts reject incompatible balances', async () => {
  const { db: source } = await database();
  source.getAccount('acc-cash-1')!.name = 'Restored savings'; source.getAccount('acc-cash-1')!.openingBalanceMinor = '45000';
  const file = await source.exportBackupFile(); const { db } = await database();
  await db.importBackupFile(file);
  assert.equal(db.getAccount('acc-cash-1')?.name, 'Restored savings');
  assert.equal(db.getAccount('acc-cash-1')?.openingBalanceMinor, '45000');
  assert.ok(db.getPendingOutbox().some(op => op.type === 'account.create' && op.payload.account?.openingBalanceMinor === '45000'));
  const { db: used } = await database(); await post(used);
  await assert.rejects(used.importBackupFile(file), /BACKUP_CONFLICT/);
  assert.equal(used.getAccount('acc-cash-1')?.openingBalanceMinor, '0');
});

test('Backup never exports or captures an uncommitted financial state', async () => {
  const { db } = await database(); await db.beginTransaction(); db.createWorkspace('Not committed', 'business');
  await assert.rejects(db.captureRecoverySnapshot(), /Storage busy/);
  await assert.rejects(db.exportBackupFile(), /Storage busy/);
  await db.rollbackTransaction(); assert.equal(db.getSnapshots().length, 0);
});

test('Emergency file export still preserves current records when internal storage is full', async () => {
  const { db, driver } = await database(); driver.faultInjection = 'throw_on_write';
  const account = db.createAccount('ws-personal-default', 'Unsaved wallet', 'cash');
  await assert.rejects(db.waitForPendingWrites(), /Storage write failed/);
  const data = await decodeBackup(await db.exportBackupFile());
  assert.ok(data.accounts.some(([id]: [string]) => id === account.id));
  assert.ok(db.getLastPersistenceError(), 'Export must not hide the internal storage failure');
});

test('A valid checksum cannot authorize a foreign owner or mixed workspace owner', async () => {
  const { db } = await database(); const data = db.toSerializable(); const before = canonicalJson(data);
  data.localIdentity = { ownerSubjectHash: 'different-owner' };
  await assert.rejects(db.importBackupFile(await encodeBackup(data)), /BACKUP_OWNER/);
  data.localIdentity = null; data.workspaces = structuredClone(data.workspaces); data.workspaces[0][1].ownerSubjectHash = 'different-owner';
  await assert.rejects(db.importBackupFile(await encodeBackup(data)), /BACKUP_OWNER/);
  assert.equal(canonicalJson(db.toSerializable()), before);
});

test('Unbalanced and conflicting financial records are rejected without replacing current records', async () => {
  const { db: source } = await database(); await post(source); const data = structuredClone(source.toSerializable());
  data.journalTransactions[0][1].lines[0].debitMinor = '999'; data.journalLines[0][1].debitMinor = '999';
  const { db } = await database(); await assert.rejects(db.importBackupFile(await encodeBackup(data)), /BACKUP_LEDGER/);
  const conflict = structuredClone(source.toSerializable()); conflict.journalTransactions[0][1].note = 'changed';
  await assert.rejects(source.importBackupFile(await encodeBackup(conflict)), /BACKUP_CONFLICT/);
  assert.equal(source.getTransactions('ws-personal-default')[0].note, undefined);
});

test('Restore commit failure rolls back imported records and preserves durable newer work', async () => {
  const { db: source } = await database(); const old = await post(source); const file = await source.exportBackupFile();
  const { db, driver, key } = await database(); const newer = await post(db, '900');
  driver.faultInjection = 'throw_on_commit';
  await assert.rejects(db.importBackupFile(file), /commit failed/); driver.faultInjection = 'none';
  assert.equal(db.getRawState().journalTransactions.has(old.transaction.id), false);
  assert.equal(db.getRawState().journalTransactions.has(newer.transaction.id), true);
  const restarted = new LocalDatabase(key, driver); await restarted.init(); assert.equal(restarted.getTransactions('ws-personal-default').length, 1);
});

test('Drive read-back failure retains pending operations and does not report verified success', async () => {
  const { db } = await database(); db.createWorkspace('Pending upload', 'business'); await db.waitForPendingWrites();
  const sync = new SyncOrchestrator(db, { listAppDataFiles: async () => [], uploadBatchFile: async () => ({ fileId: 'broken', name: 'batch' }),
    downloadBatchFile: async () => '{}', deleteFile: async () => {}, getQuotaStatus: async () => ({ isFull: false, usedBytes: 0, totalBytes: 1 }) });
  await sync.triggerSync();
  assert.equal(db.getPendingOutbox().length, 1); assert.equal(sync.getStatus().lastSuccessfulSyncAt, null);
  assert.match(sync.getStatus().lastError!, /read-back/);
});

test('Imported pending changes upload under their original device identity', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();
  const { db: a } = await database(); await post(a); const { db: b } = await database(); await post(b);
  await b.importBackupFile(await a.exportBackupFile());
  const transport = new SimulatedGoogleDriveTransport(); const sync = new SyncOrchestrator(b, transport); await sync.triggerSync();
  assert.equal(sync.getStatus().state, 'synced_verified'); assert.equal(b.getPendingOutbox().length, 0);
  const files = await transport.listAppDataFiles(); assert.equal(files.length, 2);
  for (const file of files) { const batch = JSON.parse(await transport.downloadBatchFile(file.id));
    assert.ok(batch.operations.every((op: any) => op.deviceId === batch.deviceId)); }
});

test('Google sign-in rejects insecure phone LAN origins with actionable, sanitized guidance', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { protocol: 'http:', hostname: '192.168.1.108' } } });
  try { await assert.rejects(new GoogleAuthManager().promptGoogleSignIn(), /GOOGLE_INSECURE_ORIGIN/); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window'); }
  assert.match(googleErrorMessage(new Error('GOOGLE_INSECURE_ORIGIN'), true), /USB port forwarding/);
  assert.ok(!googleErrorMessage(new Error('Security Error: owner secret-owner-hash'), true).includes('secret-owner-hash'));
});
