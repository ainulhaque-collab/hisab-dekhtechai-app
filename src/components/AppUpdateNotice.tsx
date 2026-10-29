import { useEffect, useState } from 'react';
import { registerOfflineShell } from '../pwa/register';

export function AppUpdateNotice() {
  const [update,setUpdate] = useState<ServiceWorkerRegistration|null>(null);
  const [installing,setInstalling] = useState(false);
  useEffect(()=>registerOfflineShell(setUpdate),[]);
  if(!update) return null;
  return <div role="status" className="fixed inset-x-3 top-3 z-[300] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-slate-900 p-4 text-xs text-white shadow-xl">
    <span>নতুন সংস্করণ প্রস্তুত · Update ready<br/><span className="text-[11px] text-slate-300">এন্ট্রি সেভ করে আপডেট করুন · Save your entry first</span></span>
    <button type="button" disabled={installing} className="min-h-11 rounded-xl bg-white px-4 font-semibold text-slate-900" onClick={()=>{
      if(!update.waiting) { setUpdate(null); return; }
      setInstalling(true);
      navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});
      update.waiting.postMessage({type:'ACTIVATE_UPDATE'});
    }}>{installing?'…':'আপডেট'}</button>
  </div>;
}
