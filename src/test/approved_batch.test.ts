import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { SyncOrchestrator } from '../sync/orchestrator';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import { computeOwnerSubjectHash, GoogleAuthManager } from '../auth/googleAuth';
import { AppSelect, selectOptions } from '../components/AppSelect';
import { isDeleteConfirmed } from '../domain/confirmation';
import { validateImageSignature, WorkspaceMediaStore } from '../storage/workspaceMedia';
import { buildIncomeJournal, generateUUID } from '../domain/journal';
import { computeSha256, canonicalJson } from '../sync/canonical';
import { biometric, BiometricUnlockManager } from '../security/biometric';
import { PinLockManager } from '../security/pinLock';

async function database() {
  const driver = new LocalStorageFallbackDriver();
  const key = `approved-${generateUUID()}`;
  const db = new LocalDatabase(key, driver); await db.init(); return { db, driver, key };
}
async function profile(sub = 'approved-owner') {
  return { subjectId: sub, subjectHash: await computeOwnerSubjectHash(sub), displayName: 'Synthetic QA Owner', email: 'qa@example.invalid', isDriveAuthorized: true, accessToken: 'mock-token' };
}

test('BUG-008: DOM picker preserves Bengali, empty value, disabled groups and exact IDs without native popup', () => {
  const children = [createElement('option', { value: '' }, 'None / নেই'), createElement('optgroup', { disabled: true }, createElement('option', { value: 'disabled' }, 'বন্ধ')), createElement('option', { value: 'id-42' }, 'খাবার')];
  assert.deepEqual(selectOptions(children).map(o => [o.value, o.text, o.disabled]), [['', 'None / নেই', false], ['disabled', 'বন্ধ', true], ['id-42', 'খাবার', false]]);
  const html = renderToStaticMarkup(createElement(AppSelect, { value: 'id-42', children }));
  assert.ok(html.includes('খাবার')); assert.ok(html.includes('aria-haspopup="listbox"')); assert.ok(!html.includes('<select'));
  for (const file of readdirSync('src/components').filter(f => f.endsWith('.tsx'))) assert.ok(!/<select\b/.test(readFileSync(`src/components/${file}`, 'utf8')), file);
});

test('FEAT-002: DELETE is case-sensitive, exact and never trimmed', () => {
  assert.equal(isDeleteConfirmed('DELETE'), true);
  for (const value of ['DELET', 'delete', 'Delete', '', ' DELETE', 'DELETE ', 'DELETE\n']) assert.equal(isDeleteConfirmed(value), false, value);
});

test('FEAT-002: pending, opening-balance and referenced accounts archive; empty uploaded account deletes once', async () => {
  const { db } = await database();
  const pending = db.createAccount('ws-personal-default', 'Pending', 'cash');
  assert.equal(db.safeDeleteAccount(pending.id, 'DELETE').mode, 'archived');
  const balance = db.createAccount('ws-personal-default', 'Balance', 'bank', '123');
  await db.markOutboxUploaded(db.getPendingOutbox().map(o => o.operationId), 'mock-file');
  assert.equal(db.safeDeleteAccount(balance.id, 'DELETE').mode, 'archived');
  const empty = db.createAccount('ws-personal-default', 'Empty', 'cash');
  await db.markOutboxUploaded(db.getPendingOutbox().map(o => o.operationId), 'mock-file');
  assert.equal(db.safeDeleteAccount(empty.id, 'DELETE').mode, 'deleted');
  assert.equal(db.safeDeleteAccount(empty.id, 'DELETE').success, false);
});

test('BUG-009: workspace mutations persist, archive preserves history, empty deletion uses v1-compatible tombstones', async () => {
  const { db, driver, key } = await database();
  const ws = db.createWorkspace('Company A', 'business');
  const account = db.createAccount(ws.id, 'Wallet', 'cash', '1000');
  db.editWorkspace(ws.id, { name: 'Renamed Company' });
  db.archiveWorkspace(ws.id); assert.equal(db.getAccount(account.id)?.openingBalanceMinor, '1000');
  assert.ok(db.workspaceDeleteBlocker(ws.id));
  assert.throws(() => db.safeDeleteWorkspace(ws.id, 'DELETE'));
  db.restoreWorkspace(ws.id); await db.waitForPendingWrites();
  const restarted = new LocalDatabase(key, driver); await restarted.init();
  assert.equal(restarted.getWorkspace(ws.id)?.name, 'Renamed Company');
  assert.equal(restarted.getWorkspace(ws.id)?.archivedAt, null);
  const empty = db.createWorkspace('Unused', 'personal');
  assert.throws(() => db.safeDeleteWorkspace(empty.id, 'delete'));
  db.safeDeleteWorkspace(empty.id, 'DELETE'); assert.ok(db.getWorkspace(empty.id)?.deletedAt);
  assert.equal(db.getAllWorkspaces().some(w => w.id === empty.id), false);
  assert.throws(() => db.restoreWorkspace(empty.id));
  assert.ok(db.getPendingOutbox().filter(o => o.entityId === empty.id).every(o => ['workspace.create', 'workspace.archive'].includes(o.type)));
});

test('BUG-009: workspace rename/archive/restore replay converges and duplicate replay stays idempotent', async () => {
  const { db: a } = await database(); const { db: b } = await database();
  const owner = await profile(); a.setIdentity(owner.subjectHash); b.setIdentity(owner.subjectHash);
  const ws = a.createWorkspace('Remote workspace', 'business'); a.editWorkspace(ws.id, { name: 'New name' }); a.archiveWorkspace(ws.id); a.restoreWorkspace(ws.id);
  const sync = new SyncOrchestrator(b, new SimulatedGoogleDriveTransport());
  const ops = a.getPendingOutbox();
  const batch = { protocolVersion: 1 as const, ownerHash: owner.subjectHash, deviceId: a.getDeviceId(), batchId: generateUUID(), fromSeq: ops[0].seq, toSeq: ops.at(-1)!.seq, operations: ops, createdAtUtc: new Date().toISOString(), batchSha256: '', byteLength: 0 };
  await sync.applyBatchOperations(batch); const count = b.getRawState().appliedOperations.size;
  await sync.applyBatchOperations(batch);
  assert.equal(b.getWorkspace(ws.id)?.name, 'New name'); assert.equal(b.getWorkspace(ws.id)?.archivedAt, null);
  assert.equal(b.getRawState().appliedOperations.size, count);
});

test('BUG-011: consent, verified subject and foreign references gate bootstrap before any mutation', async () => {
  const { db } = await database(); const owner = await profile();
  db.createWorkspace('Offline', 'business'); await db.waitForPendingWrites();
  const before = JSON.stringify(db.toSerializable());
  const sync = new SyncOrchestrator(db, new SimulatedGoogleDriveTransport());
  await assert.rejects(sync.bootstrapAndRestore(owner), /Explicit consent/);
  assert.equal(JSON.stringify(db.toSerializable()), before);
  await assert.rejects(sync.bootstrapAndRestore({ ...owner, subjectHash: 'forged' }, true), /Verified Google/);
  db.getRawState().workspaces.get('ws-personal-default')!.ownerSubjectHash = 'foreign-owner';
  await assert.rejects(sync.bootstrapAndRestore(owner, true), /Foreign workspace/);
  assert.equal(db.getIdentity(), null);
});

test('BUG-011: binding commits identity/workspace/queued owners atomically; storage failure preserves unbound records', async () => {
  const { db, driver } = await database(); const owner = await profile();
  const ws = db.createWorkspace('Offline company', 'business'); await db.waitForPendingWrites();
  const pending = db.getPendingOutbox().map(o => o.operationId);
  const sync = new SyncOrchestrator(db, new SimulatedGoogleDriveTransport());
  driver.faultInjection = 'throw_on_commit';
  await assert.rejects(sync.bootstrapAndRestore(owner, true), /commit failed/);
  assert.equal(db.getIdentity(), null); assert.equal(db.getWorkspace(ws.id)?.ownerSubjectHash, 'local-owner');
  assert.deepEqual(db.getPendingOutbox().map(o => o.operationId), pending);
  driver.faultInjection = 'none'; db.clearPersistenceError();
  await sync.bootstrapAndRestore(owner, true);
  assert.equal(db.getIdentity()?.ownerSubjectHash, owner.subjectHash);
  assert.equal(db.getWorkspace(ws.id)?.ownerSubjectHash, owner.subjectHash);
  assert.equal(db.getPendingOutbox().length, 0);
});

test('BUG-011: wrong Google account cannot reassign even an empty bound dataset', async () => {
  const { db } = await database(); const owner = await profile(); db.setIdentity(owner.subjectHash);
  const sync = new SyncOrchestrator(db, new SimulatedGoogleDriveTransport());
  await assert.rejects(sync.bootstrapAndRestore(await profile('other-owner'), true), /Cannot reassign/);
  assert.equal(db.getIdentity()?.ownerSubjectHash, owner.subjectHash);
});

test('BUG-010: customer sync screen renders only honest connection/recovery controls', () => {
  const source = readFileSync('src/components/SyncModal.tsx', 'utf8');
  for (const forbidden of ['SIMULATED_DEVICES', 'simulateFault', 'setIsOnline', 'OAuth Setup', 'Copy Origin', 'REST API Active', 'subjectHash']) assert.ok(!source.includes(forbidden), forbidden);
  assert.ok(source.includes('pendingOutboxCount')); assert.ok(source.includes('lastSuccessfulSyncAt'));
});

test('FEAT-009: signatures reject MIME spoofing and oversize files', () => {
  validateImageSignature(new Uint8Array([255,216,255,0]), 'image/jpeg');
  validateImageSignature(new Uint8Array([137,80,78,71,13,10,26,10]), 'image/png');
  assert.throws(() => validateImageSignature(new TextEncoder().encode('<svg/>'), 'image/png'));
  assert.throws(() => validateImageSignature(new Uint8Array([255,216,255]), 'image/svg+xml'));
  assert.throws(() => validateImageSignature(new Uint8Array(6 * 1024 * 1024), 'image/jpeg'));
});

test('FEAT-009: three independent images survive restart, respect ownership, and remain outside financial state', async () => {
  const driver = new LocalStorageFallbackDriver(); const media = new WorkspaceMediaStore(driver);
  for (const [id, data] of [['business-a', 'YQ=='], ['business-b', 'Yg=='], ['personal', 'Yw==']]) await media.save(id, 'owner-a', `data:image/jpeg;base64,${data}`);
  const restarted = new WorkspaceMediaStore(driver);
  assert.equal(await restarted.get('business-a', 'owner-a'), 'data:image/jpeg;base64,YQ==');
  assert.equal(await restarted.get('business-b', 'owner-a'), 'data:image/jpeg;base64,Yg==');
  assert.equal(await restarted.get('personal', 'owner-a'), 'data:image/jpeg;base64,Yw==');
  assert.equal(await restarted.get('business-a', 'foreign'), null);
  await assert.rejects(restarted.save('business-a', 'foreign', null), /another owner/);
  await restarted.save('business-a', 'owner-a', null); assert.equal(await restarted.get('business-a', 'owner-a'), null);
  const { db } = await database(); assert.ok(!JSON.stringify(db.toSerializable()).includes('data:image'));
});

test('FEAT-008: unsupported web never exposes native biometrics or bypasses PIN', async () => {
  assert.deepEqual(await biometric.status(), { available: false, enabled: false });
  assert.equal(await biometric.unlock(), false);
  await assert.rejects(biometric.enable('1234'));
});

test('BUG-012: original bundled WAVs are distinct valid PCM; sounds occur after durable commit', () => {
  const buffers = ['income', 'expense', 'transfer'].map(name => readFileSync(`public/audio/${name}.wav`));
  buffers.forEach(buffer => { assert.equal(buffer.toString('ascii', 0,4), 'RIFF'); assert.equal(buffer.toString('ascii',8,12), 'WAVE'); assert.ok(buffer.length > 1000); });
  assert.notDeepEqual(buffers[0], buffers[1]); assert.notDeepEqual(buffers[1], buffers[2]);
  const source = readFileSync('src/components/AddTransactionTab.tsx', 'utf8');
  assert.ok(source.indexOf('await db.waitForPendingWrites()') < source.indexOf('soundService.playTransactionSuccess(type)'));
});

test('BUG-011: unreadable remote batches cannot produce a successful sync timestamp', async () => {
  const { db } = await database(); db.setIdentity((await profile()).subjectHash);
  const transport = { listAppDataFiles: async () => [{ id: 'unreadable', name: 'hsc-v1-ops-unreadable.json', mimeType: 'application/json' }],
    downloadBatchFile: async () => { throw new Error('Interrupted remote read'); }, uploadBatchFile: async () => ({ fileId: 'unused', name: 'unused' }),
    deleteFile: async () => {}, getQuotaStatus: async () => ({ usedBytes: 0, totalBytes: 1, isFull: false }) };
  const sync = new SyncOrchestrator(db, transport); await sync.triggerSync();
  assert.equal(sync.getStatus().state, 'error_retryable'); assert.equal(sync.getStatus().lastSuccessfulSyncAt, null);
});

test('BUG-011: an unsupported operation rolls back the entire incoming batch', async () => {
  const { db } = await database(); const owner = await profile(); db.setIdentity(owner.subjectHash);
  const ws = { id: 'must-not-leak', ownerSubjectHash: owner.subjectHash, name: 'Remote', kind: 'business', currency: 'BDT', createdAt: new Date().toISOString() };
  const base = { protocolVersion: 1 as const, ownerHash: owner.subjectHash, deviceId: 'remote', createdAtUtc: new Date().toISOString(), contentSha256: '' };
  const batch = { protocolVersion: 1 as const, ownerHash: owner.subjectHash, deviceId: 'remote', batchId: 'test', fromSeq: 1, toSeq: 2, operations: [
    { ...base, seq: 1, operationId: 'valid', entityId: ws.id, type: 'workspace.create' as const, payload: { workspace: ws } },
    { ...base, seq: 2, operationId: 'invalid', entityId: ws.id, type: 'future.unsupported' as any, payload: {} },
  ], createdAtUtc: new Date().toISOString(), batchSha256: '', byteLength: 0 };
  await assert.rejects(new SyncOrchestrator(db, new SimulatedGoogleDriveTransport()).applyBatchOperations(batch), /Unsupported/);
  assert.equal(db.getWorkspace(ws.id), undefined); assert.equal(db.getRawState().appliedOperations.has('valid'), false);
});

test('FEAT-008: biometric bridge rejects disabled enrollment, cancellation, false success, bad PIN and lockout', async () => {
  const pin = new PinLockManager(); await pin.setPin('6284');
  let calls = 0; let available = true; let enabled = false; let succeeds = false; let cancel = false;
  const bridge = { status: async () => ({ available, enabled }), enable: async () => ({ authenticated: succeeds }), disable: async () => {},
    authenticate: async () => { calls++; if (cancel) throw new Error('Cancelled'); return { authenticated: succeeds }; } };
  const manager = new BiometricUnlockManager(bridge, pin, () => 'android');
  assert.equal(await manager.unlock(), false); assert.equal(calls, 0);
  enabled = true; available = false; assert.equal(await manager.unlock(), false); assert.equal(calls, 0);
  available = true; assert.equal(await manager.unlock(), false); assert.equal(calls, 1);
  succeeds = true; assert.equal(await manager.unlock(), true);
  cancel = true; await assert.rejects(manager.unlock(), /Cancelled/);
  await assert.rejects(manager.enable('0000'), /Incorrect PIN/);
  for (let attempt = 0; attempt < 4; attempt++) await pin.verifyPin('0000');
  const previousCalls = calls; assert.equal(await manager.unlock(), false); assert.equal(calls, previousCalls);
});

test('FEAT-002: archiving an account preserves consolidated and account-group balances', async () => {
  const { db } = await database();
  const ws = db.createWorkspace('Balance safety', 'business');
  const group = db.createAccountGroup(ws.id, 'Wallets');
  const acc = db.createAccount(ws.id, 'Historical account', 'cash', '12000', '', 'asset', group.id);
  const total = db.getDashboardData(ws.id).totalConsolidatedBalanceMinor;
  const groupTotal = db.getAccountGroupSummary(group.id)?.currentBalanceMinor;
  assert.equal(db.safeDeleteAccount(acc.id, 'DELETE').mode, 'archived');
  assert.equal(db.getDashboardData(ws.id).totalConsolidatedBalanceMinor, total);
  assert.equal(db.getAccountGroupSummary(group.id)?.currentBalanceMinor, groupTotal);
});
