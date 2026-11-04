import type { SyncAuthPort,SyncScope,SyncProvider,PushRequest,PullRequest,PushOutcome } from '../../contracts/financialSync';
import { acceptedSyncOperations } from '../financialSyncBoundary';
import type { DatabaseSyncStore } from './localStore';
import { generateUUID } from '../../domain/journal';

export class PostgresSyncEngine {
  private running:Promise<SyncRun>|null=null;
  private epoch=0;
  private controller:AbortController|null=null;
  private retryAt=0;
  private failures=0;
  constructor(private deps:{store:DatabaseSyncStore;provider:SyncProvider;auth:SyncAuthPort;authIssuer:string;scope:SyncScope;online:()=>boolean;now?:()=>number}) {
    if(!deps.authIssuer)throw Error('SYNC_AUTH_ISSUER_REQUIRED');
  }
  cancel():void { this.epoch++; this.controller?.abort(); }
  run():Promise<SyncRun> {
    if(this.running) return this.running;
    this.running=this.execute().finally(()=>{this.running=null;}); return this.running;
  }
  private async execute():Promise<SyncRun> {
    const d=this.deps,now=d.now??Date.now;
    if(!d.online()) return {state:'offline',acknowledged:0};
    if(now()<this.retryAt) return {state:'retry_later',acknowledged:0};
    const epoch=this.epoch;
    this.controller=new AbortController(); const signal=this.controller.signal;
    const active=async()=>{const user=await d.auth.getVerifiedIdentity();if(epoch!==this.epoch || signal.aborted || user?.subject!==d.scope.ownerId || user.issuer!==d.authIssuer)throw Error('SYNC_SESSION_CHANGED'); d.store.assertScope(d.scope);};
    let acknowledged=0,blocked=false,retry=false;
    try {
      await active();
      const pending=await d.store.readPending(d.scope,100); await active();
      const operations=[] as typeof pending[number][];let bytes=1024;
      for(const op of pending){const size=new TextEncoder().encode(JSON.stringify(op)).length+1;if(bytes+size>900000)break;operations.push(op);bytes+=size;}
      if(operations.length) {
        const request:PushRequest={requestId:generateUUID(),scope:d.scope,operations};
        const response=await d.provider.push(request,signal); await active();
        const accepted=acceptedSyncOperations(request,response);
        const outcomes=response.kind==='remote'?response.outcomes:[];
        blocked=outcomes.some(x=>['conflict','rejected'].includes(x.outcome));retry=outcomes.some(x=>x.outcome==='retry');
        await d.store.acknowledge(d.scope,accepted,()=>epoch===this.epoch&&!signal.aborted);
        acknowledged=accepted.length;
        await d.store.recordOutcomes(d.scope,outcomes as readonly PushOutcome[]);
      }
      // Bound each run; later runs resume from the durable cursor, never the clock.
      let more=false;
      for(let n=0;n<20;n++) {
        await active(); const cursor=await d.store.readCursor(d.scope);
        const request:PullRequest={requestId:generateUUID(),scope:d.scope,cursor,limit:100};
        const page=await d.provider.pull(request,signal); await active();
        if(page.kind==='local_only') return {state:'local_only',acknowledged};
        await d.store.applyPullPageAtomically(d.scope,cursor,page,()=>epoch===this.epoch&&!signal.aborted);
        more=page.hasMore;if(!more)break;
      }
      if(retry&&!blocked){this.retryAt=now()+Math.min(60000,1000*2**Math.min(this.failures++,6));return{state:'retry_later',acknowledged};}
      this.failures=0;this.retryAt=0;
      return {state:blocked?'blocked':more||d.store.pendingCount(d.scope)>0?'pending':'caught_up',acknowledged};
    } catch(error) {
      if(epoch!==this.epoch || signal.aborted || (error as Error)?.message==='SYNC_SESSION_CHANGED')return{state:'session_changed',acknowledged};
      if(blocked || ['SYNC_IMMUTABLE_CONFLICT','SYNC_COMMAND_UNSUPPORTED'].includes((error as Error)?.message))return{state:'blocked',acknowledged};
      this.retryAt=now()+Math.min(60000,1000*2**Math.min(this.failures++,6));
      return {state:'retry_later',acknowledged};
    } finally {this.controller=null;}
  }
}
export interface SyncRun {state:'offline'|'retry_later'|'session_changed'|'local_only'|'blocked'|'pending'|'caught_up';acknowledged:number}
