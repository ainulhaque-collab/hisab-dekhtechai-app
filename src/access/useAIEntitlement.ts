import {useEffect,useRef,useState} from 'react';
import {Capacitor} from '@capacitor/core';
import type {AIIdentity} from '../ai/client';
import {useServiceIdentity} from './useServiceIdentity';
import {accessEndpoint,accessErrorMessage} from './client';
import {readServiceAccess,type ServiceAccessStatus} from './serviceAccess';
import {AI_ACCESS_CHANGED} from './nativePreview';
export function useAIEntitlement(legacy:AIIdentity,en=false){
  const service=useServiceIdentity(legacy),{identity,enabled,owner}=service;
  const [result,setResult]=useState<{identity:AIIdentity;status:ServiceAccessStatus|null;error:string;loading:boolean}|null>(null),[revision,setRevision]=useState(0);
  let endpoint='';try{endpoint=accessEndpoint(import.meta.env.VITE_AI_API_BASE_URL||'',location.origin,Capacitor.isNativePlatform());}catch{}
  const current=useRef(identity);current.current=identity;
  const refresh=()=>setRevision(value=>value+1);
  useEffect(()=>{
    if(!enabled||!owner||!endpoint)return;const controller=new AbortController();setResult(previous=>({identity,status:previous?.identity===identity?previous.status:null,error:'',loading:true}));
    void readServiceAccess(identity,endpoint,controller.signal).then(status=>{if(!controller.signal.aborted&&current.current===identity)setResult({identity,status,error:'',loading:false});}).catch(error=>{if(!controller.signal.aborted&&current.current===identity)setResult({identity,status:null,error:accessErrorMessage(error,en),loading:false});});
    return()=>controller.abort();
  },[identity,enabled,owner,endpoint,revision,en]);
  useEffect(()=>{if(!enabled)return;const visible=()=>{if(!document.hidden)refresh();};window.addEventListener(AI_ACCESS_CHANGED,refresh);window.addEventListener('online',visible);document.addEventListener('visibilitychange',visible);return()=>{window.removeEventListener(AI_ACCESS_CHANGED,refresh);window.removeEventListener('online',visible);document.removeEventListener('visibilitychange',visible);};},[enabled]);
  const bound=enabled&&result?.identity===identity&&!!identity.getProfile()?result:null;
  return {...service,active:!enabled||bound?.status?.active===true,status:bound?.status??null,error:enabled&&owner&&!endpoint?accessErrorMessage(Error('ACCESS_NOT_CONFIGURED'),en):bound?.error??'',loading:enabled&&!!owner&&!!endpoint&&(!bound||bound.loading),refresh};
}
