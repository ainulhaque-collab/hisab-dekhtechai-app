import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { WorkspaceMediaStore } from '../storage/workspaceMedia';
import { createWorkspaceImage, validateWorkspaceImage, workspaceImageHash } from '../storage/workspaceImages';
import { migrateLegacyWorkspaceImages } from '../storage/workspaceMediaMigration';
import { SyncOrchestrator } from '../sync/orchestrator';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import { computeOwnerSubjectHash } from '../auth/googleAuth';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import { decodeBackup, encodeBackup } from '../storage/backup';
import { generateUUID, buildIncomeJournal } from '../domain/journal';
import { SyncBatch, SyncOperation } from '../contracts/types';

const workspaceId = 'ws-personal-default';
// Synthetic bytes exercise transport/hash validation; browser image decoding is a separate UI check.
const photo = (n = 1) => `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, n, 255, 217]).toString('base64')}`;
const revision = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function database() {
  const key = `workspace-photo-${generateUUID()}`, driver = new LocalStorageFallbackDriver();
  const db = new LocalDatabase(key, driver); await db.init(); return { db, driver, key };
}
async function save(db: LocalDatabase, dataUrl: string | null) {
  await db.beginTransaction();
  try { db.editWorkspace(workspaceId, { name: 'Photo workspace', imageDataUrl: dataUrl }); await db.commitTransaction(); }
  catch (error) { await db.rollbackTransaction(); throw error; }
}
function batch(operations: SyncOperation[]): SyncBatch {
  return { protocolVersion: 1, ownerHash: operations[0].ownerHash, deviceId: operations[0].deviceId,
    batchId: generateUUID(), fromSeq: operations[0].seq, toSeq: operations.at(-1)!.seq,
    operations, batchSha256: '', byteLength: 0, createdAtUtc: new Date().toISOString() };
}
const sync = (db: LocalDatabase) => new SyncOrchestrator(db, new SimulatedGoogleDriveTransport());

test('Workspace image checksum uses decoded bytes and rejects active/remote/oversize/corrupt media', () => {
  const data = photo();
  assert.equal(workspaceImageHash(data), createHash('sha256').update(Buffer.from(data.split(',')[1], 'base64')).digest('hex'));
  const image = createWorkspaceImage(data, revision(1)); validateWorkspaceImage(image);
  for (const invalid of ['https://example.invalid/image.jpg', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/jpeg;base64,YQ==', `${data}=`, `data:image/jpeg;base64,${'A'.repeat(256 * 1024)}`])
    assert.throws(() => workspaceImageHash(invalid));
  assert.throws(() => validateWorkspaceImage({ ...image, dataUrl: photo(2) }), /checksum/);
  for (const change of [{ version: 0 }, { revisionId: '../anything' }, { extra: 'untrusted' }, { dataUrl: null }])
    assert.throws(() => validateWorkspaceImage({ ...image, ...change }));
});

test('Workspace edit + image + outbox persist atomically, survive restart, and never alter financial balances', async () => {
  const { db, driver, key } = await database();
  const before = db.getDashboardData(workspaceId);
  assert.throws(() => db.editWorkspace(workspaceId, { imageDataUrl: photo() }), /transaction/);
  await save(db, photo());
  const op = db.getPendingOutbox().at(-1)!;
  assert.equal(op.type, 'workspace.update'); assert.equal(op.payload.image.dataUrl, photo());
  assert.equal(op.contentSha256, await computeSha256(canonicalJson(op.payload)));
  const restarted = new LocalDatabase(key, driver); await restarted.init();
  assert.equal(restarted.getWorkspace(workspaceId)?.image?.dataUrl, photo());
  assert.deepEqual(db.getDashboardData(workspaceId), before);
  const state = canonicalJson(db.toSerializable());
  driver.faultInjection = 'throw_on_commit'; await assert.rejects(save(db, photo(2)), /commit failed/);
  driver.faultInjection = 'none';
  assert.equal(canonicalJson(db.toSerializable()), state);
  const afterFailure = new LocalDatabase(key, driver); await afterFailure.init();
  assert.equal(afterFailure.getWorkspace(workspaceId)?.image?.dataUrl, photo());
});

test('Legacy images copy once for the matching owner; originals and removal tombstones survive retries', async () => {
  const { db, driver } = await database();
  const store = new WorkspaceMediaStore(new LocalStorageFallbackDriver());
  await store.save(workspaceId, 'local-owner', photo());
  driver.faultInjection = 'throw_on_commit';
  await assert.rejects(migrateLegacyWorkspaceImages(db, store), /commit failed/);
  driver.faultInjection = 'none';
  assert.equal(db.getWorkspace(workspaceId)?.image, undefined);
  assert.equal(await store.get(workspaceId, 'local-owner'), photo());
  assert.equal(await migrateLegacyWorkspaceImages(db, store), 1);
  assert.equal(await migrateLegacyWorkspaceImages(db, store), 0);
  assert.equal(db.getPendingOutbox().filter(op => op.payload.image).length, 1);
  await save(db, null);
  assert.equal(await migrateLegacyWorkspaceImages(db, store), 0);
  assert.equal(db.getWorkspace(workspaceId)?.image?.dataUrl, null);
  assert.equal(await store.get(workspaceId, 'local-owner'), photo(), 'Do not destroy the previous version app\'s local copy');
  const foreign = new WorkspaceMediaStore(new LocalStorageFallbackDriver());
  const { db: other } = await database();
  await foreign.save(workspaceId, 'different-owner', photo());
  assert.equal(await migrateLegacyWorkspaceImages(other, foreign), 0);
  assert.equal(other.getWorkspace(workspaceId)?.image, undefined);
});

test('Photo and removal replicate through simulated private Drive and a downloaded backup, with no duplicate journal', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();
  const subjectId = 'synthetic-photo-owner';
  const profile = { subjectId, subjectHash: await computeOwnerSubjectHash(subjectId), email: 'test@example.invalid',
    displayName: 'Synthetic', isDriveAuthorized: true, accessToken: 'synthetic-not-a-token' };
  const transport = new SimulatedGoogleDriveTransport();
  const { db: a } = await database(), { db: b } = await database();
  const sa = new SyncOrchestrator(a, transport, { cloudBackups: true });
  const sb = new SyncOrchestrator(b, transport, { cloudBackups: true });
  await sa.bootstrapAndRestore(profile); await sb.bootstrapAndRestore(profile);
  await save(a, photo()); await sa.triggerSync(); await sb.triggerSync();
  assert.equal(b.getWorkspace(workspaceId)?.image?.dataUrl, photo());
  assert.equal(a.getPendingOutbox().length, 0);
  const backup = await sa.downloadCloudBackup();
  assert.equal((await decodeBackup(backup)).workspaces.find(([id]: [string]) => id === workspaceId)[1].image.dataUrl, photo());
  const { db: restored } = await database();
  const sr = new SyncOrchestrator(restored, transport); await sr.bootstrapAndRestore(profile);
  await restored.importBackupFile(backup); await restored.importBackupFile(backup);
  assert.equal(restored.getWorkspace(workspaceId)?.image?.dataUrl, photo());
  await save(b, photo(2)); await sb.triggerSync(); await sa.triggerSync();
  assert.equal(a.getWorkspace(workspaceId)?.image?.dataUrl, photo(2));
  await save(a, null); await sa.triggerSync(); await sb.triggerSync();
  await b.importBackupFile(backup);
  assert.equal(b.getWorkspace(workspaceId)?.image?.dataUrl, null, 'An older backup must not resurrect a removed photo');
  assert.equal(a.getTransactions(workspaceId).length, 0); assert.equal(b.getTransactions(workspaceId).length, 0);
});

test('Concurrent photo updates converge in either delivery order and legacy workspace upserts retain the image revision', async () => {
  const { db: a } = await database(), { db: b } = await database();
  await save(a, photo()); await save(b, photo(2));
  const aOps = structuredClone(a.getPendingOutbox()), bOps = structuredClone(b.getPendingOutbox());
  await sync(a).applyBatchOperations(batch(bOps)); await sync(b).applyBatchOperations(batch(aOps));
  assert.deepEqual(a.getWorkspace(workspaceId)?.image, b.getWorkspace(workspaceId)?.image);
  const winner = structuredClone(a.getWorkspace(workspaceId)?.image);
  const { db: legacy } = await database(); legacy.restoreWorkspace(workspaceId); await legacy.waitForPendingWrites();
  await sync(a).applyBatchOperations(batch(legacy.getPendingOutbox()));
  assert.deepEqual(a.getWorkspace(workspaceId)?.image, winner);
  await save(b, null); await sync(a).applyBatchOperations(batch(b.getPendingOutbox()));
  assert.equal(a.getWorkspace(workspaceId)?.image?.dataUrl, null);
  await sync(a).applyBatchOperations(batch(aOps));
  assert.equal(a.getWorkspace(workspaceId)?.image?.dataUrl, null);
});

test('New workspace photo updates wait for their parent and corrupted/foreign/employee media cannot mutate a dataset', async () => {
  const { db: source } = await database(), { db: target } = await database();
  await source.beginTransaction(); const ws = source.createWorkspace('New photo', 'business');
  source.editWorkspace(ws.id, { imageDataUrl: photo() }); await source.commitTransaction();
  const ops = source.getPendingOutbox();
  await sync(target).applyBatchOperations(batch([...ops].reverse()));
  assert.equal(target.getWorkspace(ws.id)?.image?.dataUrl, photo());
  const before = canonicalJson(target.toSerializable());
  const imageOp = ops.find(op => op.type === 'workspace.update')!;
  for (const alteration of [
    (op: SyncOperation) => { op.ownerHash = 'foreign-owner'; },
    (op: SyncOperation) => { op.authorSubjectHash = 'employee'; },
    (op: SyncOperation) => { op.payload.image.dataUrl = photo(3); },
    (op: SyncOperation) => { op.payload.id = workspaceId; },
  ]) {
    const op = structuredClone(imageOp); op.operationId = generateUUID(); alteration(op);
    op.contentSha256 = await computeSha256(canonicalJson(op.payload));
    // Unbound test data still has a local-owner workspace; a foreign operation must not modify it.
    await assert.rejects(sync(target).applyBatchOperations(batch([op])));
    assert.equal(canonicalJson(target.toSerializable()), before);
  }
});

test('Image backup restores missing media and rejects rehashed corrupt images without changing balances or pending records', async () => {
  const { db: source } = await database(); await save(source, photo());
  const journal = buildIncomeJournal({ workspaceId, assetAccountId: 'acc-cash-1', revenueCategoryId: 'cat-salary',
    amountMinor: '50000', effectiveDate: '2026-10-27', opId: generateUUID() });
  await source.commitJournalWithOutbox(journal, { protocolVersion: 1, ownerHash: 'local-owner', deviceId: source.getDeviceId(),
    seq: source.getNextDeviceSeq(), operationId: journal.transaction.createdOpId, entityId: journal.transaction.id,
    type: 'journal.post', payload: { balancedJournal: journal }, createdAtUtc: new Date().toISOString(), contentSha256: '' });
  const file = await source.exportBackupFile();
  const { db } = await database(); db.editWorkspace(workspaceId, { description: 'Existing local description' }); await db.waitForPendingWrites();
  await db.importBackupFile(file); await db.importBackupFile(file);
  assert.equal(db.getWorkspace(workspaceId)?.image?.dataUrl, photo());
  assert.equal(db.getWorkspace(workspaceId)?.description, 'Existing local description');
  assert.equal(db.getTransactions(workspaceId).length, 1); assert.equal(db.verifyLedgerIntegrity(workspaceId).isValid, true);
  const before = canonicalJson(db.toSerializable());
  const data = await decodeBackup(file); data.workspaces.find(([id]: [string]) => id === workspaceId)[1].image.dataUrl = photo(9);
  await assert.rejects(db.importBackupFile(await encodeBackup(data)), /checksum/);
  assert.equal(canonicalJson(db.toSerializable()), before);
  const brokenOp = await decodeBackup(file);
  const op = brokenOp.syncOperations.find(([, item]: [string, SyncOperation]) => item.payload.image)[1];
  op.payload.image.dataUrl = photo(8); op.contentSha256 = await computeSha256(canonicalJson(op.payload));
  await assert.rejects(db.importBackupFile(await encodeBackup(brokenOp)), /BACKUP_CONFLICT/);
  assert.equal(canonicalJson(db.toSerializable()), before);
  const { db: fresh } = await database(); const freshBefore = canonicalJson(fresh.toSerializable());
  await assert.rejects(fresh.importBackupFile(await encodeBackup(brokenOp)), /checksum/);
  assert.equal(canonicalJson(fresh.toSerializable()), freshBefore);
});

test('Upgrade recovers image fields retained in applied operations by an older client, without duplicate outbox operations', async () => {
  const { db: original } = await database(); await save(original, photo()); await save(original, null);
  const olderClientData = structuredClone(original.toSerializable());
  for (const [, workspace] of olderClientData.workspaces) delete workspace.image;
  const { db } = await database(); await db.loadFromSerializable(olderClientData); await db.persist();
  const pending = db.getPendingOutbox().map(op => op.operationId);
  const legacyStore = new WorkspaceMediaStore(new LocalStorageFallbackDriver());
  await legacyStore.save(workspaceId, 'local-owner', photo(3));
  assert.equal(await migrateLegacyWorkspaceImages(db, legacyStore), 1);
  assert.equal(db.getWorkspace(workspaceId)?.image?.dataUrl, null);
  assert.deepEqual(db.getPendingOutbox().map(op => op.operationId), pending);
  assert.equal(await migrateLegacyWorkspaceImages(db, legacyStore), 0);
});

test('Same image revision with different bytes is rejected; numeric revisions ignore wall clock skew', async () => {
  const { db } = await database(); await save(db, photo());
  const current = db.getWorkspace(workspaceId)!.image!;
  const op = structuredClone(db.getPendingOutbox().at(-1)!);
  op.operationId = generateUUID(); op.createdAtUtc = '2000-01-01T00:00:00.000Z';
  op.payload.image = { ...current, dataUrl: photo(2), sha256: workspaceImageHash(photo(2)) };
  op.contentSha256 = await computeSha256(canonicalJson(op.payload));
  await assert.rejects(sync(db).applyBatchOperations(batch([op])), /Conflicting workspace image/);
  op.operationId = generateUUID(); op.payload.image.version++; op.payload.image.revisionId = generateUUID();
  op.contentSha256 = await computeSha256(canonicalJson(op.payload));
  await sync(db).applyBatchOperations(batch([op]));
  assert.equal(db.getWorkspace(workspaceId)?.image?.dataUrl, photo(2));
});
