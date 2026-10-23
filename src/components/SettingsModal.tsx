import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Settings,
  Globe,
  Lock,
  LogOut,
  User,
  X,
  Info
} from 'lucide-react';

import { pinLock } from '../security/pinLock';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAuthModal: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenAuthModal,
}) => {
  const {
    language,
    setLanguage,
    userProfile,
    auth,
    db,
    refreshState,
  } = useApp();

  const isEn = language === 'en';

  const [pinEnabled, setPinEnabled] = useState(() => pinLock.isEnabled());
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'security' | 'privacy'>('general');

  if (!isOpen) return null;

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) {
      alert(isEn ? 'PIN must be 4 digits' : 'পিন ৪ সংখ্যার হতে হবে');
      return;
    }
    if (pin !== confirmPin) {
      alert(isEn ? 'PINs do not match' : 'উভয় পিন এক হতে হবে');
      return;
    }
    await pinLock.setPin(pin);
    setPinEnabled(true);
    setShowPinSetup(false);
    setPin('');
    setConfirmPin('');
  };

  const handleSignOut = () => {
    const pending = db.getPendingOutbox().length;
    if (pending > 0) {
      const confirmPrompt = isEn
        ? `You have ${pending} unsynced changes. Are you sure you want to sign out?`
        : `আপনার ডিভাইসে ${pending}টি আনসিঙ্কড পরিবর্তন রয়েছে। আপনি কি সাইন আউট করতে চান?`;
      if (!confirm(confirmPrompt)) {
        return;
      }
    }
    auth.signOut();
    refreshState();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl border border-slate-200 text-xs max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              {isEn ? 'Settings' : 'সেটিংস'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Subtabs */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl my-3 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveSubTab('general')}
            className={`py-1.5 rounded-lg transition-all ${
              activeSubTab === 'general'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {isEn ? 'General' : 'সাধারণ'}
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('security')}
            className={`py-1.5 rounded-lg transition-all ${
              activeSubTab === 'security'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {isEn ? 'Security' : 'সুরক্ষা'}
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('privacy')}
            className={`py-1.5 rounded-lg transition-all ${
              activeSubTab === 'privacy'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {isEn ? 'Privacy' : 'গোপনীয়তা'}
          </button>
        </div>

        {/* General Tab */}
        {activeSubTab === 'general' && (
          <div className="space-y-3 pt-1">
            {/* Google Account */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 flex items-center gap-1.5">
                  <User className="w-4 h-4 text-slate-600" />
                  <span>{isEn ? 'Google Account & Drive Sync' : 'গুগল অ্যাকাউন্ট ও ড্রাইভ সংযোগ'}</span>
                </span>
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    userProfile?.isDriveAuthorized
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {userProfile?.isDriveAuthorized
                    ? (isEn ? 'Connected' : 'সংযুক্ত')
                    : (isEn ? 'Not Connected' : 'সংযোগ নেই')}
                </span>
              </div>

              {userProfile ? (
                <div className="space-y-1 text-[11px] text-slate-600">
                  <div>
                    {isEn ? 'User:' : 'ব্যবহারকারী:'}{' '}
                    <strong className="text-slate-800">{userProfile.displayName}</strong>
                  </div>
                  <div className="text-slate-500">{userProfile.email}</div>
                  <div className="pt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="px-2.5 py-1 text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg font-medium flex items-center gap-1 transition-colors"
                    >
                      <LogOut className="w-3 h-3" />
                      <span>{isEn ? 'Sign Out' : 'লগআউট'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-[11px] text-slate-500 mb-2.5">
                    {isEn
                      ? 'Connect your Google Drive to enable cross-device synchronization and automatic cloud backups.'
                      : 'ডিভাইস সিঙ্ক এবং ক্লাউড ব্যাকআপের জন্য আপনার গুগল ড্রাইভ যুক্ত করুন।'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAuthModal();
                    }}
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors shadow-2xs"
                  >
                    <span>{isEn ? 'Connect Google Drive' : 'গুগল ড্রাইভ যুক্ত করুন'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Language Selection */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-slate-500" />
                <span className="font-medium text-slate-800">
                  {isEn ? 'Interface Language' : 'অ্যাপের ভাষা'}
                </span>
              </div>
              <div className="flex gap-1 bg-white p-0.5 rounded-lg border border-slate-200 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                    language === 'en' ? 'bg-slate-900 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('bn')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                    language === 'bn' ? 'bg-slate-900 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  বাংলা
                </button>
              </div>
            </div>

            {/* App Info */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-[11px] text-slate-500 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-slate-500" />
                <span>Hisab DekhteChai v1.0</span>
              </div>
              <span className="text-slate-400">SQLite + Drive AppData</span>
            </div>
          </div>
        )}

        {/* Security / PIN Lock Tab */}
        {activeSubTab === 'security' && (
          <div className="space-y-3 pt-1">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-slate-600" />
                  <span className="font-medium text-slate-800">
                    {isEn ? '4-Digit App Lock PIN' : '৪-সংখ্যার অ্যাপ লক পিন'}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={pinEnabled}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setShowPinSetup(true);
                    } else {
                      pinLock.removePin();
                      setPinEnabled(false);
                    }
                  }}
                  className="w-4 h-4 rounded text-slate-900 focus:ring-slate-900"
                />
              </div>

              <p className="text-[11px] text-slate-500">
                {isEn
                  ? 'Require PIN authentication each time the application is opened.'
                  : 'অ্যাপ ওপেন করার সময় পিন ভেরিফিকেশন প্রয়োজন হবে।'}
              </p>

              {showPinSetup && (
                <form onSubmit={handleSavePin} className="space-y-2.5 pt-2 border-t border-slate-200">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      {isEn ? 'Enter 4-Digit PIN' : '৪-সংখ্যার পিন দিন'}
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-center text-lg tracking-widest font-mono"
                      autoFocus
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      {isEn ? 'Confirm PIN' : 'পিন নিশ্চিত করুন'}
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-center text-lg tracking-widest font-mono"
                      required
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium shadow-2xs transition-colors"
                    >
                      {isEn ? 'Set PIN' : 'সংরক্ষণ'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPinSetup(false)}
                      className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg font-medium hover:bg-slate-100"
                    >
                      {isEn ? 'Cancel' : 'বাতিল'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Privacy Tab */}
        {activeSubTab === 'privacy' && (
          <div className="space-y-3 pt-1 text-slate-600 text-[11px] leading-relaxed">
            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-700">
              <span className="font-semibold block mb-1 text-slate-900">
                {isEn ? 'Local-First Architecture' : 'লোকাল-ফার্স্ট সুরক্ষা'}
              </span>
              {isEn
                ? 'All financial records are stored directly in your local SQLite / OPFS database and synced strictly through your personal Google Drive (drive.appdata). No intermediate application server ever has access to your accounts or transactions.'
                : 'আপনার সমস্ত আর্থিক হিসাব লোকাল ডিভাইসে এবং আপনার নিজস্ব Google Drive (appdata) এ সংরক্ষিত থাকে। কোনো বাণিজ্যিক থার্ড পার্টি সার্ভারে আপনার ডাটা যায় না।'}
            </div>

            <div className="space-y-1">
              <h4 className="font-semibold text-slate-800 text-xs">
                {isEn ? 'Zero Data Collection' : 'ডাটা গোপনীয়তা'}
              </h4>
              <p className="text-slate-500">
                {isEn
                  ? 'No analytics, no ad trackers, and no bank credentials required.'
                  : 'কোনো বিজ্ঞাপন বা অ্যানালিটিক্স স্ক্রিপ্ট নেই, ব্যাংক পাসওয়ার্ড কখনও চাওয়া হয় না।'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
