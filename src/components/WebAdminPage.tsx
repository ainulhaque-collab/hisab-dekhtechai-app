import { useEffect,useMemo,useRef,useState,useSyncExternalStore } from 'react';
import { accountSettingsSession } from '../auth/cloud/accountSettingsRuntime';
import { customerRequestIdentity } from '../access/identity';
import { customerAccessEnabled } from '../access/useServiceIdentity';
import { accessEndpoint,accessRequest,accessErrorMessage } from '../access/client';
import AccountSettingsPanel from './AccountSettingsPanel';
import { primaryButton,secondaryButton } from './ModalShell';
import { registerAccountSignOutCleanup } from '../auth/cloud/accountSignOut';
import type { AccountSettingsSession } from '../auth/cloud/accountSettingsSession';
import { GoogleAuthManager } from '../auth/googleAuth';
import { rememberAdminReturn } from '../access/adminReturn';

interface ProviderStatus {configured:boolean;enabled:boolean;revision:number;model:string;updatedAt:string|null}
const card='space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';
const field='mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-900';
/** Web route only; every operation still requires server-verified owner UUID.
 * It never mounts AppProvider or initializes/reads the customer's ledger. */
export default function WebAdminPage({session=accountSettingsSession,enabled=customerAccessEnabled,serviceEndpoint}: {session?:AccountSettingsSession;enabled?:boolean;serviceEndpoint?:string}={}){
  const state=useSyncExternalStore(session.subscribe,session.getSnapshot);
  const generation=session.serviceGeneration(),id=state.account?.customerId??null;
  const identity=useMemo(()=>customerRequestIdentity(session,id),[session,id,generation,state.phase]);
  const [adminCustomerId,setAdminCustomerId]=useState<string|null>(null),[provider,setProvider]=useState<ProviderStatus|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const admin=!!id&&adminCustomerId===id&&state.phase==='connected';
  const [apiKey,setApiKey]=useState(''),[model,setModel]=useState('auto'),[days,setDays]=useState('30'),[code,setCode]=useState(''),[target,setTarget]=useState(''),[targetResult,setTargetResult]=useState('');
  const [confirmation,setConfirmation]=useState<'block'|'disable'|null>(null);
  const pending=useRef(false),current=useRef(identity);current.current=identity;
  const endpoint=serviceEndpoint??accessEndpoint(import.meta.env.VITE_AI_API_BASE_URL||'',location.origin);
  useEffect(()=>{
    // Standalone Admin does not mount MainApp's cleanup registration or database.
    const legacy=new GoogleAuthManager();
    const detach=registerAccountSignOutCleanup(async()=>{const profile=legacy.getProfile();if(profile&&profile.subjectId!=='local_user')legacy.signOut();});
    void session.start();
    const refresh=()=>{if(!document.hidden)void session.refresh();};window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{detach();window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[session]);
  useEffect(()=>{
    const controller=new AbortController();setAdminCustomerId(null);setProvider(null);setApiKey('');setCode('');setTarget('');setTargetResult('');setConfirmation(null);setError('');setNotice('');
    if(enabled&&identity.getProfile())void(async()=>{
      try{const status=await accessRequest(identity,endpoint,{action:'status'},controller.signal);if(status.isAdmin!==true)throw Error('ACCESS_ADMIN_REQUIRED');
        const value=await accessRequest(identity,endpoint,{action:'providerStatus'},controller.signal);if(!controller.signal.aborted){setAdminCustomerId(id);setProvider(value);setModel(value.model);}
      }catch(reason){if(!controller.signal.aborted)setError(accessErrorMessage(reason));}
    })();return()=>controller.abort();
  },[identity,endpoint,enabled]);
  const run=async(work:()=>Promise<void>)=>{if(pending.current)return;const requestIdentity=identity;pending.current=true;setBusy(true);setError('');setNotice('');try{await work();}catch(reason){if(current.current===requestIdentity)setError(accessErrorMessage(reason));}finally{pending.current=false;setBusy(false);}};
  const stillCurrent=()=>current.current===identity&&!!identity.getProfile();
  return <main className="min-h-dvh bg-slate-50 px-4 py-8 text-slate-900"><div className="mx-auto max-w-5xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-violet-700">Hisab DekhteChai</p><h1 className="mt-1 text-2xl font-bold">অ্যাডমিন নিয়ন্ত্রণ</h1><p className="mt-2 text-sm text-slate-500">AI-এর অনুমতি, রিডিম কোড ও সেবা</p></div><a href="/" className={secondaryButton}>অ্যাপে ফিরুন</a></header>
    {!enabled?<section className={card}><h2 className="font-bold">পরীক্ষার সেটআপ বাকি</h2><p>এই deployment-এ অ্যাডমিন ও সাবস্ক্রিপশন সেবা এখনও চালু করা হয়নি।</p></section>:<>
      <section className={card}><h2 className="font-bold">মালিকের পরিচয় যাচাই</h2>{admin?<div className="flex flex-wrap items-center justify-between gap-3"><p className="break-all text-sm">{state.account?.email} · অ্যাডমিন অনুমতি যাচাইকৃত</p><button type="button" className={secondaryButton} onClick={()=>{void session.signOut();}}>সাইন আউট</button></div>:<AccountSettingsPanel en={false} session={session} onSignIn={()=>rememberAdminReturn()}/>}</section>
      {admin&&<div className="grid items-start gap-6 md:grid-cols-2">
        <section className={card}><h2 className="text-lg font-bold">AI-এর API key</h2>
          <p className="text-sm text-slate-600">Google Gemini · {provider?.configured?(provider.enabled?'চালু আছে':'বন্ধ আছে'):'key যোগ করা হয়নি'}</p>
          <form className="space-y-4" onSubmit={event=>{event.preventDefault();const secret=apiKey;setApiKey('');void run(async()=>{
            await accessRequest(identity,endpoint,{action:'configureProvider',requestId:crypto.randomUUID(),apiKey:secret,model,expectedRevision:provider?.revision??0});
            const value=await accessRequest(identity,endpoint,{action:'providerStatus'});if(stillCurrent()){setProvider(value);setNotice('নতুন key সেভ হয়েছে। কোনো AI generation চালানো হয়নি।');}
          });}}>
            <label className="block text-sm font-medium">নতুন Gemini API key<input type="password" value={apiKey} onChange={event=>setApiKey(event.target.value)} className={field} autoComplete="new-password" spellCheck={false} maxLength={4096} required disabled={busy}/></label>
            <label className="block text-sm font-medium">মডেল<input className={field} value={model} onChange={event=>setModel(event.target.value)} maxLength={120} required disabled={busy}/><span className="mt-2 block text-xs text-slate-500">auto রাখলে পরীক্ষিত উপলব্ধ মডেল বেছে নেবে।</span></label>
            <button type="submit" className={`${primaryButton} w-full`} disabled={busy||!apiKey}>key সেভ / পরিবর্তন করুন</button>
          </form>
          <button type="button" className={`${secondaryButton} w-full`} disabled={busy||!provider?.enabled} onClick={()=>setConfirmation('disable')}>AI সেবা বন্ধ করুন</button>
          {confirmation==='disable'&&<div role="group" aria-label="AI বন্ধ করার অনুমোদন" className="space-y-3 rounded-xl bg-amber-50 p-3"><p className="text-sm">সব গ্রাহকের পরবর্তী AI অনুরোধ বন্ধ হবে। আগের হিসাব থাকবে।</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={primaryButton} onClick={()=>{setConfirmation(null);void run(async()=>{await accessRequest(identity,endpoint,{action:'disableProvider',requestId:crypto.randomUUID()});const value=await accessRequest(identity,endpoint,{action:'providerStatus'});if(stillCurrent()){setProvider(value);setNotice('AI সেবা বন্ধ হয়েছে।');}});}}>নিশ্চিত করে AI বন্ধ করুন</button><button type="button" className={secondaryButton} onClick={()=>setConfirmation(null)}>বাতিল</button></div></div>}
          <p className="text-xs leading-relaxed text-slate-500">সেভ করা key আবার দেখানো হবে না। পরের অনুরোধ থেকে পরিবর্তন কার্যকর হবে। ভবিষ্যৎ OpenAI adapter একই এন্ট্রি ও যাচাই ব্যবস্থা ব্যবহার করবে।</p>
        </section>
        <div className="space-y-6"><section className={card}><h2 className="text-lg font-bold">রিডিম কোড তৈরি</h2>
          <p className="text-sm text-slate-600">১ টাকা পেমেন্ট নিজে যাচাই করে কোড দিন। এই Preview-তে কোড AI ব্যবহারের মেয়াদ চালু করে; এখানে টাকা আদায় করা হয় না।</p>
          <label className="block text-sm font-medium">ব্যবহারের মেয়াদ (দিন)<input type="number" min="1" max="3660" step="1" value={days} onChange={event=>setDays(event.target.value)} className={field} disabled={busy}/></label>
          <button type="button" className={`${primaryButton} w-full`} disabled={busy||!Number.isSafeInteger(Number(days))||Number(days)<1||Number(days)>3660} onClick={()=>{setCode('');void run(async()=>{const value=await accessRequest(identity,endpoint,{action:'issue',requestId:crypto.randomUUID(),days:Number(days)});if(stillCurrent())setCode(value.code);});}}>পেমেন্ট যাচাই করেছি, কোড তৈরি করুন</button>
          {code&&<div role="status" className="space-y-2 rounded-xl bg-violet-50 p-4"><p className="text-xs">এবারই কপি করে গ্রাহককে দিন। ৩০ দিনের মধ্যে ব্যবহার করতে হবে।</p><p className="break-all font-mono font-bold select-all">{code}</p><button className={secondaryButton} type="button" onClick={()=>setCode('')}>কোড লুকান</button></div>}
          <p className="text-xs text-slate-500">একবার ব্যবহারযোগ্য। প্রথম ব্যবহার থেকে মেয়াদ শুরু; নবায়নে বাকি মেয়াদের সঙ্গে যোগ হবে।</p>
        </section>
        <section className={card}><h2 className="text-lg font-bold">গ্রাহকের AI অনুমতি</h2><label className="block text-sm font-medium">গ্রাহক আইডি<input value={target} onChange={event=>{setTarget(event.target.value.trim());setConfirmation(null);}} className={field} maxLength={36} disabled={busy}/></label>
          <p className="text-xs text-slate-500">গ্রাহকের অ্যাপ → অ্যাকাউন্ট → সাবস্ক্রিপশন অংশ থেকে আইডি নিন। একই ব্যক্তির যুক্ত Gmail-গুলো একই অনুমতি পাবে।</p>
          <div className="flex flex-wrap gap-2">{(['grant','block','unblock'] as const).map(action=><button key={action} type="button" disabled={busy||!target} className={action==='grant'?primaryButton:secondaryButton} onClick={()=>{if(action==='block'){setConfirmation('block');return;}void run(async()=>{const value=await accessRequest(identity,endpoint,{action,requestId:crypto.randomUUID(),customerId:target,...action==='grant'?{days:Number(days)}:{}});if(stillCurrent())setTargetResult(value.blocked?'গ্রাহকের AI ব্যবহার বন্ধ।':value.active?'গ্রাহকের AI অনুমতি চালু।':'সক্রিয় মেয়াদ নেই।');});}}>{action==='grant'?'মেয়াদ দিন':action==='block'?'ব্লক করুন':'ব্লক খুলুন'}</button>)}</div>
          {confirmation==='block'&&<div role="group" aria-label="গ্রাহক ব্লক করার অনুমোদন" className="space-y-3 rounded-xl bg-amber-50 p-3"><p className="break-all text-sm">এই গ্রাহকের AI ব্যবহার বন্ধ হবে: {target}। হিসাব মুছবে না।</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={primaryButton} onClick={()=>{setConfirmation(null);void run(async()=>{await accessRequest(identity,endpoint,{action:'block',requestId:crypto.randomUUID(),customerId:target});if(stillCurrent())setTargetResult('গ্রাহকের AI ব্যবহার বন্ধ।');});}}>নিশ্চিত করে ব্লক করুন</button><button type="button" className={secondaryButton} onClick={()=>setConfirmation(null)}>বাতিল</button></div></div>}
          {targetResult&&<p role="status" className="text-sm">{targetResult}</p>}
        </section></div>
      </div>}
    </>}
    {busy&&<p role="status" className="text-sm">অনুরোধ চলছে…</p>}{error&&<p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800">{error}</p>}{notice&&<p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{notice}</p>}
    <footer className="text-xs text-slate-500">Hisab DekhteChai · ব্যক্তিগত মালিক নিয়ন্ত্রণ · পরীক্ষার Preview</footer>
  </div></main>;
}
