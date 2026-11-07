import {createClient} from '@supabase/supabase-js';
import {canonicalJson} from '../canonical';
import {coreHash,type LiveCore} from './state';
import type {LiveHead,LiveTransport} from './service';
import type {RecoveryAuth} from '../recovery/service';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function liveTransport(config:{projectUrl:string;publishableKey:string},auth:RecoveryAuth,token:(a:RecoveryAuth)=>Promise<string>,fetchFn:typeof fetch=fetch):LiveTransport&{watch:(changed:()=>void,connection?:(state:'connecting'|'connected'|'fallback')=>void)=>()=>void}{
 const url=new URL(config.projectUrl);if(url.origin!==config.projectUrl||!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(url.origin)||!config.publishableKey.startsWith('sb_publishable_'))throw Error('LIVE_CONFIG');
 const head=(r:any):LiveHead=>{if(!r||!uuid.test(r.dataset_id)||!/^[1-9][0-9]{0,18}$/.test(r.revision)||BigInt(r.revision)>9223372036854775807n||!/^[0-9a-f]{64}$/.test(r.sha256)||!Number.isFinite(Date.parse(r.updated_at)))throw Error('LIVE_VERIFY');return{datasetId:r.dataset_id,revision:r.revision,sha256:r.sha256,updatedAt:r.updated_at};};
 async function call(name:string,body:unknown,signal:AbortSignal){const credential=await token(auth);if(signal.aborted)throw Error('LIVE_SESSION_CHANGED');const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
   try{const res=await fetchFn(`${url.origin}/rest/v1/rpc/hisab_live_${name}`,{method:'POST',headers:{apikey:config.publishableKey,Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});
     if(!res.ok)throw Error('LIVE_SERVER_UNAVAILABLE');if(!res.headers.get('content-type')?.includes('application/json'))throw Error('LIVE_VERIFY');
     const reader=res.body?.getReader();if(!reader)throw Error('LIVE_VERIFY');let size=0;const chunks:Uint8Array[]=[];
     try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>90*1024*1024)throw Error('LIVE_TOO_LARGE');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
     const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
 }
 return{head:async signal=>{const r=await call('head',{},signal);return r===null?null:head(r);},
  get:async signal=>{const r=await call('get',{},signal);if(typeof r?.core_text!=='string')throw Error('LIVE_VERIFY');return{head:head(r.head),core:JSON.parse(r.core_text)};},
  put:async(datasetId,expectedRevision,core:LiveCore,signal)=>{const r=await call('put',{p_dataset:datasetId,p_expected:expectedRevision,p_core_text:canonicalJson(core),p_sha256:coreHash(core)},signal);if(!['accepted','stale'].includes(r?.kind))throw Error('LIVE_VERIFY');return{kind:r.kind,head:head(r.head)};},
  watch:(changed,connection)=>{let stopped=false;connection?.('connecting');const client=createClient(url.origin,config.publishableKey,{accessToken:()=>stopped?Promise.resolve(null):token(auth),auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{worker:false}});
    const channel=client.channel(`hisab-live:${auth.customerId}:${auth.generation}`).on('postgres_changes',{event:'*',schema:'hisab_recovery',table:'live_heads',filter:`owner_id=eq.${auth.customerId}`},()=>{if(!stopped)changed();}).subscribe(status=>{if(stopped)return;if(status==='SUBSCRIBED'){connection?.('connected');changed();}else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))connection?.('fallback');});
    return()=>{stopped=true;void client.removeChannel(channel).then(()=>client.realtime.disconnect()).catch(()=>{});};}
 };
}
