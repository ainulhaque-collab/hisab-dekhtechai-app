import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Wallet, ShieldCheck, Cloud, Check, X, ArrowRight } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { auth, refreshState, triggerManualSync, isOnline } = useApp();
  const [step, setStep] = useState<'welcome' | 'accounts' | 'consent'>('welcome');
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [consentGranted, setConsentGranted] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  if (!isOpen) return null;

  const testGoogleAccounts = [
    { name: 'Ainul Haque', email: 'ainulshalkhuria@gmail.com' },
    { name: 'হিসাব মালিক (ব্যবসায়ী)', email: 'hisab.owner@gmail.com' },
  ];

  const handleSelectAccount = (acc: { name: string; email: string }) => {
    setSelectedName(acc.name);
    setSelectedEmail(acc.email);
    setStep('consent');
  };

  const handleRealGoogleLogin = async () => {
    setIsLoading(true);
    setLoginError(null);
    try {
      await auth.promptGoogleSignIn();
      refreshState();
      if (isOnline) {
        triggerManualSync().catch(console.error);
      }
      setIsLoading(false);
      onClose();
    } catch (err: any) {
      console.warn('Real Google popup cancelled or failed:', err);
      setIsLoading(false);
      const msg = err?.message || String(err);
      if (msg.includes('invalid_client')) {
        setLoginError('গুগল ক্লায়েন্ট আইডি প্রোপাগেশন প্রক্রিয়াধীন (৫-১০ মিনিট সময় লাগতে পারে)। নিচের ডেমো বিকল্প দিয়ে তাৎক্ষণিক পরীক্ষা করতে পারেন।');
      } else if (msg.includes('popup_closed') || msg.includes('cancel')) {
        setLoginError('গুগল সাইন-ইন পপআপ বন্ধ করা হয়েছে। আবার চেষ্টা করুন।');
      } else {
        setLoginError(`গুগল লগইন ত্রুটি: ${msg}`);
      }
    }
  };

  const handleFinishSignIn = async () => {
    if (!selectedEmail) return;
    setIsLoading(true);
    setLoginError(null);

    try {
      await auth.setTestProfileForTesting(selectedEmail, selectedName, consentGranted ? 'demo-test-token' : undefined);
      refreshState();
      if (isOnline) {
        triggerManualSync().catch(console.error);
      }
      setIsLoading(false);
      onClose();
    } catch (err: any) {
      setLoginError(`সাইন-ইন ব্যর্থ: ${err.message}`);
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 text-xs animate-in zoom-in-95">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-slate-100 text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step 1: Welcome */}
        {step === 'welcome' && (
          <div className="text-center space-y-4 pt-1">
            <div className="w-16 h-16 rounded-2xl bg-blue-700 text-white flex items-center justify-center mx-auto shadow-lg shadow-blue-700/25">
              <Wallet className="w-8 h-8" strokeWidth={2} />
            </div>

            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">হিসাব দেখতে চাই</h2>
              <p className="text-xs text-blue-700 font-medium mt-0.5">আপনার সব হিসাব, এক জায়গায়।</p>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed px-2">
              অফলাইন-ফার্স্ট ব্যক্তিগত ও ব্যবসায়িক আর্থিক খাতা। কোনো কেন্দ্রীয় সার্ভার ছাড়াই আপনার
              নিজস্ব Google Drive-এ স্বয়ংক্রিয়ভাবে হিসাব সিঙ্ক হয়।
            </p>

            {loginError && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 text-left space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                  <span>লগইন স্ট্যাটাস বার্তা</span>
                </div>
                <div>{loginError}</div>
              </div>
            )}

            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={handleRealGoogleLogin}
                disabled={isLoading}
                className="w-full py-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl font-bold flex items-center justify-center gap-3 shadow-xs transition-all disabled:opacity-50"
              >
                {/* Google Icon */}
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>{isLoading ? 'সংযোগ হচ্ছে...' : 'Continue with Google'}</span>
              </button>

              <button
                type="button"
                onClick={() => setStep('accounts')}
                className="w-full py-2 text-slate-500 hover:text-slate-800 text-[11px] font-semibold"
              >
                অথবা ডেমো একাউন্ট দিয়ে পরীক্ষা করুন
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Choose Google Account */}
        {step === 'accounts' && (
          <div className="space-y-4 pt-1">
            <div className="text-center">
              <h2 className="text-sm font-bold text-slate-800">গুগল একাউন্ট নির্বাচন করুন</h2>
              <p className="text-[11px] text-slate-500">
                এই একাউন্টের ড্রাইভেই আপনার সমস্ত ডিভাইস সিঙ্ক হবে
              </p>
            </div>

            <div className="space-y-2">
              {testGoogleAccounts.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => handleSelectAccount(acc)}
                  className="w-full p-3 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 flex items-center justify-between text-left transition-all"
                >
                  <div>
                    <div className="font-bold text-slate-900">{acc.name}</div>
                    <div className="text-[11px] text-slate-500">{acc.email}</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Google Drive Permission Consent */}
        {step === 'consent' && (
          <div className="space-y-4 pt-1">
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center mx-auto mb-2">
                <Cloud className="w-6 h-6" />
              </div>
              <h2 className="text-sm font-bold text-slate-800">গুগল ড্রাইভ অ্যাপ ডাটা অনুমতি</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">{selectedEmail}</p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] space-y-2 text-slate-600">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  <strong>লুকানো অ্যাপ স্টোরেজ (appDataFolder):</strong> আপনার সাধারণ ফাইলগুলো দেখা বা
                  পরিবর্তন করা হবে না। কেবল এই অ্যাপের নিজস্ব সিঙ্ক ফাইল সংরক্ষিত হবে।
                </span>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer p-1">
              <input
                type="checkbox"
                checked={consentGranted}
                onChange={(e) => setConsentGranted(e.target.checked)}
                className="w-4 h-4 accent-blue-700 rounded"
              />
              <span className="text-xs text-slate-700 font-medium">
                আমি গুগল ড্রাইভে ব্যাকআপ ও সিঙ্ক সংরক্ষণের অনুমতি দিচ্ছি
              </span>
            </label>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={handleFinishSignIn}
                disabled={isLoading}
                className="flex-1 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>{isLoading ? 'অনুমোদিত হচ্ছে...' : 'অনুমোদন ও শুরু করুন'}</span>
              </button>
              <button
                type="button"
                onClick={() => setStep('welcome')}
                className="px-3 py-2.5 text-slate-600 rounded-xl font-semibold"
              >
                ফিরে যান
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
