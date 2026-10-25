import React, { useState } from 'react';
import { Cloud, CloudOff, CheckCheck, RefreshCw, Clock3, ShieldCheck, ArrowRight, AlertCircle, HelpCircle, ChevronDown } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ModalShell, primaryButton, secondaryButton } from './ModalShell';

export function SyncModal({ isOpen, onClose, onOpenConflictModal, onOpenAuthModal }: {
  isOpen: boolean; onClose: () => void; onOpenConflictModal: () => void; onOpenAuthModal?: () => void;
}) {
  const { syncStatus, isOnline, isLiveGoogleAuth, triggerManualSync, conflicts, language } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!isOpen) return null;
  const en = language === 'en';
  const verified = isOnline && isLiveGoogleAuth && syncStatus.state === 'synced_verified' && !!syncStatus.lastSuccessfulSyncAt;
  const needsAuth = !isLiveGoogleAuth || syncStatus.state === 'auth_required';
  const title = !isOnline ? (en ? 'Saved on this device' : 'এই ডিভাইসে সংরক্ষিত') : verified ? (en ? 'Everything is up to date' : 'সব পরিবর্তন সিঙ্ক হয়েছে') : syncStatus.state === 'quota_full' ? (en ? 'Drive storage needs attention' : 'ড্রাইভের স্টোরেজ পরীক্ষা করুন') : needsAuth ? (en ? 'Connect your Google Drive' : 'আপনার গুগল ড্রাইভ যুক্ত করুন') : syncStatus.state === 'syncing' ? (en ? 'Syncing your changes…' : 'আপনার পরিবর্তন সিঙ্ক হচ্ছে…') : (en ? 'Your changes are waiting' : 'আপনার পরিবর্তন অপেক্ষায় আছে');
  const description = !isOnline ? (en ? 'You can keep recording offline. Sync when you reconnect.' : 'অফলাইনেও হিসাব রাখুন। ইন্টারনেট ফিরলে সিঙ্ক করুন।') : verified ? (en ? 'Your latest sync was verified with Google Drive.' : 'গুগল ড্রাইভে সর্বশেষ সিঙ্ক যাচাই হয়েছে।') : needsAuth ? (en ? 'Keep a private copy and continue across your devices.' : 'ব্যক্তিগত কপি রাখুন, অন্য ডিভাইসেও হিসাব দেখুন।') : (en ? 'Local records stay safe while synchronization completes.' : 'সিঙ্ক শেষ হওয়ার অপেক্ষায় স্থানীয় হিসাব সুরক্ষিত আছে।');
  const StatusIcon = !isOnline ? CloudOff : verified ? CheckCheck : Cloud;
  const connect = () => { onClose(); onOpenAuthModal?.(); };
  async function syncNow() { setBusy(true); setError(false); try { await triggerManualSync(); } catch { setError(true); } finally { setBusy(false); } }
  return <ModalShell title={en ? 'Google Drive Sync' : 'গুগল ড্রাইভ সিঙ্ক'} description={en ? 'Your records. Your private Drive.' : 'আপনার হিসাব, আপনার ব্যক্তিগত ড্রাইভ।'} icon={<Cloud className="h-5 w-5" />} onClose={onClose} busy={busy}
    footer={<div className="space-y-2.5">
      <button className={`${primaryButton} w-full`} disabled={!isOnline || busy || (!needsAuth && !isLiveGoogleAuth)} onClick={needsAuth ? connect : syncNow}>
        {needsAuth ? <><span>{en ? 'Connect Google Drive' : 'গুগল ড্রাইভ যুক্ত করুন'}</span><ArrowRight className="h-4 w-4" /></> : <><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /><span>{en ? 'Sync Now' : 'এখন সিঙ্ক করুন'}</span></>}
      </button>
      {!needsAuth && <button className={`${secondaryButton} w-full`} onClick={connect}>{en ? 'Reconnect Google Drive' : 'গুগল ড্রাইভ পুনরায় যুক্ত করুন'}</button>}
      <p className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><ShieldCheck className="h-3 w-3" />{en ? 'Private app storage · Accessible only to you' : 'ব্যক্তিগত অ্যাপ স্টোরেজ · শুধু আপনার জন্য'}</p>
    </div>}>
    <div className="space-y-4">
      <div role="status" className={`rounded-2xl border p-4 ${verified ? 'border-emerald-100 bg-emerald-50/60' : 'border-blue-100/80 bg-blue-50/50'}`}>
        <div className="mb-3 flex items-center justify-between">
          <StatusIcon className={`h-6 w-6 ${verified ? 'text-emerald-600' : 'text-blue-600'}`} />
          <span className={`rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold ring-1 ${verified ? 'text-emerald-700 ring-emerald-100' : 'text-slate-600 ring-slate-200/70'}`}>
            <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${verified ? 'bg-emerald-500' : !isOnline ? 'bg-slate-400' : 'bg-amber-400'}`} />
            {!isOnline ? (en ? 'Offline' : 'অফলাইন') : needsAuth ? (en ? 'Not connected' : 'সংযোগ নেই') : (en ? 'Connected' : 'সংযুক্ত')}
          </span>
        </div>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
      </div>
      <div className="grid grid-cols-2 divide-x divide-slate-100 rounded-2xl border border-slate-100 bg-white py-3.5">
        <div className="px-4"><div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-400"><RefreshCw className="h-3 w-3" />{en ? 'Pending changes' : 'অপেক্ষমাণ পরিবর্তন'}</div><div className="text-xl font-bold tabular-nums tracking-tight">{syncStatus.pendingOutboxCount}<span className="ml-1.5 text-[10px] font-normal text-slate-400">{en ? 'to sync' : 'সিঙ্ক বাকি'}</span></div></div>
        <div className="px-4"><div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-400"><Clock3 className="h-3 w-3" />{en ? 'Last successful sync' : 'সর্বশেষ সফল সিঙ্ক'}</div><p className="text-xs font-semibold leading-relaxed text-slate-700">{syncStatus.lastSuccessfulSyncAt ? new Date(syncStatus.lastSuccessfulSyncAt).toLocaleString(en ? 'en-GB' : 'bn-BD') : (en ? 'Not synced yet' : 'এখনও সিঙ্ক হয়নি')}</p></div>
      </div>
      {(syncStatus.lastError || error) && <div role="alert" className="flex gap-2.5 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{en ? 'Sync could not finish. Your local records remain safe. Check your connection and reconnect the Google account that owns these records.' : 'সিঙ্ক সম্পূর্ণ হয়নি। স্থানীয় হিসাব সুরক্ষিত আছে। ইন্টারনেট পরীক্ষা করে হিসাবের মালিকের গুগল অ্যাকাউন্ট পুনরায় যুক্ত করুন।'}</span></div>}
      {conflicts.some(c => c.status === 'needs_review') && <button className={`${secondaryButton} w-full border-amber-200 text-amber-700`} onClick={onOpenConflictModal}><AlertCircle className="h-4 w-4" />{en ? 'Review conflicting changes' : 'পরস্পরবিরোধী পরিবর্তন দেখুন'}</button>}
      <details className="group rounded-xl border border-slate-100 px-3.5 py-3 text-xs"><summary className="flex cursor-pointer list-none items-center gap-2 text-slate-500"><HelpCircle className="h-4 w-4" /><span className="flex-1 font-medium">{en ? 'Help & troubleshooting' : 'সাহায্য ও সমস্যা সমাধান'}</span><ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" /></summary><p className="pt-3 leading-relaxed text-slate-500">{en ? 'Use the same Google account on every device and allow private Drive app storage when prompted. Offline changes remain pending until sync verification finishes. Never clear app storage to resolve a sync error.' : 'প্রতিটি ডিভাইসে একই গুগল অ্যাকাউন্ট ব্যবহার করুন এবং ব্যক্তিগত ড্রাইভ অ্যাপ স্টোরেজ অনুমোদন করুন। যাচাই শেষ না হওয়া পর্যন্ত পরিবর্তন অপেক্ষায় থাকবে। সিঙ্ক সমস্যায় অ্যাপের ডাটা মুছবেন না।'}</p></details>
    </div>
  </ModalShell>;
}
