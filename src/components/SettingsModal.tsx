import React, { useEffect, useState } from 'react';
import { Settings, UserRound, BriefcaseBusiness, Cloud, Download, ChevronRight, ArrowLeft, Volume2, ShieldCheck, Globe2, LockKeyhole, LogOut } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { SecuritySettings } from './SecuritySettings';
import { SoundSettings } from './SoundSettings';
import { AIPrivacySettings } from './AIPrivacySettings';
import { ModalShell, secondaryButton } from './ModalShell';

interface SettingsModalProps {
  isOpen: boolean; onClose: () => void;
  onOpenProfileModal: () => void; onOpenSyncModal: () => void; onOpenSnapshotModal: () => void;
}
export function SettingsModal({ isOpen, onClose, onOpenProfileModal, onOpenSyncModal, onOpenSnapshotModal }: SettingsModalProps) {
  const { language, setLanguage, userProfile, signOut, db } = useApp();
  const [section, setSection] = useState<'home' | 'sound' | 'security' | 'privacy' | 'backup'>('home');
  useEffect(() => { if (isOpen) setSection('home'); }, [isOpen]);
  if (!isOpen) return null;
  const en = language === 'en';
  const titles = { home: en ? 'Settings' : 'সেটিংস', sound: en ? 'Sounds & haptics' : 'শব্দ ও কম্পন', security: en ? 'App security' : 'অ্যাপের নিরাপত্তা', privacy: en ? 'Privacy' : 'গোপনীয়তা', backup: en ? 'Backup & recovery' : 'ব্যাকআপ ও পুনরুদ্ধার' };
  const navigate = (callback: () => void) => { onClose(); callback(); };
  const row = (icon: React.ReactNode, title: string, subtitle: string, action: () => void) => <button type="button" onClick={action} className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/30"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-blue-700">{icon}</span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-slate-800">{title}</span><span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{subtitle}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-slate-300" /></button>;
  return <ModalShell title={titles[section]} description={en ? 'Everything you need, in one place.' : 'প্রয়োজনীয় সব নিয়ন্ত্রণ এক জায়গায়।'} icon={<Settings className="h-5 w-5" />} onClose={onClose}>
    <div key={section} className="space-y-3 app-panel-enter">
      {section !== 'home' && <button type="button" onClick={() => setSection('home')} className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400"><ArrowLeft className="h-3.5 w-3.5" />{en ? 'All settings' : 'সব সেটিংস'}</button>}
      {section === 'home' && <>
        {row(<UserRound className="h-4 w-4" />, en ? 'My profile' : 'আমার প্রোফাইল', userProfile?.displayName || (en ? 'Name, photo and contact details' : 'নাম, ছবি ও যোগাযোগের তথ্য'), () => navigate(onOpenProfileModal))}
        {row(<BriefcaseBusiness className="h-4 w-4" />, en ? 'Workspaces' : 'হিসাব খাতা', en ? 'Details, images, archived workspaces' : 'বিবরণ, ছবি ও আর্কাইভ করা খাতা', () => navigate(() => window.dispatchEvent(new Event('hisab-manage-workspaces'))))}
        <div className="flex items-center gap-3 rounded-2xl border border-slate-100 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 text-blue-700"><Globe2 className="h-4 w-4" /></span><span className="flex-1 text-xs font-semibold text-slate-800">{en ? 'Language' : 'ভাষা'}</span><div className="flex rounded-lg bg-slate-100 p-1">{(['bn', 'en'] as const).map(lang => <button key={lang} type="button" aria-pressed={language === lang} onClick={() => setLanguage(lang)} className={`rounded-md px-3 py-2 text-[11px] font-semibold ${language === lang ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-400'}`}>{lang === 'bn' ? 'বাংলা' : 'English'}</button>)}</div></div>
        {row(<Volume2 className="h-4 w-4" />, en ? 'Sounds & haptics' : 'শব্দ ও কম্পন', en ? 'Transaction sounds, volume and previews' : 'লেনদেনের শব্দ, মাত্রা ও প্রিভিউ', () => setSection('sound'))}
        {row(<LockKeyhole className="h-4 w-4" />, en ? 'App security' : 'অ্যাপের নিরাপত্তা', en ? 'App PIN and supported biometric unlock' : 'অ্যাপ পিন ও সমর্থিত বায়োমেট্রিক আনলক', () => setSection('security'))}
        {row(<Cloud className="h-4 w-4" />, en ? 'Backup & recovery' : 'ব্যাকআপ ও পুনরুদ্ধার', en ? 'Google Drive sync, backup files and restore' : 'গুগল ড্রাইভ সিঙ্ক, ব্যাকআপ ফাইল ও রিস্টোর', () => setSection('backup'))}
        {row(<ShieldCheck className="h-4 w-4" />, en ? 'Privacy' : 'গোপনীয়তা', en ? 'Where your records are stored' : 'আপনার হিসাব কোথায় সংরক্ষিত থাকে', () => setSection('privacy'))}
        {userProfile?.email && <button type="button" className="inline-flex items-center gap-2 p-3 text-xs font-semibold text-rose-600" onClick={() => {
          const pending = db.getPendingOutbox().length;
          if (window.confirm(en ? `Sign out? ${pending} changes are waiting to sync. Your local records will remain.` : `সাইন আউট করবেন? ${pending}টি পরিবর্তন সিঙ্ক বাকি। স্থানীয় হিসাব ডিভাইসেই থাকবে।`)) { signOut(); onClose(); }
        }}><LogOut className="h-4 w-4" />{en ? 'Sign out' : 'সাইন আউট'}</button>}
      </>}
      {section === 'sound' && <SoundSettings />}
      {section === 'security' && <SecuritySettings language={language} />}
      {section === 'backup' && <>
        {row(<Cloud className="h-4 w-4" />, en ? 'Google Drive sync' : 'গুগল ড্রাইভ সিঙ্ক', en ? 'Connect your account and check pending changes' : 'অ্যাকাউন্ট সংযুক্ত করুন ও অপেক্ষমাণ পরিবর্তন দেখুন', () => navigate(onOpenSyncModal))}
        {row(<Download className="h-4 w-4" />, en ? 'Backup files & restore' : 'ব্যাকআপ ফাইল ও রিস্টোর', en ? 'Save a local copy, import a backup or restore a recovery point' : 'নিজের কাছে কপি রাখুন, ব্যাকআপ আমদানি বা রিকভারি পয়েন্ট থেকে ফিরিয়ে আনুন', () => navigate(onOpenSnapshotModal))}
        <p className="rounded-xl bg-blue-50 p-3 text-[11px] leading-relaxed text-blue-800">{en ? 'Drive sync and a downloaded backup are separate protections. A local recovery point stays on this device.' : 'ড্রাইভ সিঙ্ক ও ডাউনলোড করা ব্যাকআপ আলাদা সুরক্ষা। স্থানীয় রিকভারি পয়েন্ট শুধু এই ডিভাইসে থাকে।'}</p>
      </>}
      {section === 'privacy' && <><AIPrivacySettings owner={db.getIdentity()?.ownerSubjectHash || ''} en={en} /><div className="space-y-4 rounded-2xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-500"><h3 className="font-bold text-slate-800">{en ? 'Your records stay yours' : 'আপনার হিসাব আপনারই থাকে'}</h3><p>{en ? 'Financial records are stored locally. Google Drive sync uses your private app storage after you grant access. Workspace photos and receipts are included in your private sync and backups.' : 'হিসাব প্রথমে ডিভাইসে সংরক্ষিত হয়। আপনার অনুমতির পর গুগল ড্রাইভের ব্যক্তিগত অ্যাপ স্টোরেজে সিঙ্ক হয়। খাতার ছবি ও রিসিপ্ট ব্যক্তিগত সিঙ্ক এবং ব্যাকআপে থাকে।'}</p><p>{en ? 'Biometric authentication is managed by Android. Fingerprints and face images are never collected or backed up by this app.' : 'বায়োমেট্রিক যাচাই অ্যান্ড্রয়েড পরিচালনা করে। এই অ্যাপ আঙুলের ছাপ বা মুখের ছবি সংগ্রহ বা ব্যাকআপ করে না।'}</p><button className={secondaryButton} onClick={() => setSection('backup')}>{en ? 'Manage backups' : 'ব্যাকআপ পরিচালনা'}</button></div></>}
    </div>
  </ModalShell>;
}
