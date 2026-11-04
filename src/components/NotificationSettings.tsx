import { useState, useSyncExternalStore } from 'react';
import { Bell, BellOff, Send, Inbox } from 'lucide-react';
import { notificationService } from '../notifications/service';
import { primaryButton, secondaryButton } from './ModalShell';
import { NotificationInbox } from './NotificationInbox';

export function NotificationSettings({ en }: { en: boolean }) {
  const state = useSyncExternalStore(notificationService.subscribe, notificationService.snapshot);
  const [inbox, setInbox] = useState(false);
  if (inbox) return <NotificationInbox en={en} onBack={() => setInbox(false)} />;
  const error = state.error;
  const message = error === 'PUSH_PERMISSION_DENIED'
    ? en ? 'Notifications are blocked. Allow them in your phone or browser settings, then try again.' : 'নোটিফিকেশন বন্ধ আছে। ফোন বা ব্রাউজারের সেটিংসে অনুমতি দিয়ে আবার চেষ্টা করুন।'
    : error === 'PUSH_AUTH_REQUIRED'
    ? en ? 'Connect your Google account through Drive sync first.' : 'আগে ড্রাইভ সিঙ্ক থেকে নিজের গুগল অ্যাকাউন্ট সংযুক্ত করুন।'
    : error === 'PUSH_UNSUPPORTED'
    ? en ? 'This browser does not support push. Try Chrome over HTTPS or the Android app.' : 'এই ব্রাউজারে পুশ সমর্থিত নয়। HTTPS-এ Chrome বা অ্যান্ড্রয়েড অ্যাপ ব্যবহার করুন।'
    : error === 'PUSH_DISABLE_INCOMPLETE'
    ? en ? 'Could not finish disabling notifications. Reconnect to the internet and tap Turn off again.' : 'নোটিফিকেশন পুরোপুরি বন্ধ করা যায়নি। ইন্টারনেট সংযুক্ত করে আবার বন্ধ করুন চাপুন।'
    : error === 'PUSH_DEVICE_LIMIT'
    ? en ? 'Five devices are already registered. Turn notifications off on an older device first.' : 'ইতিমধ্যে পাঁচটি ডিভাইস যুক্ত আছে। আগে পুরোনো একটি ডিভাইসে নোটিফিকেশন বন্ধ করুন।'
    : en ? 'Notifications could not connect. Check your internet and try again. Your entries are saved.' : 'নোটিফিকেশন সংযোগ হয়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন। আপনার হিসাব সংরক্ষিত আছে।';
  return <div className="space-y-4">
    <button type="button" className={`${secondaryButton} w-full`} onClick={() => setInbox(true)}><Inbox className="h-4 w-4" />{en ? 'Notification inbox' : 'নোটিফিকেশন ইনবক্স'}</button>
    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
      <div className="flex items-center gap-3"><Bell className="h-5 w-5 text-blue-700" /><h3 className="text-sm font-semibold text-slate-900">{en ? 'Updates on this device' : 'এই ডিভাইসের নোটিফিকেশন'}</h3></div>
      <p className="mt-3 text-xs leading-relaxed text-slate-600">{en ? 'Receive an alert when a transaction is saved on your connected devices. Amounts, account names and notes stay off the lock screen.' : 'সংযুক্ত ডিভাইসে লেনদেন সংরক্ষিত হলে বার্তা পাবেন। লক স্ক্রিনে টাকার পরিমাণ, অ্যাকাউন্টের নাম বা নোট দেখানো হবে না।'}</p>
      <p className="mt-3 text-xs font-semibold text-slate-800" role="status">{state.busy ? (en ? 'Connecting…' : 'সংযোগ হচ্ছে…') : state.enabled ? (en ? 'Notifications enabled' : 'নোটিফিকেশন চালু') : (en ? 'Notifications off' : 'নোটিফিকেশন বন্ধ')}</p>
    </div>
    {error && <p role="alert" data-error-code={error} className="rounded-xl bg-rose-50 p-3 text-xs leading-relaxed text-rose-800">{message}</p>}
    <button type="button" disabled={state.busy} className={`${primaryButton} w-full disabled:opacity-50`} onClick={() => void notificationService.register()}><Bell className="h-4 w-4" />{state.enabled ? (en ? 'Refresh connection' : 'সংযোগ যাচাই করুন') : (en ? 'Enable notifications' : 'নোটিফিকেশন চালু করুন')}</button>
    {state.enabled && <button type="button" disabled={state.busy} className={`${secondaryButton} w-full disabled:opacity-50`} onClick={() => void notificationService.test()}><Send className="h-4 w-4" />{en ? 'Send test to this device' : 'এই ডিভাইসে পরীক্ষার বার্তা দিন'}</button>}
    {(state.enabled || error === 'PUSH_DISABLE_INCOMPLETE') && <button type="button" disabled={state.busy} className={`${secondaryButton} w-full disabled:opacity-50`} onClick={() => void notificationService.disable()}><BellOff className="h-4 w-4" />{en ? 'Turn off' : 'বন্ধ করুন'}</button>}
    {state.accepted && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-800">{en ? 'Firebase accepted the test. Check this device’s notifications to confirm delivery.' : 'Firebase পরীক্ষার বার্তাটি গ্রহণ করেছে। পৌঁছেছে কি না এই ডিভাইসের নোটিফিকেশনে দেখুন।'}</p>}
    {state.lastReceived && <p className="text-xs text-slate-500">{en ? 'Last received: ' : 'শেষ বার্তা: '}{new Date(state.lastReceived).toLocaleString(en ? 'en-GB' : 'bn-BD')}</p>}
    <p className="text-[11px] leading-relaxed text-slate-500">{en ? 'Delivery needs an internet connection and your device’s permission. Signing out turns notifications off here. Loan reminders and announcements are not enabled yet.' : 'বার্তা পেতে ইন্টারনেট ও ডিভাইসের অনুমতি দরকার। সাইন আউট করলে এখানে নোটিফিকেশন বন্ধ হবে। ঋণের রিমাইন্ডার ও ঘোষণার বার্তা এখনও চালু হয়নি।'}</p>
  </div>;
}
