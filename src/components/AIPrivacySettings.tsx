import React, { useEffect, useState } from 'react';
import { aiConsentStore, notifyAIConsentChanged } from '../ai/consent';
import { secondaryButton } from './ModalShell';

export function AIPrivacySettings({ owner, en }: { owner: string; en: boolean }) {
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true; setBusy(true);
    void aiConsentStore().then(store => store.allowed(owner)).then(value => { if (active) setAllowed(value); })
      .catch(() => { if (active) setError(true); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [owner]);
  const revoke = async () => {
    setBusy(true); setError(false);
    try { await (await aiConsentStore()).revoke(owner); notifyAIConsentChanged(); setAllowed(false); }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <div className="space-y-2 border-t border-slate-200 pt-3">
    <h3 className="font-semibold text-slate-800">{en ? 'AI media permission' : 'AI-তে ছবি ও ভয়েস পাঠানোর অনুমতি'}</h3>
    <p>{en ? 'Selected photos and voice are sent to Google Gemini only when you use AI entry. This permission stays on this device and is excluded from backups.' : 'AI এন্ট্রি ব্যবহার করলে বেছে নেওয়া ছবি ও ভয়েস Google Gemini-তে যায়। অনুমতি এই ডিভাইসেই থাকে, ব্যাকআপে যায় না।'}</p>
    <button type="button" className={secondaryButton} disabled={busy || !allowed} onClick={() => void revoke()}>{allowed ? (en ? 'Turn off AI permission' : 'AI অনুমতি বন্ধ করুন') : (en ? 'AI permission is off' : 'AI অনুমতি বন্ধ আছে')}</button>
    {error && <p role="alert" className="text-rose-700">{en ? 'Permission could not be updated. Try again.' : 'অনুমতি পরিবর্তন করা যায়নি। আবার চেষ্টা করুন।'}</p>}
    <p>{en ? 'Camera and microphone access can also be changed in your phone or browser settings.' : 'ফোন বা ব্রাউজারের সেটিংস থেকেও ক্যামেরা ও মাইক্রোফোনের অনুমতি বদলাতে পারবেন।'}</p>
  </div>;
}
