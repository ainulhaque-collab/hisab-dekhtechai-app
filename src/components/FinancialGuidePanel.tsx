import { useEffect,useRef,useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useApp } from '../context/AppContext';
import { aiEndpoint,aiErrorMessage } from '../ai/client';
import { aiGuideConsentStore,AI_CONSENT_CHANGED } from '../ai/consent';
import { requestFinancialGuide } from '../ai/guideClient';
import { guideInputHash,type GuideInput,type FinancialGuide } from '../ai/financialGuide';
import { primaryButton,secondaryButton } from './ModalShell';
import { useServiceIdentity } from '../access/useServiceIdentity';

export function FinancialGuidePanel({input}:{input:GuideInput}) {
  const {auth:legacyAuth,db,isOnline,language}=useApp(),en=language==='en';
  const {identity:auth,owner:serviceOwner,enabled:customerService}=useServiceIdentity(legacyAuth);
  const owner=customerService?serviceOwner:db.getIdentity()?.ownerSubjectHash||'';
  const [allowed,setAllowed]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [guide,setGuide]=useState<FinancialGuide|null>(null),[error,setError]=useState('');
  const abort=useRef<AbortController|null>(null),lock=useRef(false),active=useRef(true);
  const hash=guideInputHash(input);
  const dataset=db.getIdentity()?.ownerSubjectHash;
  const current=useRef({owner,hash,dataset});current.current={owner,hash,dataset};
  useEffect(()=>{
    let live=true;
    active.current=true;setGuide(null);setError('');setLoading(true);setAllowed(false);
    const check=()=>{void (async()=>{try{const permitted=owner?await(await aiGuideConsentStore()).allowed(owner):false;if(live){setAllowed(permitted);if(!permitted){abort.current?.abort();setGuide(null);}}}catch{if(live)setError(en?'AI permission could not be checked.':'AI অনুমতি যাচাই হয়নি।');}finally{if(live)setLoading(false);}})();};
    check();window.addEventListener(AI_CONSENT_CHANGED,check);
    return()=>{live=false;active.current=false;abort.current?.abort();window.removeEventListener(AI_CONSENT_CHANGED,check);};
  },[owner,hash,dataset,en]);
  let endpoint='';try{endpoint=aiEndpoint(import.meta.env.VITE_AI_API_BASE_URL||'',location.origin,Capacitor.isNativePlatform()).replace(/\/extract$/,'/guide');}catch{}
  return <section className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-4"><h2 className="text-sm font-semibold">{en?'AI budgeting guide':'AI বাজেট গাইড'}</h2>
    <p className="text-xs leading-relaxed text-slate-600">{en?'When you ask, only this period’s dates, total income/expense and category totals go to Google Gemini through our service. Notes, receipts, wallet numbers and individual transactions are excluded. Permission is remembered on this device and can be removed in Privacy.':'আপনি চাইলে এই সময়ের তারিখ, মোট আয়-ব্যয় ও খাতভিত্তিক মোট খরচ আমাদের সার্ভিস দিয়ে Google Gemini-তে যাবে। নোট, রিসিপ্ট, ওয়ালেট নম্বর বা আলাদা লেনদেন যাবে না। অনুমতি এই ডিভাইসে মনে থাকবে; Privacy থেকে বন্ধ করতে পারবেন।'}</p>
    <button type="button" className={`${primaryButton} w-full`} disabled={busy||loading||!owner||!isOnline||!endpoint} onClick={async()=>{
      if(lock.current)return;lock.current=true;setBusy(true);setError('');setGuide(null);
      const requestedOwner=owner,requestedHash=hash,requestedDataset=dataset,controller=new AbortController();abort.current=controller;
      const visible=()=>active.current&&current.current.owner===requestedOwner&&current.current.hash===requestedHash&&current.current.dataset===requestedDataset&&!controller.signal.aborted;
      const same=()=>visible()&&auth.getProfile()?.subjectHash===requestedOwner;
      try {
        if(!same()) throw new Error('AI_AUTH_REQUIRED');
        const consent=await aiGuideConsentStore();if(!await consent.allowed(owner)){await consent.allow(owner);if(same())setAllowed(true);}
        if(!same()||!await consent.allowed(owner)) throw new Error('AI_OWNER_MISMATCH');
        const result=await requestFinancialGuide(input,owner,auth,{endpoint,signal:controller.signal});
        if(same()&&await consent.allowed(owner))setGuide(result);
    }catch(error){if(visible())setError(aiErrorMessage(error,en));}finally{lock.current=false;if(active.current)setBusy(false);}
    }}>{busy?(en?'Preparing guide…':'গাইড তৈরি হচ্ছে…'):allowed?(en?'Get AI guide':'AI গাইড নিন'):(en?'Allow summary sharing & get guide':'সারাংশ পাঠানোর অনুমতি দিয়ে গাইড নিন')}</button>
    {busy&&<button type="button" className={`${secondaryButton} w-full`} onClick={()=>abort.current?.abort()}>{en?'Cancel':'বাতিল'}</button>}
    {!owner&&<p className="text-xs text-slate-500">{en?'Connect your Google account to use the AI guide.':'AI গাইডের জন্য Google অ্যাকাউন্ট সংযুক্ত করুন।'}</p>}
    {error&&<p role="alert" className="text-xs text-rose-700">{error}</p>}
    {guide&&<div className="space-y-3 text-xs leading-relaxed text-slate-700"><h3 className="font-semibold">{en?'Observations':'পর্যবেক্ষণ'}</h3><ul className="list-disc space-y-2 pl-5">{guide.observations.map((item,index)=><li key={index}>{item}</li>)}</ul><h3 className="font-semibold">{en?'Steps to consider':'বিবেচনা করতে পারেন'}</h3><ul className="list-disc space-y-2 pl-5">{guide.suggestions.map((item,index)=><li key={index}>{item}</li>)}</ul><p className="rounded-xl bg-white p-3">{guide.limitation}</p></div>}
    <p className="text-xs leading-relaxed text-slate-500">{en?'Educational suggestions may be wrong. Review the numbers; nothing is saved or moved automatically.':'শিক্ষামূলক পরামর্শে ভুল থাকতে পারে। হিসাব যাচাই করুন; নিজে থেকে কোনো এন্ট্রি বা টাকা স্থানান্তর হবে না।'}</p>
  </section>;
}
