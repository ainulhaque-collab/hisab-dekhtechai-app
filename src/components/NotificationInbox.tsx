import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { notificationService } from '../notifications/service';
import type { NotificationInbox as InboxData } from '../notifications/inbox';
import { secondaryButton } from './ModalShell';

export function NotificationInbox({ en, onBack }: { en: boolean; onBack: () => void }) {
  const { db, userProfile } = useApp();
  const owner = db.getIdentity()?.ownerSubjectHash || '';
  const authorized = /^[a-f0-9]{64}$/.test(owner) && userProfile?.subjectHash === owner;
  const [data, setData] = useState<InboxData & { owner: string }>({ owner: '', items: [], readThrough: 0 });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    if (!authorized) { setBusy(false); return; }
    setBusy(true); setFailed(false);
    try {
      const next = await notificationService.inbox();
      if (generation.current === current) setData({ ...next, owner });
    } catch { if (generation.current === current) setFailed(true); }
    finally { if (generation.current === current) setBusy(false); }
  }, [owner, authorized]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  const items = data.owner === owner && authorized ? data.items : [];
  const unread = items.filter(item => item.sequence > data.readThrough).length;
  const markAllRead = async () => {
    const newest = items[0]; if (!newest || !authorized) return;
    const current = ++generation.current; setBusy(true); setFailed(false);
    try {
      await notificationService.markRead(newest.id);
      if (generation.current === current) setData(value => value.owner === owner ? { ...value, readThrough: Math.max(value.readThrough, newest.sequence) } : value);
    } catch { if (generation.current === current) setFailed(true); }
    finally { if (generation.current === current) setBusy(false); }
  };
  return <div className="space-y-4">
    <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-xs text-slate-500"><ArrowLeft className="h-4 w-4" />{en ? 'Notification settings' : 'নোটিফিকেশন সেটিংস'}</button>
    <div className="flex items-center gap-3"><Bell className="h-5 w-5 text-blue-700" /><div className="flex-1"><h3 className="text-sm font-semibold text-slate-900">{en ? 'Notification inbox' : 'নোটিফিকেশন ইনবক্স'}</h3><p role="status" className="mt-1 text-xs text-slate-500">{busy ? (en ? 'Loading…' : 'লোড হচ্ছে…') : en ? `${unread} unread` : `${unread.toLocaleString('bn-BD')}টি না পড়া`}</p></div><button type="button" disabled={busy || !authorized} aria-label={en ? 'Refresh inbox' : 'ইনবক্স রিফ্রেশ করুন'} onClick={() => void refresh()} className="min-h-11 min-w-11 rounded-xl p-3 text-blue-700 hover:bg-blue-50 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} /></button></div>
    {!authorized && <p className="rounded-xl bg-blue-50 p-4 text-xs leading-relaxed text-blue-800">{en ? 'Connect your Google account through Drive sync to see your messages.' : 'নিজের বার্তা দেখতে ড্রাইভ সিঙ্ক থেকে গুগল অ্যাকাউন্ট সংযুক্ত করুন।'}</p>}
    {failed && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs leading-relaxed text-rose-800">{en ? 'The inbox could not connect. Check your connection and refresh. Your entries are saved.' : 'ইনবক্সে সংযোগ হয়নি। ইন্টারনেট দেখে রিফ্রেশ করুন। আপনার হিসাব সংরক্ষিত আছে।'}</p>}
    {authorized && <>
      <button type="button" disabled={busy || !unread} onClick={() => void markAllRead()} className={`${secondaryButton} w-full disabled:opacity-40`}><CheckCheck className="h-4 w-4" />{en ? 'Mark all as read' : 'সবগুলো পড়া হয়েছে'}</button>
      {!items.length && !busy && !failed && <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs leading-relaxed text-slate-500">{en ? 'No messages yet. New alerts will appear here.' : 'এখনও কোনো বার্তা নেই। নতুন বার্তাগুলো এখানে দেখা যাবে।'}</p>}
      <ul className="space-y-3">{items.map(item => <li key={item.id} className={`rounded-2xl border p-4 ${item.sequence > data.readThrough ? 'border-blue-100 bg-blue-50/60' : 'border-slate-100 bg-white'}`}><div className="flex items-center justify-between gap-3"><h4 className="text-xs font-semibold text-slate-900">{item.kind === 'test' ? (en ? 'Test notification' : 'পরীক্ষার নোটিফিকেশন') : (en ? 'Transaction saved' : 'লেনদেন সংরক্ষিত হয়েছে')}</h4>{item.sequence > data.readThrough && <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-800">{en ? 'New' : 'নতুন'}</span>}</div><p className="mt-2 text-xs leading-relaxed text-slate-600">{item.kind === 'test' ? (en ? 'A notification test was requested from one of your devices.' : 'আপনার একটি ডিভাইস থেকে পরীক্ষার নোটিফিকেশন পাঠানো হয়েছে।') : (en ? 'Open your records to view the saved transaction.' : 'সংরক্ষিত লেনদেনটি দেখতে হিসাব খুলুন।')}</p><time dateTime={new Date(item.at).toISOString()} className="mt-3 block text-[11px] text-slate-400">{new Date(item.at).toLocaleString(en ? 'en-GB' : 'bn-BD')}</time></li>)}</ul>
      <p className="text-[11px] leading-relaxed text-slate-500">{en ? 'Up to 100 messages from the last 30 days. Read status follows your Google account across devices. Amounts and private notes are not stored here.' : 'গত ৩০ দিনের সর্বোচ্চ ১০০টি বার্তা। পড়া হয়েছে কি না একই গুগল অ্যাকাউন্টের ডিভাইসগুলোতে দেখা যাবে। এখানে টাকার পরিমাণ বা ব্যক্তিগত নোট রাখা হয় না।'}</p>
    </>}
  </div>;
}
