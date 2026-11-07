import {useEffect,useSyncExternalStore} from 'react';
import {accountSettingsSession as session} from '../../auth/cloud/accountSettingsRuntime';
import type {LocalDatabase} from '../../storage/db';
import {RecoveryService} from './service';
import {recoveryTransport} from './transport';
export const recoveryEnabled=import.meta.env?.VITE_CLOUD_RECOVERY_ENABLED==='true';
const services=new WeakMap<LocalDatabase,RecoveryService>();
export function recoveryFor(db:LocalDatabase){let service=services.get(db);if(!service){service=new RecoveryService(db,()=>{
  const s=session.getSnapshot();return s.phase==='connected'&&s.account?{customerId:s.account.customerId,generation:session.serviceGeneration()}:null;
},auth=>recoveryTransport({projectUrl:import.meta.env.VITE_SUPABASE_URL,publishableKey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},auth,a=>session.serviceToken(a.customerId,a.generation)));services.set(db,service);}return service;}
export function useRecovery(db:LocalDatabase){const service=recoveryFor(db);const state=useSyncExternalStore(service.subscribe,service.snapshot);return{service,state};}
export function useAutomaticRecovery(db:LocalDatabase){
  useEffect(()=>{if(!recoveryEnabled)return;const service=recoveryFor(db);let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
    let identity='';const run=()=>{if(!stopped&&navigator.onLine&&!document.hidden)void service.run();};
    const changed=()=>{service.markPending();clearTimeout(timer);timer=setTimeout(run,2000);};
    const userChanged=()=>{const s=session.getSnapshot(),next=s.phase==='connected'&&s.account?`${s.account.customerId}:${session.serviceGeneration()}`:'';
      if(next!==identity){identity=next;service.cancel();if(next)void service.refresh().then(run);}};
    const resume=()=>{if(!document.hidden)void session.refresh().then(run);};
    const unDb=db.subscribeToLocalChanges(changed),unAuth=session.subscribe(userChanged);const interval=setInterval(run,30000);
    window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
    void db.init().then(()=>session.start()).then(()=>{if(!stopped){userChanged();run();}});
    return()=>{stopped=true;clearTimeout(timer);clearInterval(interval);unDb();unAuth();service.cancel();window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
  },[db]);
}
