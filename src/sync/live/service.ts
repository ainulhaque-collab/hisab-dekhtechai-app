import {LocalDatabase} from '../../storage/db';
import {generateUUID} from '../../domain/journal';
import {canonicalJson} from '../canonical';
import {LIVE_KEY,liveCore,coreHash,baseHashes,mergeLive,validateLiveCore,type LiveCheckpoint,type LiveCore,LiveConflict} from './state';
import {RECOVERY_KEY,type RecoveryAuth,type RecoveryBinding} from '../recovery/service';

export interface LiveHead {datasetId:string;revision:string;sha256:string;updatedAt:string}
export interface LiveDocument {head:LiveHead;core:LiveCore}
export interface LiveTransport {
  head(signal:AbortSignal):Promise<LiveHead|null>;
  get(signal:AbortSignal):Promise<LiveDocument>;
  put(datasetId:string,expectedRevision:string,core:LiveCore,signal:AbortSignal):Promise<{kind:'accepted'|'stale';head:LiveHead}>;
}
export interface LiveStatus {phase:'disabled'|'connecting'|'syncing'|'synced'|'offline'|'conflict'|'error';lastSyncedAt:string|null;error:string|null;conflicts:string[];realtime:'connecting'|'connected'|'fallback'}
export class LiveSyncService {
  private status:LiveStatus={phase:'disabled',lastSyncedAt:null,error:null,conflicts:[],realtime:'connecting'};private listeners=new Set<()=>void>();
  private running:Promise<void>|null=null;private controller:AbortController|null=null;private epoch=0;private dirty=false;
  constructor(private db:LocalDatabase,private auth:()=>RecoveryAuth|null,private transport:(auth:RecoveryAuth)=>LiveTransport,private online=()=>true,private changed=()=>{}){}
  snapshot=()=>this.status;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private update(patch:Partial<LiveStatus>){this.status={...this.status,...patch};this.listeners.forEach(fn=>fn());}
  realtime(state:LiveStatus['realtime']){this.update({realtime:state});}
  cancel(){this.epoch++;this.controller?.abort();this.update({phase:'disabled',lastSyncedAt:null,error:null,conflicts:[]});}
  markPending(){this.dirty=true;if(this.status.phase==='synced')this.update({phase:'syncing'});}
  checkpoint():LiveCheckpoint|null{return this.db.getRawState().preferences.get(LIVE_KEY)||null;}
  run=():Promise<void>=>{if(this.running){this.dirty=true;return this.running;}
    this.running=this.execute().finally(()=>{this.running=null;});return this.running;
  };
  private async execute(){if(!this.online()){this.update({phase:'offline'});return;}const auth=this.auth();if(!auth){this.update({phase:'disabled'});return;}
    const epoch=this.epoch,controller=new AbortController();this.controller=controller;
    const active=()=>{const now=this.auth();if(epoch!==this.epoch||controller.signal.aborted||now?.customerId!==auth.customerId||now.generation!==auth.generation)throw Error('LIVE_SESSION_CHANGED');};
    try{
      await this.db.init();await this.db.waitForPendingWrites();active();if(this.db.isTransactionInProgress())throw Error('LIVE_STORAGE_BUSY');
      const transport=this.transport(auth);this.update({phase:'syncing',error:null,conflicts:[]});
      for(let attempt=0;attempt<4;attempt++){
        this.dirty=false;active();const binding:RecoveryBinding|undefined=this.db.getRawState().preferences.get(RECOVERY_KEY);
        if(binding&&binding.customerId!==auth.customerId)throw Error('LIVE_OTHER_ACCOUNT');
        const head=await transport.head(controller.signal);active();
        if(!binding){
          if(!head){this.update({phase:'disabled',error:'LIVE_ENABLE_BACKUP_FIRST'});return;}
          if(!this.db.hasOnlyUntouchedStarters())throw Error('LIVE_NOT_EMPTY');
          const document=await transport.get(controller.signal);active();this.verify(document);
          const checkpoint=this.receipt(auth,document.head,document.core);
          await this.db.applyLiveState(document.core,{},checkpoint,{customerId:auth.customerId,datasetId:document.head.datasetId,deviceId:generateUUID()},active,true);
          active();this.changed();continue;
        }
        if(head&&head.datasetId!==binding.datasetId)throw Error('LIVE_OTHER_DATASET');
        const cp=this.checkpoint();if(cp&&(cp.customerId!==auth.customerId||cp.datasetId!==binding.datasetId))throw Error('LIVE_OTHER_ACCOUNT');
        const captured=liveCore(await this.capture());validateLiveCore(captured);
        if(head&&cp?.revision===head.revision&&cp.sha256===head.sha256&&coreHash(captured)===head.sha256){this.update({phase:'synced',lastSyncedAt:new Date().toISOString(),error:null});return;}
        const document=head?await transport.get(controller.signal):null;active();if(document)this.verify(document);
        if(document&&document.head.datasetId!==binding.datasetId)throw Error('LIVE_OTHER_DATASET');
        if(document&&!cp&&coreHash(captured)!==document.head.sha256)throw Error('LIVE_BASE_REQUIRED');
        const expectedBase=cp?.base||(document?baseHashes(document.core):baseHashes(captured));
        const merged=document?mergeLive(expectedBase,captured,document.core):captured;
        const reply=await transport.put(binding.datasetId,document?.head.revision||'0',merged,controller.signal);active();
        if(reply.kind==='stale')continue;
        if(reply.head.datasetId!==binding.datasetId||reply.head.sha256!==coreHash(merged))throw Error('LIVE_VERIFY');
        const expected=BigInt(document?.head.revision||'0');
        if(BigInt(reply.head.revision)<expected||(!document||document.head.sha256!==coreHash(merged))&&BigInt(reply.head.revision)<=expected)throw Error('LIVE_VERIFY');
        const readback=await transport.get(controller.signal);active();this.verify(readback);
        if(BigInt(readback.head.revision)<BigInt(reply.head.revision)||readback.head.datasetId!==binding.datasetId)throw Error('LIVE_VERIFY');
        if(readback.head.revision===reply.head.revision&&(readback.head.sha256!==reply.head.sha256||canonicalJson(readback.core)!==canonicalJson(merged)))throw Error('LIVE_VERIFY');
        // The CAS acknowledgement proves this revision committed; a later valid
        // revision is pulled using this exact accepted baseline on the next pass.
        await this.db.applyLiveState(merged,baseHashes(captured),this.receipt(auth,reply.head,merged),binding,active);active();this.changed();
        if(readback.head.revision!==reply.head.revision)continue;
        const now=liveCore(await this.capture());active();
        if(coreHash(now)!==reply.head.sha256)continue;
        this.update({phase:'synced',lastSyncedAt:new Date().toISOString(),error:null});return;
      }
      this.update({phase:'syncing'});
    }catch(error){const code=error instanceof Error?error.message:'';if(code==='LIVE_SESSION_CHANGED')return;
      this.update({phase:error instanceof LiveConflict?'conflict':code==='LIVE_STORAGE_BUSY'?'syncing':'error',error:code.startsWith('LIVE_')?code:'LIVE_UNAVAILABLE',conflicts:error instanceof LiveConflict?error.paths:[]});
    }finally{if(this.controller===controller)this.controller=null;}
  }
  private capture(){return this.db.exportBackupFile().then(text=>JSON.parse(JSON.parse(text).dataJson));}
  private verify(document:LiveDocument){validateLiveCore(document.core);if(coreHash(document.core)!==document.head.sha256)throw Error('LIVE_VERIFY');}
  private receipt(auth:RecoveryAuth,head:LiveHead,core:LiveCore):LiveCheckpoint{return{customerId:auth.customerId,datasetId:head.datasetId,revision:head.revision,sha256:head.sha256,base:baseHashes(core)};}
}
