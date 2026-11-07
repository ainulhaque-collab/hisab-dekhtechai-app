import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalDatabase} from '../storage/db';
import {LocalStorageFallbackDriver} from '../storage/drivers/durableStorage';
import {RecoveryService,RECOVERY_KEY,type RecoveryTransport,type RecoveryCopy} from '../sync/recovery/service';
import {generateUUID} from '../domain/journal';
import {createMasterWallet,walletSummaries,changeMasterWallet} from '../storage/walletBook';
import {canonicalJson,computeSha256} from '../sync/canonical';
import {decodeBackup} from '../storage/backup';
import {financialFingerprint} from '../sync/cloudBackup';

async function fixture(){const db=new LocalDatabase(`recovery-${generateUUID()}`,new LocalStorageFallbackDriver());await db.init();
  db.setIdentity('synthetic-legacy-owner');for(const w of db.getRawState().workspaces.values())w.ownerSubjectHash='synthetic-legacy-owner';
  const wallet=await createMasterWallet(db,{id:generateUUID(),name:'Synthetic wallet',kind:'bkash',openingBalanceMinor:'12080'});
  await db.waitForPendingWrites();return{db,wallet};}
function remote(){const rows=new Map<string,{copy:RecoveryCopy;text:string}>();let uploads=0,broken=false;let wait:Promise<void>|null=null;
  const transport:RecoveryTransport={list:async()=>[...rows.values()].map(r=>r.copy),put:async(b,text)=>{uploads++;if(wait)await wait;
    const copy={id:generateUUID(),datasetId:b.datasetId,deviceId:b.deviceId,sha256:await computeSha256(text),createdAt:new Date().toISOString()};rows.set(copy.id,{copy,text});return copy;},
    get:async id=>{const row=rows.get(id);if(!row)throw Error('NOT_FOUND');return{...row,text:broken?row.text+' ':row.text};}};
  return{transport,rows,get uploads(){return uploads;},set broken(v:boolean){broken=v;},set wait(v:Promise<void>|null){wait=v;}};}

test('recovery: complete wallet lifecycle copy verifies, unchanged runs do not upload; new install restores without changing namespace or reusing device identity',async()=>{
  const {db,wallet}=await fixture(),r=remote(),auth={customerId:generateUUID(),generation:0};
  await changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'rename',name:'Renamed wallet'});
  const service=new RecoveryService(db,()=>auth,()=>r.transport);await service.enable();assert.equal(service.snapshot().phase,'verified');assert.equal(r.uploads,1);
  await service.run();assert.equal(r.uploads,1);const original=await decodeBackup(await db.exportBackupFile());const originalIdentity=db.getIdentity();
  const second=new LocalDatabase(`new-install-${generateUUID()}`,new LocalStorageFallbackDriver());await second.init();const newDevice=second.getDeviceId();
  const receiver=new RecoveryService(second,()=>auth,()=>r.transport);await receiver.refresh();assert.equal(receiver.snapshot().copies.length,1);
  await receiver.restore(receiver.snapshot().copies[0].id);assert.equal(receiver.snapshot().phase,'pending');
  assert.equal(canonicalJson(second.getIdentity()),canonicalJson(originalIdentity));assert.equal(second.getDeviceId(),newDevice);
  assert.equal(await financialFingerprint(second.toSerializable()),await financialFingerprint(original));assert.equal(walletSummaries(second)[0].wallet.name,'Renamed wallet');
  assert.notEqual(receiver.binding()?.deviceId,service.binding()?.deviceId);await receiver.run();assert.equal(receiver.snapshot().phase,'verified');
});
test('recovery: corrupted readback never reports success; local ledger/outbox survive; retry verifies',async()=>{
  const {db}=await fixture(),r=remote(),auth={customerId:generateUUID(),generation:0};const before=canonicalJson(db.toSerializable());r.broken=true;
  const service=new RecoveryService(db,()=>auth,()=>r.transport);await service.enable();assert.equal(service.snapshot().phase,'error');assert.equal(service.snapshot().verifiedAt,null);
  const after=db.toSerializable();after.preferences=after.preferences.filter(([k]:[string,unknown])=>k!==RECOVERY_KEY);assert.equal(canonicalJson(after),before);
  r.broken=false;await service.run();assert.equal(service.snapshot().phase,'verified');
});
test('recovery: sign-out cancels late acknowledgement and another account cannot upload bound records',async()=>{
  const {db}=await fixture(),r=remote();let auth:{customerId:string;generation:number}|null={customerId:generateUUID(),generation:0};let release!:()=>void;
  r.wait=new Promise<void>(resolve=>release=resolve);const service=new RecoveryService(db,()=>auth,()=>r.transport);const enabling=service.enable();
  while(!r.uploads)await new Promise(resolve=>setTimeout(resolve,5));auth=null;service.cancel();release();await enabling;
  assert.notEqual(service.snapshot().phase,'verified');const uploads=r.uploads;auth={customerId:generateUUID(),generation:1};await service.run();assert.equal(service.snapshot().error,'RECOVERY_OTHER_ACCOUNT');assert.equal(r.uploads,uploads);
});
test('recovery: restore refuses existing records and malformed/mismatched remote copy, retaining local state',async()=>{
  const {db}=await fixture(),r=remote(),auth={customerId:generateUUID(),generation:0};const service=new RecoveryService(db,()=>auth,()=>r.transport);await service.enable();
  const before=canonicalJson(db.toSerializable());await service.restore(service.snapshot().copies[0].id);assert.equal(service.snapshot().error,'RECOVERY_NOT_EMPTY');assert.equal(canonicalJson(db.toSerializable()),before);
  const fresh=new LocalDatabase(`fresh-${generateUUID()}`,new LocalStorageFallbackDriver());await fresh.init();const receiver=new RecoveryService(fresh,()=>auth,()=>r.transport);
  r.broken=true;const baseline=canonicalJson(fresh.toSerializable());await receiver.restore([...r.rows.keys()][0]);assert.equal(receiver.snapshot().error,'RECOVERY_VERIFY');assert.equal(canonicalJson(fresh.toSerializable()),baseline);
});
test('recovery: a save during upload remains pending until that newer wallet revision is backed up',async()=>{
  const {db,wallet}=await fixture(),r=remote(),auth={customerId:generateUUID(),generation:0};let release!:()=>void;
  r.wait=new Promise<void>(resolve=>release=resolve);const service=new RecoveryService(db,()=>auth,()=>r.transport);const enabling=service.enable();
  while(!r.uploads)await new Promise(resolve=>setTimeout(resolve,5));
  await changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'rename',name:'Changed during upload'});release();await enabling;
  assert.equal(service.snapshot().phase,'pending');r.wait=null;await service.run();assert.equal(service.snapshot().phase,'verified');assert.equal(r.uploads,2);
});
