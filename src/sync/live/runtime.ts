import {useEffect,useRef,useSyncExternalStore} from 'react';
import {accountSettingsSession as session} from '../../auth/cloud/accountSettingsRuntime';
import type {LocalDatabase} from '../../storage/db';
import {LiveSyncService} from './service';
import {liveTransport} from './transport';
import type {RecoveryAuth} from '../recovery/service';
export const liveSyncEnabled=import.meta.env?.VITE_LIVE_SYNC_ENABLED==='true';
const services=new WeakMap<LocalDatabase,LiveSyncService>();
const transports=new Map<string,ReturnType<typeof liveTransport>>();
const readAuth=():RecoveryAuth|null=>{const state=session.getSnapshot();return state.phase==='connected'&&state.account?{customerId:state.account.customerId,generation:session.serviceGeneration()}:null;};
function transport(auth:RecoveryAuth){const key=`${auth.customerId}:${auth.generation}`;let result=transports.get(key);if(!result){result=liveTransport({projectUrl:import.meta.env.VITE_SUPABASE_URL,publishableKey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},auth,a=>session.serviceToken(a.customerId,a.generation));transports.clear();transports.set(key,result);}return result;}
export function liveFor(db:LocalDatabase){let service=services.get(db);if(!service){service=new LiveSyncService(db,readAuth,transport,()=>navigator.onLine,()=>window.dispatchEvent(new Event('hisab-live-updated')));services.set(db,service);}return service;}
export function useLive(db:LocalDatabase){const service=liveFor(db);return{service,state:useSyncExternalStore(service.subscribe,service.snapshot)};}
export function useAutomaticLive(db:LocalDatabase,refresh:()=>void){const refreshRef=useRef(refresh);refreshRef.current=refresh;
 useEffect(()=>{if(!liveSyncEnabled)return;const service=liveFor(db);let stopped=false,running=false,again=false,identity='',unwatch=()=>{};let timer:ReturnType<typeof setTimeout>|undefined;
   const enabled=()=>!stopped&&!document.hidden&&navigator.onLine;
   const flush=async()=>{if(!enabled())return;if(running){again=true;return;}running=true;
     try{let passes=0;do{again=false;await service.run();}while(again&&enabled()&&++passes<4);}finally{running=false;if(again&&enabled()){clearTimeout(timer);timer=setTimeout(()=>void flush(),250);}}};
   const request=()=>{service.markPending();clearTimeout(timer);timer=setTimeout(()=>void flush(),250);};
   const connection=()=>{const auth=readAuth(),next=enabled()&&auth?`${auth.customerId}:${auth.generation}`:'';
     if(next!==identity){identity=next;unwatch();unwatch=()=>{};service.cancel();if(auth&&next){unwatch=transport(auth).watch(request,state=>service.realtime(state));request();}}};
   const resume=()=>{if(document.hidden){connection();return;}void session.refresh().then(()=>{connection();request();});};
   const updated=()=>refreshRef.current();const unDb=db.subscribeToDurableChanges(request),unAuth=session.subscribe(connection);
   const fallback=setInterval(()=>{if(enabled()&&(service.snapshot().realtime!=='connected'||service.snapshot().phase!=='synced'))void flush();},30000);
   window.addEventListener('online',resume);window.addEventListener('offline',connection);document.addEventListener('visibilitychange',resume);window.addEventListener('hisab-live-updated',updated);
   void db.init().then(()=>session.start()).then(()=>{if(!stopped){connection();request();}}).catch(()=>{});
   return()=>{stopped=true;unwatch();service.cancel();clearTimeout(timer);clearInterval(fallback);unDb();unAuth();window.removeEventListener('online',resume);window.removeEventListener('offline',connection);document.removeEventListener('visibilitychange',resume);window.removeEventListener('hisab-live-updated',updated);};
 },[db]);
}
