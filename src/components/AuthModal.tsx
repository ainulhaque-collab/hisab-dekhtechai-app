import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
export function AuthModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { signInWithGoogle, isOnline, language } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!isOpen) return null;
  const en = language === 'en';
  return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-label="Connect Google Drive" className="bg-white text-slate-900 p-5 rounded-2xl w-full max-w-md space-y-4">
    <h2 className="font-bold">{en ? 'Connect Google Drive' : 'গুগল ড্রাইভ সংযুক্ত করুন'}</h2>
    <p>{en ? 'Choose the Google account that owns your records and allow private Drive app storage. Existing offline records will be linked only with your confirmation. Your records stay on this device if authorization fails.' : 'আপনার হিসাবের মালিকের গুগল অ্যাকাউন্ট নির্বাচন করে ব্যক্তিগত ড্রাইভ অ্যাপ স্টোরেজ অনুমোদন করুন। আপনার নিশ্চিতকরণের পরেই অফলাইন হিসাব যুক্ত হবে। অনুমতি ব্যর্থ হলেও হিসাব ডিভাইসে থাকবে।'}</p>
    {error && <p role="alert">{en ? 'Connection could not finish. Check your internet, allow Drive access, and use the original owner account. If Google rejects this app, contact the owner for an authorized test build.' : 'সংযোগ সম্পূর্ণ হয়নি। ইন্টারনেট ও ড্রাইভের অনুমতি পরীক্ষা করে মূল মালিকের অ্যাকাউন্ট ব্যবহার করুন। গুগল অ্যাপ প্রত্যাখ্যান করলে অনুমোদিত টেস্ট বিল্ডের জন্য মালিককে জানান।'}</p>}
    <button className="w-full p-3 bg-blue-700 text-white rounded-lg disabled:opacity-40" disabled={!isOnline || busy} onClick={async () => { setBusy(true); setError(false); try { await signInWithGoogle(); onClose(); } catch { setError(true); } finally { setBusy(false); } }}>{busy ? '…' : (en ? 'Continue with Google' : 'গুগল দিয়ে এগিয়ে যান')}</button>
    <button className="w-full p-3 border rounded-lg" disabled={busy} onClick={onClose}>{en ? 'Cancel' : 'বাতিল'}</button>
  </section></div>;
}
