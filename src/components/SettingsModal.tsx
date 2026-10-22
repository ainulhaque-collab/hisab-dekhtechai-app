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
  Cloud,
  Smartphone,
  ExternalLink
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
    currentDevice,
    db,
    refreshState,
    syncStatus,
  } = useApp();

  const [pinEnabled, setPinEnabled] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'privacy' | 'security'>('general');

  if (!isOpen) return null;

  const handleSavePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) {
      alert('পিন অবশ্যই ৪ ডিজিটের হতে হবে');
      return;
    }
    if (pin !== confirmPin) {
      alert('উভয় পিন এক হতে হবে');
      return;
    }
    setPinEnabled(true);
    setShowPinSetup(false);
    setPin('');
    setConfirmPin('');
    alert('অ্যাপ লক পিন সফলভাবে সক্রিয় করা হয়েছে');
  };

  const handleSignOut = () => {
    const pending = db.getPendingOutbox().length;
    if (pending > 0) {
      if (
        !confirm(
          `আপনার ডিভাইসে ${pending}টি আনসিঙ্কড লেনদেন রয়েছে। লগআউট করলে এই পরিবর্তনগুলো ক্লাউডে যাবে না। আপনি কি নিশ্চিত?`
        )
      ) {
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
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-700" />
            <h2 className="text-sm font-bold text-slate-800">সেটিংস ও নিরাপত্তা</h2>
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
            সাধারণ
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
            লক ও সুরক্ষা
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
            গোপনীয়তা
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
                  <span>গুগল অ্যাকাউন্ট ও ড্রাইভ সংযোগ</span>
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    userProfile?.isDriveAuthorized
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {userProfile?.isDriveAuthorized ? 'ড্রাইভ অনুমোদিত' : 'লগইন প্রয়োজন'}
                </span>
              </div>

              {userProfile ? (
                <div className="space-y-1 text-[11px] text-slate-600">
                  <div>নাম: <strong className="text-slate-800">{userProfile.displayName}</strong></div>
                  <div>ইমেইল: <strong className="text-slate-800">{userProfile.email}</strong></div>
                  <div className="font-mono text-[10px] text-slate-400 truncate">
                    Subject Hash: {userProfile.subjectHash.slice(0, 16)}...
                  </div>
                  <div className="pt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-semibold flex items-center gap-1"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>লগআউট করুন</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-[11px] text-slate-500 mb-2">
                    অন্য ডিভাইসের সাথে স্বয়ংক্রিয়ভাবে হিসাব মেলাতে আপনার গুগল একাউন্টে সাইন-ইন করুন:
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAuthModal();
                    }}
                    className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                  >
                    <span>গুগল দিয়ে প্রবেশ করুন (Continue with Google)</span>
                  </button>
                </div>
              )}
            </div>

            {/* Language Selection */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-slate-600" />
                <span className="font-bold text-slate-800">অ্যাপের ভাষা (Language)</span>
              </div>
              <div className="flex gap-1 bg-white p-0.5 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setLanguage('bn')}
                  className={`px-2.5 py-1 rounded text-xs font-bold ${
                    language === 'bn' ? 'bg-blue-700 text-white' : 'text-slate-600'
                  }`}
                >
                  বাংলা
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`px-2.5 py-1 rounded text-xs font-bold ${
                    language === 'en' ? 'bg-blue-700 text-white' : 'text-slate-600'
                  }`}
                >
                  English
                </button>
              </div>
            </div>

            {/* Google OAuth & SHA-1 Credentials Helper */}
            <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-200 text-[11px] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-blue-900">Google Cloud Android Client তথ্য:</span>
                <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-mono font-semibold">
                  Debug SHA-1
                </span>
              </div>
              <div>
                <span className="text-slate-500">Package Name:</span>
                <div className="font-mono font-bold text-slate-800 select-all">com.hisabdekhtechai.app</div>
              </div>
              <div>
                <span className="text-slate-500">SHA-1 Certificate Fingerprint:</span>
                <div className="font-mono text-[10px] font-bold text-blue-700 break-all select-all bg-white p-1.5 rounded border border-blue-200">
                  2C:E9:7A:05:D9:98:B6:6B:47:A8:E6:CF:93:BA:DE:40:BC:70:98:6B
                </div>
              </div>
            </div>

            {/* App & Device Info */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-500 space-y-1">
              <div>অ্যাপ সংস্করণ: <strong>v1.0.0 (Release-Ready)</strong></div>
              <div>টার্গেট অ্যান্ড্রয়েড SDK: <strong>Android 16 (API 36)</strong></div>
              <div>প্যাকেজ আইডি: <strong className="font-mono">com.hisabdekhtechai.app</strong></div>
              <div>বর্তমান ডিভাইস: {currentDevice.name}</div>
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
                  <span className="font-bold text-slate-800">৪-ডিজিট অ্যাপ লক পিন</span>
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
                অ্যাপ ওপেন করার সময় পিন বা বায়োমেট্রিক ভেরিফিকেশন দাবি করবে।
              </p>

              {showPinSetup && (
                <form onSubmit={handleSavePin} className="space-y-2.5 pt-2 border-t border-slate-200">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">নতুন ৪-ডিজিট পিন</label>
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
                    <label className="block text-slate-700 font-semibold mb-1">পিন নিশ্চিত করুন</label>
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
                      পিন সেট করুন
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPinSetup(false)}
                      className="px-3 py-2 text-slate-600 rounded-xl font-semibold"
                    >
                      বাতিল
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
              <span className="font-bold block mb-1">গোপনীয়তা ও ডাটা সুরক্ষা অঙ্গীকার:</span>
              হিসাব দেখতে চাই কোনো কেন্দ্রীয় ফিন্যান্স সার্ভার বা বাণিজ্যিক ক্লাউড ডাটাবেজ ব্যবহার করে
              না। আপনার সমস্ত হিসাব আপনার ফোনের নিজস্ব SQLite ডাটাবেজ এবং আপনার নিজস্ব Google Drive
              (appDataFolder) এ সংরক্ষিত থাকে।
            </div>

            <div className="space-y-2">
              <h4 className="font-bold text-slate-800 text-xs">আমরা যা সংগ্রহ করি না:</h4>
              <ul className="list-disc list-inside space-y-1 text-slate-500">
                <li>আপনার ব্যাংক বা মোবাইল ব্যাংকিং পিন বা পাসওয়ার্ড</li>
                <li>আপনার ফোন নম্বর বা ব্যক্তিগত পরিচিতি</li>
                <li>কোনো থার্ড-পার্টি ট্র্যাকার বা বিজ্ঞাপনী ট্র্যাকিং</li>
              </ul>
            </div>

            <div className="space-y-2">
              <h4 className="font-bold text-slate-800 text-xs">গুগল ড্রাইভ অ্যাপ ডাটা ফোল্ডার:</h4>
              <p>
                আমরা ড্রাইভের সর্বনিম্ন অনুমোদিত পরিধি (
                <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">
                  drive.appdata
                </code>
                ) ব্যবহার করি। এই ফোল্ডারের ফাইল সাধারণ ড্রাইভ ব্রাউজারে দৃশ্যমান হয় না এবং কেবল এই
                অ্যাপই তা পড়তে পারে।
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
