import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Settings,
  Globe,
  Lock,
  Shield,
  LogOut,
  User,
  X,
  Check,
  Smartphone,
  Info
} from 'lucide-react';

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

  const [pinEnabled, setPinEnabled] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'security' | 'privacy'>('general');

  if (!isOpen) return null;

  const handleSavePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) {
      alert(isEn ? 'PIN must be 4 digits' : 'পিন অবশ্যই ৪ ডিজিটের হতে হবে');
      return;
    }
    if (pin !== confirmPin) {
      alert(isEn ? 'PINs do not match' : 'উভয় পিন এক হতে হবে');
      return;
    }
    setPinEnabled(true);
    setShowPinSetup(false);
    setPin('');
    setConfirmPin('');
    alert(isEn ? 'App lock PIN enabled successfully' : 'অ্যাপ লক পিন সফলভাবে সক্রিয় করা হয়েছে');
  };

  const handleSignOut = () => {
    const pending = db.getPendingOutbox().length;
    if (pending > 0) {
      const confirmPrompt = isEn
        ? `You have ${pending} unsynced changes on this device. Logging out will not upload them to Google Drive. Are you sure?`
        : `আপনার ডিভাইসে ${pending}টি আনসিঙ্কড লেনদেন রয়েছে। লগআউট করলে এই পরিবর্তনগুলো ক্লাউডে যাবে না। আপনি কি নিশ্চিত?`;
      if (!confirm(confirmPrompt)) {
        return;
      }
    }
    auth.signOut();
    refreshState();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 text-xs animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-700" />
            <h2 className="text-sm font-bold text-slate-800">
              {isEn ? 'Settings & Security' : 'সেটিংস ও নিরাপত্তা'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Subtabs */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl my-3 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveSubTab('general')}
            className={`py-1.5 rounded-lg transition-all ${
              activeSubTab === 'general'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {isEn ? 'General' : 'সাধারণ'}
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('security')}
            className={`py-1.5 rounded-lg transition-all ${
              activeSubTab === 'security'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {isEn ? 'Lock & Security' : 'লক ও সুরক্ষা'}
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('privacy')}
            className={`py-1.5 rounded-lg transition-all ${
              activeSubTab === 'privacy'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {isEn ? 'Privacy' : 'গোপনীয়তা'}
          </button>
        </div>

        {/* General Tab */}
        {activeSubTab === 'general' && (
          <div className="space-y-4 pt-1">
            {/* Google Account */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <User className="w-4 h-4 text-blue-700" />
                  <span>{isEn ? 'Google Account & Drive Sync' : 'গুগল অ্যাকাউন্ট ও ড্রাইভ সংযোগ'}</span>
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    userProfile?.isDriveAuthorized
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {userProfile?.isDriveAuthorized
                    ? (isEn ? 'Drive Authorized' : 'ড্রাইভ অনুমোদিত')
                    : (isEn ? 'Login Required' : 'লগইন প্রয়োজন')}
                </span>
              </div>

              {userProfile ? (
                <div className="space-y-1 text-[11px] text-slate-600">
                  <div>
                    {isEn ? 'Name:' : 'নাম:'}{' '}
                    <strong className="text-slate-800">{userProfile.displayName}</strong>
                  </div>
                  <div>
                    {isEn ? 'Email:' : 'ইমেইল:'}{' '}
                    <strong className="text-slate-800">{userProfile.email}</strong>
                  </div>
                  <div className="pt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-semibold flex items-center gap-1 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Sign Out' : 'লগআউট করুন'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-[11px] text-slate-500 mb-2">
                    {isEn
                      ? 'Sign in with your Google account to automatically back up and sync your ledger across your phone and tablet:'
                      : 'অন্য ডিভাইসের সাথে স্বয়ংক্রিয়ভাবে হিসাব মেলাতে আপনার গুগল একাউন্টে সাইন-ইন করুন:'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAuthModal();
                    }}
                    className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-xs"
                  >
                    <span>{isEn ? 'Continue with Google' : 'গুগল দিয়ে প্রবেশ করুন (Continue with Google)'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Language Selection */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-slate-600" />
                <span className="font-bold text-slate-800">
                  {isEn ? 'App Language' : 'অ্যাপের ভাষা (Language)'}
                </span>
              </div>
              <div className="flex gap-1 bg-white p-0.5 rounded-lg border border-slate-200 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                    language === 'en' ? 'bg-blue-700 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('bn')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                    language === 'bn' ? 'bg-blue-700 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  বাংলা
                </button>
              </div>
            </div>

            {/* Clean App & Version Info */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-700" />
                <span>{isEn ? 'Version' : 'অ্যাপ সংস্করণ'}: <strong>v1.0.0 (Release)</strong></span>
              </div>
              <span className="text-slate-400">Offline-First Ledger</span>
            </div>
          </div>
        )}

        {/* Security / PIN Lock Tab */}
        {activeSubTab === 'security' && (
          <div className="space-y-4 pt-1">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-blue-700" />
                  <span className="font-bold text-slate-800">
                    {isEn ? '4-Digit App Lock PIN' : '৪-ডিজিট অ্যাপ লক পিন'}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={pinEnabled}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setShowPinSetup(true);
                    } else {
                      setPinEnabled(false);
                    }
                  }}
                  className="w-4 h-4 accent-blue-700"
                />
              </div>

              <p className="text-[11px] text-slate-500">
                {isEn
                  ? 'Require 4-digit PIN verification when opening the application.'
                  : 'অ্যাপ ওপেন করার সময় পিন বা বায়োমেট্রিক ভেরিফিকেশন দাবি করবে।'}
              </p>

              {showPinSetup && (
                <form onSubmit={handleSavePin} className="space-y-2.5 pt-2 border-t border-slate-200">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      {isEn ? 'New 4-Digit PIN' : 'নতুন ৪-ডিজিট পিন'}
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-center text-lg tracking-widest font-mono"
                      autoFocus
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      {isEn ? 'Confirm PIN' : 'পিন নিশ্চিত করুন'}
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-center text-lg tracking-widest font-mono"
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="flex-1 py-2 bg-blue-700 text-white rounded-xl font-bold"
                    >
                      {isEn ? 'Set PIN' : 'পিন সেট করুন'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPinSetup(false)}
                      className="px-3 py-2 text-slate-600 rounded-xl font-semibold hover:bg-slate-200"
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
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900">
              <span className="font-bold block mb-1">
                {isEn ? 'Privacy & Data Protection Commitment:' : 'গোপনীয়তা ও ডাটা সুরক্ষা অঙ্গীকার:'}
              </span>
              {isEn
                ? 'Hisab DekhteChai does not use any central proprietary backend or commercial cloud database. All your financial journals remain exclusively on your device and inside your own personal Google Drive (appDataFolder).'
                : 'হিসাব দেখতে চাই কোনো কেন্দ্রীয় ফিন্যান্স সার্ভার বা বাণিজ্যিক ক্লাউড ডাটাবেজ ব্যবহার করে না। আপনার সমস্ত হিসাব আপনার ফোনের নিজস্ব ডাটাবেজ এবং আপনার নিজস্ব Google Drive (appDataFolder) এ সংরক্ষিত থাকে।'}
            </div>

            <div className="space-y-1.5">
              <h4 className="font-bold text-slate-800 text-xs">
                {isEn ? 'What We Never Collect:' : 'আমরা যা সংগ্রহ করি না:'}
              </h4>
              <ul className="list-disc list-inside space-y-1 text-slate-500">
                <li>{isEn ? 'Bank or mobile wallet PINs/passwords' : 'আপনার ব্যাংক বা মোবাইল ব্যাংকিং পিন বা পাসওয়ার্ড'}</li>
                <li>{isEn ? 'Phone contacts or location telemetry' : 'আপনার ফোন নম্বর বা ব্যক্তিগত পরিচিতি'}</li>
                <li>{isEn ? 'Third-party tracking or advertising scripts' : 'কোনো থার্ড-পার্টি ট্র্যাকার বা বিজ্ঞাপনী ট্র্যাকিং'}</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <h4 className="font-bold text-slate-800 text-xs">
                {isEn ? 'Google Drive AppData Scope:' : 'গুগল ড্রাইভ অ্যাপ ডাটা ফোল্ডার:'}
              </h4>
              <p>
                {isEn
                  ? 'We use the minimal restricted drive.appdata scope. Files in this hidden sandbox are isolated from general Drive browsing and accessible only by this application.'
                  : 'আমরা ড্রাইভের সর্বনিম্ন অনুমোদিত পরিধি (drive.appdata) ব্যবহার করি। এই ফোল্ডারের ফাইল সাধারণ ড্রাইভ ব্রাউজারে দৃশ্যমান হয় না এবং কেবল এই অ্যাপই তা পড়তে পারে।'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
