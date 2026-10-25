import React from 'react';
import { useApp } from '../context/AppContext';
import {
  Wallet,
  ShieldCheck,
  Database,
  Cloud,
  X,
  Heart,
  ExternalLink,
} from 'lucide-react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const { language } = useApp();
  const isEn = language === 'en';

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-modal-title"
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200">
        <div className="bg-slate-900 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h2 id="about-modal-title" className="text-base font-bold tracking-tight">
                {isEn ? 'About Hisab DekhteChai' : 'হিসাব দেখতে চাই সম্পর্কে'}
              </h2>
              <p className="text-xs text-slate-400">
                {isEn ? 'Financial transparency & local-first accounting' : 'আর্থিক স্বচ্ছতা ও নিরাপদ হিসাব খাতা'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs text-slate-600">
          <div className="text-center space-y-1">
            <h3 className="text-lg font-bold text-slate-900">
              {isEn ? 'Hisab DekhteChai (হিসাব দেখতে চাই)' : 'হিসাব দেখতে চাই (Hisab DekhteChai)'}
            </h3>
            <p className="text-slate-500 font-medium">v1.0.0 (Production Stable)</p>
          </div>

          <div className="space-y-2.5">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3">
              <Database className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
              <div>
                <strong className="text-slate-800 block mb-0.5">
                  {isEn ? 'Offline-First SQLite Engine' : 'অফলাইন-ফার্স্ট এসকিউলাইট ইঞ্জিন'}
                </strong>
                <p className="text-slate-500">
                  {isEn
                    ? 'All transactions and journals reside locally on your device with crash-safe atomic commits.'
                    : 'সমস্ত হিসাব ও জার্নাল আপনার ডিভাইসে সুরক্ষিত থাকে। ইন্টারনেট ছাড়াই সম্পূর্ণ কার্যকর।'}
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3">
              <Cloud className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <strong className="text-slate-800 block mb-0.5">
                  {isEn ? 'Private Google Drive Sync' : 'ব্যক্তিগত গুগল ড্রাইভ সিঙ্ক'}
                </strong>
                <p className="text-slate-500">
                  {isEn
                    ? 'Automatic two-way synchronization exclusively via your own Google Drive AppData folder.'
                    : 'আপনার নিজস্ব গুগল ড্রাইভের মাধ্যমে ফোন এবং কম্পিউটারে স্বয়ংক্রিয় সিঙ্ক।'}
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3">
              <ShieldCheck className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
              <div>
                <strong className="text-slate-800 block mb-0.5">
                  {isEn ? 'Exact Integer Minor Units' : 'দ্বৈত-এন্ট্রি ও নির্ভুল হিসাব'}
                </strong>
                <p className="text-slate-500">
                  {isEn
                    ? 'Balanced double-entry bookkeeping with strict integer paisa arithmetic and zero rounding loss.'
                    : 'পয়সা ভিত্তিক পূর্ণসংখ্যা গণনা এবং পূর্ণাঙ্গ দ্বৈত-এন্ট্রি একাউন্টিং নীতিমালা।'}
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2 text-center text-slate-400 text-[11px] flex items-center justify-center gap-1">
            <span>Built with care for Bangladesh</span>
            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 min-h-[44px]"
          >
            {isEn ? 'Close' : 'বন্ধ করুন'}
          </button>
        </div>
      </div>
    </div>
  );
};
