import type { SyncProvider, PushRequest, PullRequest, RemotePushResult, RemotePullResult } from '../../contracts/financialSync';
import { acceptedSyncOperations, validatePullPage } from '../financialSyncBoundary';

/** Implemented by an authenticated gateway/SDK adapter. It owns credentials, not the UI. */
export interface SyncRpcTransport { call(name:'sync_push'|'sync_pull',request:PushRequest|PullRequest,signal?:AbortSignal):Promise<unknown> }
export class PostgresSyncProvider implements SyncProvider {
  readonly kind='Postgres' as const;
  constructor(private transport:SyncRpcTransport,private timeoutMs=15000) {}
  private async call(name:'sync_push'|'sync_pull',request:PushRequest|PullRequest,signal?:AbortSignal):Promise<unknown> {
    const controller=new AbortController();let rejectAbort!:(reason:Error)=>void;
    const abort=new Promise<never>((_,reject)=>{rejectAbort=reject;});
    const cancel=()=>{controller.abort();rejectAbort(new Error('SYNC_REQUEST_ABORTED'));};
    const timer=setTimeout(cancel,this.timeoutMs);
    if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
    try{return await Promise.race([abort,Promise.resolve().then(()=>{if(controller.signal.aborted)throw Error('SYNC_REQUEST_ABORTED');return this.transport.call(name,request,controller.signal);})]);}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  async push(request:PushRequest,signal?:AbortSignal):Promise<RemotePushResult> {
    const result=await this.call('sync_push',request,signal);
    acceptedSyncOperations(request,result);
    if((result as any).kind!=='remote') throw Error('SYNC_REMOTE_REQUIRED');
    return result as RemotePushResult;
  }
  async pull(request:PullRequest,signal?:AbortSignal):Promise<RemotePullResult> {
    const result=validatePullPage(request,await this.call('sync_pull',request,signal));
    if(!result) throw Error('SYNC_REMOTE_REQUIRED'); return result;
  }
}

/** Credentials are supplied by the Auth adapter through authenticatedFetch. */
export function jsonSyncTransport(endpoint:string,authenticatedFetch:typeof fetch):SyncRpcTransport {
  const url=new URL(endpoint),local=url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname);
  if((url.protocol!=='https:'&&!local)||url.username||url.password||url.hash||url.search)throw Error('SYNC_ENDPOINT_INVALID');
  return {call:async(name,request,signal)=>{
    const body=JSON.stringify({method:name,request});if(new TextEncoder().encode(body).length>1048576)throw Error('SYNC_REQUEST_TOO_LARGE');
    const response=await authenticatedFetch(url.href,{method:'POST',headers:{'Content-Type':'application/json'},body,signal,credentials:'omit',cache:'no-store',redirect:'error'});
    if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))throw Error('SYNC_SERVER_UNAVAILABLE');
    const reader=response.body?.getReader();if(!reader)throw Error('SYNC_RESPONSE_INVALID');
    let bytes=0;const parts:Uint8Array[]=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1048576)throw Error('SYNC_RESPONSE_TOO_LARGE');parts.push(value);}}
    finally{await reader.cancel().catch(()=>{});}
    const output=new Uint8Array(bytes);let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(output));
  }};
}
