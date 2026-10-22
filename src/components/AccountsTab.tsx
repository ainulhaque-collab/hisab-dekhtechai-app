import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatBDT, parsePaisaString } from '../domain/money';
import {
  Banknote,
  Building,
  Smartphone,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  CreditCard
} from 'lucide-react';
import { AccountKind } from '../contracts/types';

export const AccountsTab: React.FC = () => {
  const { dashboardData, currentWorkspace, language, db, refreshState } = useApp();
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('cash');
  const [openingBalance, setOpeningBalance] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  if (!dashboardData || !currentWorkspace) return null;

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let openingMinor = '0';
    if (openingBalance) {
      try {
        openingMinor = parsePaisaString(openingBalance).toString();
      } catch {
        openingMinor = '0';
      }
    }

    db.createAccount(currentWorkspace.id, name.trim(), kind, openingMinor, accountNumber.trim());
    refreshState();
    setName('');
    setOpeningBalance('');
    setAccountNumber('');
    setShowAddModal(false);
  };

  const getAccountIcon = (k: AccountKind) => {
    switch (k) {
      case 'bkash':
      case 'nagad':
      case 'rocket':
        return <Smartphone className="w-5 h-5 text-pink-600" />;
      case 'bank':
        return <Building className="w-5 h-5 text-blue-600" />;
      case 'cash':
      default:
        return <Banknote className="w-5 h-5 text-emerald-600" />;
    }
  };

  return (
    <div className="space-y-4 pb-24 animate-in fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-slate-800 tracking-tight">
            অ্যাকাউন্ট ও ওয়ালেট তালিকা
          </h1>
          <p className="text-xs text-slate-500">
            {currentWorkspace.name} খাতার সকল হিসাবের স্থিতি
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>নতুন অ্যাকাউন্ট</span>
        </button>
      </div>

      <div className="space-y-3">
        {dashboardData.accountSummaries.map((acc) => (
          <div
            key={acc.accountId}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition-colors"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                  {getAccountIcon(acc.kind)}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{acc.name}</h3>
                  <span className="text-[11px] text-slate-500 uppercase font-medium">
                    {acc.kind}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-base font-bold text-blue-700 tabular-nums">
                  {formatBDT(acc.currentBalanceMinor, { locale: language })}
                </div>
                <div className="text-[10px] text-slate-400 font-medium">বর্তমান ব্যালেন্স</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-100 text-xs">
              <div>
                <span className="text-[10px] text-slate-400">প্রারম্ভিক (Opening)</span>
                <div className="font-semibold text-slate-700 tabular-nums">
                  {formatBDT(acc.openingBalanceMinor, { locale: language, showDecimals: false })}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-0.5 text-emerald-600 text-[10px]">
                  <ArrowDownLeft className="w-2.5 h-2.5" />
                  <span>মোট আগমন (In)</span>
                </div>
                <div className="font-semibold text-slate-700 tabular-nums">
                  {formatBDT(acc.totalDebitsMinor, { locale: language, showDecimals: false })}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-0.5 text-rose-600 text-[10px]">
                  <ArrowUpRight className="w-2.5 h-2.5" />
                  <span>মোট বহির্গমন (Out)</span>
                </div>
                <div className="font-semibold text-slate-700 tabular-nums">
                  {formatBDT(acc.totalCreditsMinor, { locale: language, showDecimals: false })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">নতুন অ্যাকাউন্ট যোগ করুন</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">অ্যাকাউন্টের নাম</label>
                <input
                  type="text"
                  placeholder="যেমন: সিটি ব্যাংক সেভিংস"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">অ্যাকাউন্টের ধরণ</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AccountKind)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="cash">নগদ ক্যাশ (Cash)</option>
                  <option value="bank">ব্যাংক হিসাব (Bank Account)</option>
                  <option value="bkash">বিকাশ (bKash)</option>
                  <option value="nagad">নগদ (Nagad)</option>
                  <option value="rocket">রকেট (Rocket)</option>
                  <option value="other">অন্যান্য (Other)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  প্রারম্ভিক ব্যালেন্স (Opening Balance ৳)
                </label>
                <input
                  type="text"
                  placeholder="0.00"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  হিসাব নম্বর / শেষ ৪ ডিজিট (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  placeholder="যেমন: ****4567"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold shadow-sm"
                >
                  সংরক্ষণ করুন
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
                >
                  বাতিল
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
