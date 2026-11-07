import type {RecoveryAuth,RecoveryBinding,RecoveryCopy,RecoveryTransport} from './service';
import {computeSha256} from '../canonical';
const uuid=/^[0-9a-f-]{36}$/i;
export function recoveryTransport(config:{projectUrl:string;publishableKey:string},auth:RecoveryAuth,token:(auth:RecoveryAuth)=>Promise<string>,fetchFn:typeof fetch=fetch):RecoveryTransport{
  const origin=new URL(config.projectUrl);if(!/^https:\/\/[a-z]{20}\.supabase\.co\/?$/.test(origin.href)||!config.publishableKey.startsWith('sb_publishable_'))throw Error('RECOVERY_CONFIG');
  const call=async(name:string,body:unknown,signal:AbortSignal)=>{
    const credential=await token(auth);if(signal.aborted)throw Error('RECOVERY_SESSION_CHANGED');
    const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
    try{const response=await fetchFn(`${origin.origin}/rest/v1/rpc/hisab_recovery_${name}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:config.publishableKey,Authorization:`Bearer ${credential}`},body:JSON.stringify(body),signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error'});
      if(!response.ok)throw Error(response.status===413?'RECOVERY_TOO_LARGE':'RECOVERY_UNAVAILABLE');
      if(!response.headers.get('content-type')?.includes('application/json'))throw Error('RECOVERY_VERIFY');
      const reader=response.body?.getReader();if(!reader)throw Error('RECOVERY_VERIFY');let bytes=0;const chunks:Uint8Array[]=[];
      try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>90*1024*1024)throw Error('RECOVERY_TOO_LARGE');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
      const joined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));
    }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
  };
  const copy=(r:any):RecoveryCopy=>{if(!r||![r.id,r.dataset_id,r.device_id].every(v=>typeof v==='string'&&uuid.test(v))||!/^[0-9a-f]{64}$/.test(r.sha256)||!Number.isFinite(Date.parse(r.created_at)))throw Error('RECOVERY_VERIFY');return{id:r.id,datasetId:r.dataset_id,deviceId:r.device_id,sha256:r.sha256,createdAt:r.created_at};};
  return{list:async signal=>{const rows=await call('list',{},signal);if(!Array.isArray(rows)||rows.length>30)throw Error('RECOVERY_VERIFY');return rows.map(copy);},
    put:async(b:RecoveryBinding,text:string,signal)=>copy(await call('put',{p_dataset:b.datasetId,p_device:b.deviceId,p_text:text,p_sha256:await computeSha256(text)},signal)),
    get:async(id,signal)=>{const row=await call('get',{p_id:id},signal);if(typeof row?.backup_text!=='string')throw Error('RECOVERY_VERIFY');return{copy:copy(row),text:row.backup_text};}};
}
