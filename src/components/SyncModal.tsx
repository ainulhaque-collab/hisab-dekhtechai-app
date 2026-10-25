import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export function SyncModal({ isOpen, onClose, onOpenConflictModal, onOpenAuthModal }: {
  isOpen: boolean; onClose: () => void; onOpenConflictModal: () => void; onOpenAuthModal?: () => void;
}) {
  const { syncStatus, isOnline, isLiveGoogleAuth, triggerManualSync, conflicts, language } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!isOpen) return null;
  const en = language === 'en';
  const status = !isOnline ? (en ? 'Offline — saved on this device' : 'অফলাইন — ডিভাইসে সংরক্ষিত') :
    syncStatus.state === 'synced_verified' && syncStatus.lastSuccessfulSyncAt ? (en ? 'Sync verified' : 'সিঙ্ক যাচাই হয়েছে') :
    syncStatus.state === 'syncing' ? (en ? 'Synchronizing…' : 'সিঙ্ক হচ্ছে…') :
    !isLiveGoogleAuth || syncStatus.state === 'auth_required' ? (en ? 'Reconnect Google Drive' : 'গুগল ড্রাইভ পুনরায় সংযুক্ত করুন') :
    syncStatus.state === 'quota_full' ? (en ? 'Google Drive storage needs attention' : 'গুগল ড্রাইভের স্টোরেজ পরীক্ষা করুন') :
    (en ? 'Changes pending / sync not verified' : 'পরিবর্তন অপেক্ষায় / সিঙ্ক যাচাই হয়নি');
  return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
    <section role="dialog" aria-modal="true" aria-label="Google Drive Sync" className="bg-white text-slate-900 rounded-2xl p-5 w-full max-w-md space-y-4 max-h-[90dvh] overflow-auto">
      <div className="flex justify-between"><h2 className="font-bold">Google Drive Sync</h2><button aria-label="Close" onClick={onClose}>✕</button></div>
      <p>{isLiveGoogleAuth ? (en ? 'Google Drive connected' : 'গুগল ড্রাইভ সংযুক্ত') : (en ? 'Google Drive needs authorization' : 'গুগল ড্রাইভের অনুমতি প্রয়োজন')}</p>
      <p role="status">{status}</p>
      <p>{en ? 'Pending changes:' : 'অপেক্ষমাণ পরিবর্তন:'} <strong>{syncStatus.pendingOutboxCount}</strong></p>
      <p>{en ? 'Last successful sync:' : 'সর্বশেষ সফল সিঙ্ক:'} {syncStatus.lastSuccessfulSyncAt ? new Date(syncStatus.lastSuccessfulSyncAt).toLocaleString(en ? 'en-GB' : 'bn-BD') : (en ? 'No verified sync yet' : 'এখনও যাচাইকৃত সিঙ্ক হয়নি')}</p>
      {(syncStatus.lastError || error) && <p role="alert" className="bg-amber-50 p-3 rounded-lg">{en ? 'Sync could not finish. Your local records remain on this device. Check your connection and reconnect the Google account that owns these records.' : 'সিঙ্ক সম্পূর্ণ হয়নি। স্থানীয় হিসাব ডিভাইসে আছে। ইন্টারনেট পরীক্ষা করে এই হিসাবের মালিকের গুগল অ্যাকাউন্ট পুনরায় সংযুক্ত করুন।'}</p>}
      <button className="w-full p-3 rounded-lg bg-blue-700 text-white" onClick={() => { onClose(); onOpenAuthModal?.(); }}>{en ? 'Connect / Reconnect Google Drive' : 'গুগল ড্রাইভ সংযুক্ত / পুনরায় সংযুক্ত করুন'}</button>
      <button className="w-full p-3 rounded-lg border disabled:opacity-40" disabled={!isOnline || busy || !isLiveGoogleAuth} onClick={async () => { setBusy(true); setError(false); try { await triggerManualSync(); } catch { setError(true); } finally { setBusy(false); } }}>{en ? 'Sync Now' : 'এখন সিঙ্ক করুন'}</button>
      {conflicts.some(c => c.status === 'needs_review') && <button className="w-full p-3 bg-amber-100 rounded-lg" onClick={onOpenConflictModal}>{en ? 'Review conflicting changes' : 'পরস্পরবিরোধী পরিবর্তন পর্যালোচনা করুন'}</button>}
      <details><summary>{en ? 'Help / Troubleshooting' : 'সাহায্য'}</summary><p className="pt-2">{en ? 'Use the same Google account on every device. Allow private Drive app storage when prompted. Offline changes stay pending until upload and download verification complete. Never clear app storage to fix a sync error.' : 'প্রতিটি ডিভাইসে একই গুগল অ্যাকাউন্ট ব্যবহার করুন। অনুমতি চাইলে ড্রাইভ অ্যাপ স্টোরেজ অনুমোদন করুন। যাচাই শেষ না হওয়া পর্যন্ত পরিবর্তন অপেক্ষায় থাকে। সিঙ্ক সমস্যায় অ্যাপের ডাটা মুছবেন না।'}</p></details>
    </section>
  </div>;
}
