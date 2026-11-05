import { useEffect,useRef,useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useApp } from '../context/AppContext';
import { useServiceIdentity } from '../access/useServiceIdentity';
import { accessEndpoint,accessRequest,accessErrorMessage } from '../access/client';
import { primaryButton,secondaryButton } from './ModalShell';
import type { AIIdentity } from '../ai/client';
import { readServiceAccess } from '../access/serviceAccess';
import { AI_ACCESS_CHANGED } from '../access/nativePreview';

interface Status {customerId:string;active:boolean;blocked:boolean;expiresAt:string|null}
export function CustomerAccessPanel({en=false}:{en?:boolean}){
  const {auth}=useApp(),{identity,enabled}=useServiceIdentity(auth);
  let endpoint='';try{endpoint=accessEndpoint(import.meta.env.VITE_AI_API_BASE_URL||'',location.origin,Capacitor.isNativePlatform());}catch{}
  return <CustomerAccessForm key={identity.getProfile()?.subjectHash??'signed-out'} en={en} identity={identity} enabled={enabled} endpoint={endpoint}/>;
}
export function CustomerAccessForm({en=false,identity,enabled,endpoint}:{en?:boolean;identity:AIIdentity;enabled:boolean;endpoint:string}){
  const [status,setStatus]=useState<Status|null>(null),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const pending=useRef(false),current=useRef(identity),request=useRef<AbortController|null>(null);current.current=identity;
  useEffect(()=>{const abort=new AbortController();setStatus(null);setError('');setCode('');
    if(enabled&&identity.getProfile()&&endpoint)void readServiceAccess(identity,endpoint,abort.signal).then(value=>{if(!abort.signal.aborted)setStatus(value);}).catch(reason=>{if(!abort.signal.aborted)setError(accessErrorMessage(reason,en));});
    return()=>{abort.abort();request.current?.abort();};
  },[enabled,identity,endpoint,en,revision]);
  if(!enabled)return null;
  return <section className="space-y-3 rounded-2xl border border-slate-200 p-4"><h3 className="font-bold">{en?'Subscription & AI':'সাবস্ক্রিপশন ও AI'}</h3>
    {!identity.getProfile()?<p className="text-sm">{en?'Sign in above with the Gmail approved by your Admin.':'অ্যাডমিনের অনুমতি পাওয়া Gmail দিয়ে উপরে লগইন করুন।'}</p>:<>
      <p role="status" className="text-sm">{status?(status.blocked?(en?'AI access blocked':'AI ব্যবহার বন্ধ'):status.active?(en?'AI access active':'AI ব্যবহার চালু'):(en?'Ask the Admin to approve your Gmail, or redeem a code.':'অ্যাডমিনকে Gmail-এ অনুমতি দিতে বলুন, অথবা রিডিম কোড দিন।')):error?(en?'Permission could not be checked.':'অনুমতি যাচাই হয়নি।'):(en?'Checking access…':'অনুমতি যাচাই হচ্ছে…')}</p>
      <button type="button" className={`${secondaryButton} w-full`} disabled={busy} onClick={()=>setRevision(value=>value+1)}>{en?'Check permission again':'অনুমতি আবার যাচাই করুন'}</button>
      {status?.expiresAt&&<p className="text-sm text-slate-500">{en?'Valid until: ':'মেয়াদ: '}{new Date(status.expiresAt).toLocaleString(en?'en-BD':'bn-BD')}</p>}
      {status&&<details className="text-xs text-slate-500"><summary>{en?'Customer ID for support':'সহায়তার জন্য গ্রাহক আইডি'}</summary><p className="mt-2 break-all select-all">{status.customerId}</p></details>}
      <form className="space-y-2" onSubmit={async event=>{event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');const controller=new AbortController();request.current=controller;try{await accessRequest(identity,endpoint,{action:'redeem',code,requestId:crypto.randomUUID()},controller.signal);const value=await readServiceAccess(identity,endpoint,controller.signal);if(current.current===identity){setStatus(value);setCode('');window.dispatchEvent(new Event(AI_ACCESS_CHANGED));}}catch(reason){if(current.current===identity&&identity.getProfile()&&!controller.signal.aborted)setError(accessErrorMessage(reason,en));}finally{pending.current=false;setBusy(false);}}}>
        <label className="block text-sm">{en?'Redeem code':'রিডিম কোড'}<input className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 font-mono" value={code} onChange={event=>setCode(event.target.value)} autoComplete="off" maxLength={40} disabled={busy||status?.blocked} /></label>
        <button type="submit" className={`${primaryButton} w-full`} disabled={busy||!code.trim()||status?.blocked}>{busy?(en?'Checking…':'যাচাই হচ্ছে…'):(en?'Activate code':'কোড চালু করুন')}</button>
      </form>
    </>}
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    <p className="text-xs text-slate-500">{en?'AI requires an internet connection. Your existing entries are kept on this device.':'AI ব্যবহার করতে ইন্টারনেট লাগবে। আগের হিসাব এই ডিভাইসেই থাকবে।'}</p>
  </section>;
}
