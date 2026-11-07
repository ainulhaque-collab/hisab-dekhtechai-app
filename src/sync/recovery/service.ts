import { LocalDatabase } from '../../storage/db';
import { decodeBackup, encodeBackup } from '../../storage/backup';
import { verifyBackupRecovery } from '../../storage/recoveryVerification';
import { computeSha256, canonicalJson } from '../canonical';
import { generateUUID } from '../../domain/journal';

export const RECOVERY_KEY='hisab-supabase-recovery-v1';
export interface RecoveryBinding {customerId:string;datasetId:string;deviceId:string}
export interface RecoveryCopy {id:string;datasetId:string;deviceId:string;sha256:string;createdAt:string}
export interface RecoveryTransport {
  list(signal:AbortSignal):Promise<RecoveryCopy[]>;
  put(binding:RecoveryBinding,text:string,signal:AbortSignal):Promise<RecoveryCopy>;
  get(id:string,signal:AbortSignal):Promise<{copy:RecoveryCopy;text:string}>;
}
export interface RecoveryState {phase:'disabled'|'signed_out'|'ready'|'working'|'verified'|'pending'|'error';verifiedAt:string|null;copies:RecoveryCopy[];error:string|null}
export interface RecoveryAuth {customerId:string;generation:number}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class RecoveryService {
  private state:RecoveryState={phase:'disabled',verifiedAt:null,copies:[],error:null};
  private listeners=new Set<()=>void>();private running:Promise<void>|null=null;private controller:AbortController|null=null;
  private verifiedDigest:string|null=null;private epoch=0;
  constructor(private db:LocalDatabase,private auth:()=>RecoveryAuth|null,private transport:(auth:RecoveryAuth)=>RecoveryTransport){}
  snapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private update(patch:Partial<RecoveryState>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  cancel(){this.epoch++;this.controller?.abort();this.verifiedDigest=null;this.update({phase:this.auth()?'pending':'signed_out',verifiedAt:null,copies:[],error:null});}
  binding():RecoveryBinding|null{return this.db.getRawState().preferences.get(RECOVERY_KEY)||null;}
  markPending(){if(this.binding())this.update({phase:'pending'});}
  private async snapshotData(){const data=await decodeBackup(await this.db.exportBackupFile());data.preferences=(data.preferences||[]).filter(([key]:[string,unknown])=>key!==RECOVERY_KEY);return data;}
  private context(){const auth=this.auth();if(!auth||!uuid.test(auth.customerId))throw Error('RECOVERY_SIGN_IN');const epoch=this.epoch;
    const active=()=>{const now=this.auth();if(epoch!==this.epoch||now?.customerId!==auth.customerId||now.generation!==auth.generation)throw Error('RECOVERY_SESSION_CHANGED');};
    const controller=new AbortController();this.controller=controller;return{auth,active,transport:this.transport(auth),signal:controller.signal};}
  private async job(work:()=>Promise<void>){if(this.running)return this.running;
    this.running=(async()=>{try{await work();}catch(error){const code=error instanceof Error?error.message:'';
      if(code!=='RECOVERY_SESSION_CHANGED')this.update({phase:'error',error:['RECOVERY_SIGN_IN','RECOVERY_OTHER_ACCOUNT','RECOVERY_NOT_EMPTY','RECOVERY_VERIFY','RECOVERY_TOO_LARGE','RECOVERY_LIMIT'].includes(code)?code:'RECOVERY_UNAVAILABLE'});
    }finally{this.controller=null;}})().finally(()=>{this.running=null;});return this.running;}
  refresh=()=>this.job(async()=>{this.update({phase:'working'});await this.db.init();const c=this.context();const copies=await c.transport.list(c.signal);c.active();this.update({copies,phase:this.binding()?'pending':'disabled',error:null});});
  enable=()=>this.job(async()=>{this.update({phase:'working'});await this.db.init();await this.db.waitForPendingWrites();const c=this.context();const old=this.binding();
    if(old&&old.customerId!==c.auth.customerId)throw Error('RECOVERY_OTHER_ACCOUNT');
    // A file backup is validated before linking this local namespace to a verified customer.
    await verifyBackupRecovery(await this.db.exportBackupFile());c.active();
    if(!old){if(this.db.isTransactionInProgress())throw Error('RECOVERY_UNAVAILABLE');await this.db.beginTransaction();try{
      c.active();this.db.getRawState().preferences.set(RECOVERY_KEY,{customerId:c.auth.customerId,datasetId:generateUUID(),deviceId:generateUUID()});await this.db.commitTransaction();
    }catch(error){await this.db.rollbackTransaction();throw error;}}
    this.update({phase:'pending',error:null});
  }).then(()=>this.run());
  run=()=>this.job(async()=>{await this.db.init();const binding=this.binding();if(!binding)return;
    const c=this.context();if(binding.customerId!==c.auth.customerId)throw Error('RECOVERY_OTHER_ACCOUNT');
    this.update({phase:'working',error:null});
    const original=await this.snapshotData();c.active();
    const digest=await computeSha256(canonicalJson(original));
    if(this.verifiedDigest===digest){this.update({phase:'verified'});return;}
    const text=await encodeBackup(original);await verifyBackupRecovery(text);c.active();
    const copy=await c.transport.put(binding,text,c.signal);c.active();
    const remote=await c.transport.get(copy.id,c.signal);c.active();
    if(remote.copy.id!==copy.id||remote.copy.datasetId!==binding.datasetId||remote.copy.deviceId!==binding.deviceId||
      remote.copy.sha256!==await computeSha256(text)||remote.text!==text)throw Error('RECOVERY_VERIFY');
    await verifyBackupRecovery(remote.text);c.active();this.verifiedDigest=digest;
    const currentDigest=await computeSha256(canonicalJson(await this.snapshotData()));c.active();
    this.update({phase:currentDigest===digest?'verified':'pending',verifiedAt:new Date().toISOString(),copies:[copy,...this.state.copies.filter(x=>x.id!==copy.id)].slice(0,30),error:null});
  });
  restore=(id:string)=>this.job(async()=>{if(!uuid.test(id))throw Error('RECOVERY_VERIFY');await this.db.init();const c=this.context();
    if(!this.db.hasOnlyUntouchedStarters()||this.binding())throw Error('RECOVERY_NOT_EMPTY');
    this.update({phase:'working',error:null});const remote=await c.transport.get(id,c.signal);c.active();
    if(remote.copy.id!==id||remote.copy.sha256!==await computeSha256(remote.text))throw Error('RECOVERY_VERIFY');
    await verifyBackupRecovery(remote.text);c.active();
    const binding={customerId:c.auth.customerId,datasetId:remote.copy.datasetId,deviceId:generateUUID()};
    await this.db.restoreVerifiedCloudBackup(remote.text,binding,c.active);c.active();this.verifiedDigest=null;
    this.update({phase:'pending',error:null});
  });
}
