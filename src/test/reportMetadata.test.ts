import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { buildIncomeJournal, generateUUID } from '../domain/journal';
import { canonicalJson, computeSha256Sync } from '../sync/canonical';
import { decodeBackup, encodeBackup } from '../storage/backup';
import { financialFingerprint } from '../sync/cloudBackup';
import { isReportOperation, projectReportMetadata, reconciliationFingerprint, validateReportOperations } from '../storage/reportMetadata';
import { SyncOrchestrator } from '../sync/orchestrator';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import type { SyncOperation } from '../contracts/types';

const ws = 'ws-personal-default';
async function seed() {
  const driver = new LocalStorageFallbackDriver(), db = new LocalDatabase(`report-${generateUUID()}`,driver); await db.init();
  const journal = buildIncomeJournal({workspaceId:ws,assetAccountId:'acc-cash-1',revenueCategoryId:'cat-salary',amountMinor:'10000',effectiveDate:'2026-10-29',opId:generateUUID()});
  const payload = {balancedJournal:journal};
  await db.commitJournalWithOutbox(journal,{protocolVersion:1,ownerHash:'local-owner',deviceId:db.getDeviceId(),seq:db.getNextDeviceSeq(),operationId:journal.transaction.createdOpId,entityId:journal.transaction.id,type:'journal.post',payload,createdAtUtc:new Date().toISOString(),contentSha256:computeSha256Sync(canonicalJson(payload))});
  return {db,driver,id:journal.transaction.id};
}
const metadataOps = (db:LocalDatabase) => [...db.getRawState().syncOperations.values()].filter(isReportOperation);
async function replica(source:LocalDatabase) {
  const db = new LocalDatabase(`report-replica-${generateUUID()}`,new LocalStorageFallbackDriver()); await db.init();
  await db.loadFromSerializable(structuredClone(source.toSerializable())); db.setDeviceIdentity(generateUUID(),'Synthetic metadata replica'); await db.persist(); return db;
}

test('bookmarks/reconciliation are atomic durable metadata; journals and balances never change',async()=>{
  const {db,id} = await seed(); const before = structuredClone(db.toSerializable());
  const balances = canonicalJson(db.calculateAccountSummaries(ws)); const fingerprint = await financialFingerprint(before);
  await db.setTransactionBookmark(id,true); await db.recordReconciliation(ws,'acc-cash-1','9700','Synthetic count');
  assert.equal(db.getReportMetadata(ws).bookmarks.get(id)?.enabled,true);
  const check = db.getReportMetadata(ws).reconciliations[0];
  assert.equal(check.expectedMinor,'10000'); assert.equal(check.actualMinor,'9700');
  assert.equal(check.fingerprint,reconciliationFingerprint(db.getAccount('acc-cash-1')!,db.getTransactions(ws)));
  assert.equal(canonicalJson(db.calculateAccountSummaries(ws)),balances);
  assert.equal(canonicalJson(db.toSerializable().journalTransactions),canonicalJson(before.journalTransactions));
  assert.equal(canonicalJson(db.toSerializable().journalLines),canonicalJson(before.journalLines));
  assert.equal(db.getSchemaVersion(),6); assert.notEqual(await financialFingerprint(db.toSerializable()),fingerprint);
  const target = await replica(db); assert.equal(target.getReportMetadata(ws).bookmarks.get(id)?.enabled,true);
  const fresh = new LocalDatabase(`restore-${generateUUID()}`,new LocalStorageFallbackDriver()); await fresh.init();
  await fresh.importBackupFile(await db.exportBackupFile());
  assert.equal(fresh.getReportMetadata(ws).bookmarks.get(id)?.enabled,true);
  assert.equal(fresh.getReportMetadata(ws).reconciliations[0].actualMinor,'9700');
  assert.equal(canonicalJson(fresh.calculateAccountSummaries(ws)),balances);
});

test('metadata failure rolls back outbox/revision with no journal or balance mutation',async()=>{
  const {db,driver,id} = await seed(); const before = canonicalJson(db.toSerializable()); driver.faultInjection='throw_on_commit';
  await assert.rejects(db.setTransactionBookmark(id,true));
  assert.equal(canonicalJson(db.toSerializable()),before); assert.equal(db.getReportMetadata(ws).bookmarks.has(id),false);
  driver.faultInjection='none'; db.clearPersistenceError();
  await db.setTransactionBookmark(id,true); assert.equal(db.getReportMetadata(ws).bookmarks.get(id)?.revision,1);
});

test('concurrent bookmark removal wins independently of arrival order and clock skew; a later re-add is allowed',async()=>{
  const {db,id} = await seed(); await db.setTransactionBookmark(id,true);
  const second = await replica(db), third = await replica(db);
  await second.setTransactionBookmark(id,false); await third.setTransactionBookmark(id,true);
  const operations = [...metadataOps(second),...metadataOps(third)];
  assert.equal(projectReportMetadata(operations,ws).bookmarks.get(id)?.enabled,false);
  assert.equal(projectReportMetadata([...operations].reverse(),ws).bookmarks.get(id)?.enabled,false);
  await second.setTransactionBookmark(id,true);
  assert.equal(projectReportMetadata([...metadataOps(third),...metadataOps(second)],ws).bookmarks.get(id)?.enabled,true);
});

test('retained metadata replays through the real sync apply path and validates old-client hydration',async()=>{
  const {db,id} = await seed(), target = await replica(db);
  await db.setTransactionBookmark(id,true); await db.recordReconciliation(ws,'acc-cash-1','-500','Synthetic overdraft');
  const operations = metadataOps(db); const sync = new SyncOrchestrator(target,new SimulatedGoogleDriveTransport());
  await sync.applyBatchOperations({protocolVersion:1,ownerHash:'local-owner',deviceId:db.getDeviceId(),batchId:generateUUID(),fromSeq:operations[0].seq,toSeq:operations.at(-1)!.seq,operations,batchSha256:'',byteLength:0,createdAtUtc:new Date().toISOString()});
  assert.equal(target.getReportMetadata(ws).bookmarks.get(id)?.enabled,true);
  assert.equal(target.getReportMetadata(ws).reconciliations[0].actualMinor,'-500');
  const old = target.toSerializable();
  const restored = await replica(target); await restored.loadFromSerializable(old);
  assert.equal(restored.getReportMetadata(ws).bookmarks.get(id)?.enabled,true);
});

test('foreign owners/authors/references, injected workspace changes and tampered backups are rejected',async()=>{
  const {db,id} = await seed(); await db.setTransactionBookmark(id,true);
  const state = db.getRawState(), original = metadataOps(db)[0];
  const check = (op:SyncOperation) => validateReportOperations([op],state.workspaces,state.accounts,state.journalTransactions);
  assert.throws(()=>check({...original,ownerHash:'foreign'}),/REPORT_METADATA_OWNER/);
  assert.throws(()=>check({...original,authorSubjectHash:'foreign'}),/REPORT_METADATA_OWNER/);
  assert.throws(()=>check({...original,payload:{...original.payload,name:'injected'}}),/REPORT_METADATA_OWNER/);
  assert.throws(()=>check({...original,contentSha256:'f'.repeat(64)}),/REPORT_METADATA_CHECKSUM/);
  const data = await decodeBackup(await db.exportBackupFile());
  const entry = data.syncOperations.find(([,op]:[string,SyncOperation])=>isReportOperation(op))[1];
  entry.payload.reportEvent.enabled='malformed'; entry.contentSha256=computeSha256Sync(canonicalJson(entry.payload));
  const before = canonicalJson(db.toSerializable());
  const tampered = await encodeBackup(data);
  await assert.rejects(db.importBackupFile(tampered),/BACKUP_CONFLICT/);
  assert.equal(canonicalJson(db.toSerializable()),before);
  const fresh = new LocalDatabase(`invalid-restore-${generateUUID()}`,new LocalStorageFallbackDriver()); await fresh.init();
  const freshBefore = canonicalJson(fresh.toSerializable());
  await assert.rejects(fresh.importBackupFile(tampered),/REPORT_METADATA_INVALID/);
  assert.equal(canonicalJson(fresh.toSerializable()),freshBefore);
  const foreignWorkspace = {...db.getWorkspace(ws)!,id:'foreign-workspace'};
  const foreignPayload = {id:foreignWorkspace.id,reportEvent:original.payload.reportEvent};
  assert.throws(()=>validateReportOperations([{...original,entityId:foreignWorkspace.id,payload:foreignPayload,contentSha256:computeSha256Sync(canonicalJson(foreignPayload))}],new Map([...state.workspaces,[foreignWorkspace.id,foreignWorkspace]]),state.accounts,state.journalTransactions),/REPORT_METADATA_REFERENCE/);
});

test('a changed wallet journal invalidates the historical check without altering its immutable record',async()=>{
  const {db} = await seed(); await db.recordReconciliation(ws,'acc-cash-1','10000');
  const original = structuredClone(db.getReportMetadata(ws).reconciliations[0]);
  const account = db.getAccount('acc-cash-1')!;
  assert.equal(original.fingerprint,reconciliationFingerprint(account,db.getTransactions(ws)));
  const later = buildIncomeJournal({workspaceId:ws,assetAccountId:account.id,revenueCategoryId:'cat-salary',amountMinor:'1',effectiveDate:'2026-10-29',opId:generateUUID()});
  assert.notEqual(original.fingerprint,reconciliationFingerprint(account,[...db.getTransactions(ws),{...later.transaction,lines:later.lines}]));
  assert.deepEqual(db.getReportMetadata(ws).reconciliations[0],original);
});
