import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { verifyBackupRecovery } from '../storage/recoveryVerification';
import { receiptFromBytes } from '../storage/receipts';
import { buildIncomeJournal, generateUUID } from '../domain/journal';
import { canonicalJson, computeSha256Sync } from '../sync/canonical';
import { decodeBackup, encodeBackup } from '../storage/backup';
import { computeOwnerSubjectHash } from '../auth/googleAuth';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import { SyncOrchestrator } from '../sync/orchestrator';

test('isolated recovery opens an authenticated combined media/metadata backup without any localStorage or source mutation',async()=>{
  const source = new LocalDatabase(`recovery-qa-${generateUUID()}`,new LocalStorageFallbackDriver()); await source.init();
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lIAAAAAASUVORK5CYII=','base64'));
  const blob = receiptFromBytes(png,'image/png','Synthetic receipt.png');
  const journal = buildIncomeJournal({workspaceId:'ws-personal-default',assetAccountId:'acc-cash-1',revenueCategoryId:'cat-salary',amountMinor:'10000',effectiveDate:'2026-10-29',opId:generateUUID(),receiptBlobSha256:blob.sha256,receiptName:blob.fileName});
  const payload = {balancedJournal:journal};
  await source.commitJournalWithOutbox(journal,{protocolVersion:1,ownerHash:'local-owner',deviceId:source.getDeviceId(),seq:source.getNextDeviceSeq(),operationId:journal.transaction.createdOpId,entityId:journal.transaction.id,type:'journal.post',payload,createdAtUtc:new Date().toISOString(),contentSha256:computeSha256Sync(canonicalJson(payload))},blob);
  await source.beginTransaction();
  source.editWorkspace('ws-personal-default',{imageDataUrl:`data:image/jpeg;base64,${Buffer.from([255,216,255,224,1,255,217]).toString('base64')}`});
  await source.commitTransaction();
  await source.setTransactionBookmark(journal.transaction.id,true);
  await source.recordReconciliation('ws-personal-default','acc-cash-1','9999');
  const subjectId = `isolated-recovery-${generateUUID()}`;
  await new SyncOrchestrator(source,new SimulatedGoogleDriveTransport()).bootstrapAndRestore({subjectId,subjectHash:await computeOwnerSubjectHash(subjectId),email:'qa@example.invalid',displayName:'Synthetic',isDriveAuthorized:true,accessToken:'synthetic'},true);
  const text = await source.exportBackupFile(), before = canonicalJson(source.toSerializable());
  const original = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('Recovery must not touch browser storage');}});
  try {
    const result = await verifyBackupRecovery(text);
    assert.equal(result.transactions,1); assert.equal(result.media,1); assert.equal(result.workspaces,2);
    assert.equal(canonicalJson(source.toSerializable()),before);
    const corrupted = await decodeBackup(text); corrupted.receiptBlobs[0][1].byteLength++;
    await assert.rejects(verifyBackupRecovery(await encodeBackup(corrupted)),/Receipt size/);
    await assert.rejects(verifyBackupRecovery(text.replace('"sha256":"','"sha256":"bad')),/BACKUP_CHECKSUM/);
    assert.equal(canonicalJson(source.toSerializable()),before);
  } finally {
    if(original) Object.defineProperty(globalThis,'localStorage',original); else Reflect.deleteProperty(globalThis,'localStorage');
  }
});
