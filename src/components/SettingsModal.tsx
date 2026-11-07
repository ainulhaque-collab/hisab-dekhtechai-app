import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Settings, UserRound, BriefcaseBusiness, Cloud, Download, ChevronRight, ArrowLeft, Volume2, ShieldCheck, Globe2, LockKeyhole, LogOut, Bell, BookOpen, Palette } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { SecuritySettings } from './SecuritySettings';
import { SoundSettings } from './SoundSettings';
import { AIPrivacySettings } from './AIPrivacySettings';
import { NotificationSettings } from './NotificationSettings';
import { DataHealthPanel } from './DataHealthPanel';
import { ContentCenter } from './ContentCenter';
import { ModalShell, secondaryButton } from './ModalShell';
import { AppearanceSettings } from './AppearanceSettings';
import { mobileUiEnabled } from '../appearance/mobileAppearance';
import { useServiceIdentity } from '../access/useServiceIdentity';
import { aiFeaturesEnabled } from '../ai/availability';
import {recoveryEnabled} from '../sync/recovery/runtime';
import {liveSyncEnabled} from '../sync/live/runtime';
const LiveSyncPanel=lazy(()=>import('./LiveSyncPanel').then(m=>({default:m.LiveSyncPanel})));
const CloudRecoveryPanel=lazy(()=>import('./CloudRecoveryPanel').then(m=>({default:m.CloudRecoveryPanel})));
const CustomerAccessPanel=lazy(()=>import('./CustomerAccessPanel').then(module=>({default:module.CustomerAccessPanel})));
const AccountSettingsPanel=lazy(()=>import('./AccountSettingsPanel'));
const accountAuthEnabled=import.meta.env.VITE_SUPABASE_AUTH_ENABLED==='true';

interface SettingsModalProps {
  isOpen: boolean; onClose: () => void;
  initialSection?:'home'|'account'|'backup';
  onOpenProfileModal: () => void; onOpenSyncModal: () => void; onOpenSnapshotModal: () => void;
}
export function SettingsModal({ isOpen, onClose, initialSection='home', onOpenProfileModal, onOpenSyncModal, onOpenSnapshotModal }: SettingsModalProps) {
  const { language, setLanguage, userProfile, signOut, db, currentWorkspace,auth } = useApp();
  const service=useServiceIdentity(auth);
  const [section, setSection] = useState<'home' | 'account' | 'sound' | 'security' | 'privacy' | 'backup' | 'notifications' | 'data' | 'content' | 'appearance'>(initialSection);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => { if (isOpen) setSection(initialSection); }, [isOpen,initialSection]);
  if (!isOpen) return null;
  const en = language === 'en';
  const titles = { appearance: en ? 'Appearance' : 'পর্দার রং ও থিম', account: en ? 'Account & sign-in' : 'অ্যাকাউন্ট ও লগইন', home: en ? 'Settings' : 'সেটিংস', sound: en ? 'Sounds & haptics' : 'শব্দ ও কম্পন', security: en ? 'App security' : 'অ্যাপের নিরাপত্তা', privacy: en ? 'Privacy' : 'গোপনীয়তা', backup: en ? 'Backup & recovery' : 'ব্যাকআপ ও পুনরুদ্ধার', notifications: en ? 'Notifications' : 'নোটিফিকেশন', data: en ? 'Data health & balance checks' : 'ডেটার অবস্থা ও ব্যালেন্স যাচাই', content: mobileUiEnabled ? (en ? 'Learn about money' : 'টাকার হিসাব শিখুন') : (en?'Learn & Admin drafts':'শিখুন ও Admin-এর খসড়া') };
  const navigate = (callback: () => void) => { onClose(); callback(); };
  const row = (icon: React.ReactNode, title: string, subtitle: string, action: () => void) => <button type="button" onClick={action} className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/30"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-blue-700">{icon}</span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-slate-800">{title}</span><span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{subtitle}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-slate-300" /></button>;
  return <ModalShell title={titles[section]} description={en ? 'Everything you need, in one place.' : 'প্রয়োজনীয় সব নিয়ন্ত্রণ এক জায়গায়।'} icon={<Settings className="h-5 w-5" />} onClose={onClose}>
    <div key={section} className="space-y-3 app-panel-enter">
      {section !== 'home' && <button type="button" onClick={() => setSection('home')} className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400"><ArrowLeft className="h-3.5 w-3.5" />{en ? 'All settings' : 'সব সেটিংস'}</button>}
      {section === 'home' && <>
        {mobileUiEnabled && <p className="app-settings-group">{en ? 'ACCOUNT & WORKSPACES' : 'পরিচয় ও হিসাব খাতা'}</p>}
        {accountAuthEnabled&&row(<UserRound className="h-4 w-4"/>,en?'Account & sign-in':'অ্যাকাউন্ট ও লগইন',en?'Verified Google account and recovery details':'যাচাইকৃত Google অ্যাকাউন্ট ও ফিরে পাওয়ার তথ্য',()=>setSection('account'))}
        {row(<UserRound className="h-4 w-4" />, accountAuthEnabled?(mobileUiEnabled?(en?'Name & photo':'নাম ও ছবি'):(en?'Device profile':'ডিভাইস প্রোফাইল')):(en ? 'My profile' : 'আমার প্রোফাইল'), accountAuthEnabled?(en?'Name and photo saved on this device':'এই ডিভাইসে সংরক্ষিত নাম ও ছবি'):(userProfile?.displayName || (en ? 'Name, photo and contact details' : 'নাম, ছবি ও যোগাযোগের তথ্য')), () => navigate(onOpenProfileModal))}
        {row(<BriefcaseBusiness className="h-4 w-4" />, en ? 'Workspaces' : 'হিসাব খাতা', en ? 'Details, images, archived workspaces' : 'বিবরণ, ছবি ও আর্কাইভ করা খাতা', () => navigate(() => window.dispatchEvent(new Event('hisab-manage-workspaces'))))}
        {mobileUiEnabled && <><p className="app-settings-group">{en ? 'YOUR PREFERENCES' : 'আপনার পছন্দ'}</p>{row(<Palette className="h-4 w-4" />, en ? 'Appearance' : 'পর্দার রং ও থিম', en ? 'Follow phone, Light or Dark' : 'ফোনের মতো, লাইট অথবা ডার্ক', () => setSection('appearance'))}</>}
        <div className="flex items-center gap-3 rounded-2xl border border-slate-100 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 text-blue-700"><Globe2 className="h-4 w-4" /></span><span className="flex-1 text-xs font-semibold text-slate-800">{en ? 'Language' : 'ভাষা'}</span><div className="flex rounded-lg bg-slate-100 p-1">{(['bn', 'en'] as const).map(lang => <button key={lang} type="button" aria-pressed={language === lang} onClick={() => setLanguage(lang)} className={`rounded-md px-3 py-2 text-[11px] font-semibold ${language === lang ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-400'}`}>{lang === 'bn' ? 'বাংলা' : 'English'}</button>)}</div></div>
        {row(<Volume2 className="h-4 w-4" />, en ? 'Sounds & haptics' : 'শব্দ ও কম্পন', en ? 'Transaction sounds, volume and previews' : 'লেনদেনের শব্দ, মাত্রা ও প্রিভিউ', () => setSection('sound'))}
        {row(<Bell className="h-4 w-4" />, en ? 'Notifications' : 'নোটিফিকেশন', en ? 'Transaction alerts and a test on this device' : 'লেনদেনের বার্তা ও এই ডিভাইসে পরীক্ষা', () => setSection('notifications'))}
        {mobileUiEnabled && <p className="app-settings-group">{en ? 'SECURITY & RECORDS' : 'নিরাপত্তা ও সংরক্ষণ'}</p>}
        {row(<LockKeyhole className="h-4 w-4" />, en ? 'App security' : 'অ্যাপের নিরাপত্তা', en ? 'App PIN and supported biometric unlock' : 'অ্যাপ পিন ও সমর্থিত বায়োমেট্রিক আনলক', () => setSection('security'))}
        {row(<Cloud className="h-4 w-4" />, en ? 'Backup & recovery' : 'ব্যাকআপ ও পুনরুদ্ধার', accountAuthEnabled ? (en ? 'Backup files and on-device recovery' : 'ব্যাকআপ ফাইল ও ডিভাইসের রিকভারি') : (en ? 'Google Drive sync, backup files and restore' : 'গুগল ড্রাইভ সিঙ্ক, ব্যাকআপ ফাইল ও রিস্টোর'), () => setSection('backup'))}
        {row(<ShieldCheck className="h-4 w-4" />, en ? 'Data health & balance checks' : 'ডেটার অবস্থা ও ব্যালেন্স যাচাই', en ? 'Saved records, sync, backup and real wallet balances' : 'সংরক্ষণ, সিঙ্ক, ব্যাকআপ ও বাস্তব ওয়ালেটের স্থিতি', () => setSection('data'))}
        {row(<ShieldCheck className="h-4 w-4" />, en ? 'Privacy' : 'গোপনীয়তা', en ? 'Where your records are stored' : 'আপনার হিসাব কোথায় সংরক্ষিত থাকে', () => setSection('privacy'))}
        {mobileUiEnabled && <p className="app-settings-group">{en ? 'LEARN & HELP' : 'শিখুন ও সহায়তা নিন'}</p>}
        {row(<BookOpen className="h-4 w-4"/>,titles.content,mobileUiEnabled?(en?'Simple lessons about spending and saving':'খরচ ও সঞ্চয় নিয়ে সহজ পাঠ'):(en?'Published posts, announcement drafts and verified Admin access':'প্রকাশিত লেখা, ঘোষণার খসড়া ও যাচাইকৃত Admin অনুমতি'),()=>setSection('content'))}
        {userProfile?.email && !accountAuthEnabled && <button type="button" disabled={signingOut} className="inline-flex items-center gap-2 p-3 text-xs font-semibold text-rose-600 disabled:opacity-50" onClick={async () => {
          const pending = db.getPendingOutbox().length;
          if (window.confirm(en ? `Sign out? ${pending} changes are waiting to sync. Your local records will remain.` : `সাইন আউট করবেন? ${pending}টি পরিবর্তন সিঙ্ক বাকি। স্থানীয় হিসাব ডিভাইসেই থাকবে।`)) { setSigningOut(true); try { await signOut(); onClose(); } finally { setSigningOut(false); } }
        }}><LogOut className="h-4 w-4" />{signingOut ? (en ? 'Signing out…' : 'সাইন আউট হচ্ছে…') : (en ? 'Sign out' : 'সাইন আউট')}</button>}
      </>}
      {section === 'sound' && <SoundSettings />}
      {section === 'appearance' && <AppearanceSettings en={en} />}
      {section === 'account' && <Suspense fallback={<p role="status" className="text-sm text-slate-500">{en?'Opening account…':'অ্যাকাউন্ট খোলা হচ্ছে…'}</p>}><AccountSettingsPanel en={en}/>{aiFeaturesEnabled && <CustomerAccessPanel en={en}/>}</Suspense>}
      {section === 'notifications' && <NotificationSettings en={en} />}
      {section === 'content' && <ContentCenter readerOnly={mobileUiEnabled} key={db.getIdentity()?.ownerSubjectHash || 'local'}/>}
      {section === 'data' && <DataHealthPanel key={`${db.getIdentity()?.ownerSubjectHash || 'local'}:${currentWorkspace?.id}`} onOpenSync={()=>navigate(onOpenSyncModal)} onOpenBackup={()=>navigate(onOpenSnapshotModal)} />}
      {section === 'security' && <SecuritySettings language={language} />}
      {section === 'backup' && <>
        {liveSyncEnabled&&<Suspense fallback={<p role="status">{en?'Opening sync…':'সিঙ্ক খুলছে…'}</p>}><LiveSyncPanel/></Suspense>}
        {recoveryEnabled&&<Suspense fallback={<p role="status">{en?'Opening cloud backup…':'ক্লাউড ব্যাকআপ খুলছে…'}</p>}><CloudRecoveryPanel/></Suspense>}
        {!accountAuthEnabled && row(<Cloud className="h-4 w-4" />, en ? 'Google Drive sync' : 'গুগল ড্রাইভ সিঙ্ক', en ? 'Connect your account and check pending changes' : 'অ্যাকাউন্ট সংযুক্ত করুন ও অপেক্ষমাণ পরিবর্তন দেখুন', () => navigate(onOpenSyncModal))}
        {row(<Download className="h-4 w-4" />, en ? 'Backup files & restore' : 'ব্যাকআপ ফাইল ও রিস্টোর', en ? 'Save a local copy, import a backup or restore a recovery point' : 'নিজের কাছে কপি রাখুন, ব্যাকআপ আমদানি বা রিকভারি পয়েন্ট থেকে ফিরিয়ে আনুন', () => navigate(onOpenSnapshotModal))}
        <p className="rounded-xl bg-blue-50 p-3 text-[11px] leading-relaxed text-blue-800">{recoveryEnabled?(en?'Check the verified cloud-backup time above. Keep a separate file copy too. Recovery points stay on this device.':'উপরে যাচাইকৃত ক্লাউড ব্যাকআপের সময় দেখুন। আলাদা ফাইল কপিও রাখুন। রিকভারি পয়েন্ট এই ডিভাইসেই থাকে।'):accountAuthEnabled ? (en ? 'Cloud sync is not enabled in this account preview. Save a backup file for a separate copy. Recovery points stay on this device.' : 'এই অ্যাকাউন্ট প্রিভিউতে ক্লাউড সিঙ্ক চালু হয়নি। আলাদা কপির জন্য ব্যাকআপ ফাইল রাখুন। রিকভারি পয়েন্ট এই ডিভাইসেই থাকে।') : (en ? 'Drive sync and a downloaded backup are separate protections. A local recovery point stays on this device.' : 'ড্রাইভ সিঙ্ক ও ডাউনলোড করা ব্যাকআপ আলাদা সুরক্ষা। স্থানীয় রিকভারি পয়েন্ট শুধু এই ডিভাইসে থাকে।')}</p>
      </>}
      {section === 'privacy' && <><AIPrivacySettings owner={service.enabled?service.owner:db.getIdentity()?.ownerSubjectHash || ''} en={en} /><div className="space-y-4 rounded-2xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-500"><h3 className="font-bold text-slate-800">{en ? 'Your records stay yours' : 'আপনার হিসাব আপনারই থাকে'}</h3><p>{recoveryEnabled?(en?'Your records are saved on this device first. After you enable Supabase backup, complete recovery copies, including receipts and workspace photos, are uploaded under your verified account while this app is open and online. This is not end-to-end encryption.':'হিসাব আগে এই ডিভাইসে থাকে। Supabase ব্যাকআপ চালু করলে অ্যাপ খোলা ও অনলাইনে থাকলে রিসিপ্ট ও খাতার ছবিসহ পূর্ণ পুনরুদ্ধার কপি যাচাইকৃত অ্যাকাউন্টে আপলোড হয়। এটি end-to-end encryption নয়।'):accountAuthEnabled ? (en ? 'Financial records, workspace photos and receipts remain on this device. Account sign-in does not upload them in this preview. You can keep a separate backup file.' : 'হিসাব, খাতার ছবি ও রিসিপ্ট এই ডিভাইসে থাকে। এই প্রিভিউতে লগইন করলে এগুলো আপলোড হয় না। আলাদা ব্যাকআপ ফাইল রাখতে পারবেন।') : en ? 'Financial records are stored locally. Google Drive sync uses your private app storage after you grant access. Workspace photos and receipts are included in your private sync and backups.' : 'হিসাব প্রথমে ডিভাইসে সংরক্ষিত হয়। আপনার অনুমতির পর গুগল ড্রাইভের ব্যক্তিগত অ্যাপ স্টোরেজে সিঙ্ক হয়। খাতার ছবি ও রিসিপ্ট ব্যক্তিগত সিঙ্ক এবং ব্যাকআপে থাকে।'}</p><p>{en ? 'Biometric authentication is managed by Android. Fingerprints and face images are never collected or backed up by this app.' : 'বায়োমেট্রিক যাচাই অ্যান্ড্রয়েড পরিচালনা করে। এই অ্যাপ আঙুলের ছাপ বা মুখের ছবি সংগ্রহ বা ব্যাকআপ করে না।'}</p><button className={secondaryButton} onClick={() => setSection('backup')}>{en ? 'Manage backups' : 'ব্যাকআপ পরিচালনা'}</button></div></>}
    </div>
  </ModalShell>;
}
