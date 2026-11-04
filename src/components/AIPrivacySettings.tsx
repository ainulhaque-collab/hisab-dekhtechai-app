import React, { useEffect, useState } from 'react';
import { aiConsentStore, aiGuideConsentStore, notifyAIConsentChanged } from '../ai/consent';
import { secondaryButton } from './ModalShell';

export function AIPrivacySettings({ owner, en }: { owner: string; en: boolean }) {
  const [allowed, setAllowed] = useState(false);
  const [guideAllowed,setGuideAllowed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true; setBusy(true);
    void Promise.all([aiConsentStore().then(store=>store.allowed(owner)),aiGuideConsentStore().then(store=>store.allowed(owner))]).then(([value,guide])=>{if(active){setAllowed(value);setGuideAllowed(guide);}})
      .catch(() => { if (active) setError(true); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [owner]);
  const revoke = async (kind:'media'|'guide'='media') => {
    setBusy(true); setError(false);
    try { await (await(kind==='media'?aiConsentStore():aiGuideConsentStore())).revoke(owner); notifyAIConsentChanged(); kind==='media'?setAllowed(false):setGuideAllowed(false); }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <div className="space-y-2 border-t border-slate-200 pt-3">
    <h3 className="font-semibold text-slate-800">{en ? 'AI media permission' : 'AI-তে ছবি ও ভয়েস পাঠানোর অনুমতি'}</h3>
    <p>{en ? 'Selected photos and voice are sent to Google Gemini only when you use AI entry. This permission stays on this device and is excluded from backups.' : 'AI এন্ট্রি ব্যবহার করলে বেছে নেওয়া ছবি ও ভয়েস Google Gemini-তে যায়। অনুমতি এই ডিভাইসেই থাকে, ব্যাকআপে যায় না।'}</p>
    <button type="button" className={secondaryButton} disabled={busy || !allowed} onClick={() => void revoke()}>{allowed ? (en ? 'Turn off AI permission' : 'AI অনুমতি বন্ধ করুন') : (en ? 'AI permission is off' : 'AI অনুমতি বন্ধ আছে')}</button>
    <h3 className="pt-3 font-semibold text-slate-800">{en?'AI financial summary permission':'AI-তে হিসাবের সারাংশ পাঠানোর অনুমতি'}</h3>
    <p>{en?'Separate from media permission. When requested, selected dates, total income/expense and category totals go to Google Gemini; notes, receipts, wallet numbers and individual entries stay out.':'ছবি ও ভয়েসের অনুমতি থেকে আলাদা। আপনি চাইলে নির্বাচিত সময়, মোট আয়-ব্যয় ও খাতভিত্তিক মোট Google Gemini-তে যায়; নোট, রিসিপ্ট, ওয়ালেট নম্বর ও আলাদা লেনদেন যায় না।'}</p>
    <button type="button" className={secondaryButton} disabled={busy || !guideAllowed} onClick={()=>void revoke('guide')}>{guideAllowed?(en?'Turn off summary sharing':'সারাংশ পাঠানোর অনুমতি বন্ধ করুন'):(en?'Summary permission is off':'সারাংশ পাঠানোর অনুমতি বন্ধ আছে')}</button>
    {error && <p role="alert" className="text-rose-700">{en ? 'Permission could not be updated. Try again.' : 'অনুমতি পরিবর্তন করা যায়নি। আবার চেষ্টা করুন।'}</p>}
    <p>{en ? 'Camera and microphone access can also be changed in your phone or browser settings.' : 'ফোন বা ব্রাউজারের সেটিংস থেকেও ক্যামেরা ও মাইক্রোফোনের অনুমতি বদলাতে পারবেন।'}</p>
  </div>;
}
