import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatBDT, parsePaisaString, normalizeNumericAmountInput, formatAccountTitle } from '../domain/money';
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

  const isEn = language === 'en';

  return (
    <div className="space-y-4 pb-24 animate-in fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-slate-900 tracking-tight">
            {isEn ? 'Accounts & Wallets' : 'অ্যাকাউন্ট ও ওয়ালেট'}
          </h1>
          <p className="text-xs text-slate-500">
            {isEn ? `All accounts in ${formatAccountTitle(currentWorkspace.name, 'en')}` : `${formatAccountTitle(currentWorkspace.name, 'bn')} খাতার হিসাব`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{isEn ? 'New Account' : 'নতুন অ্যাকাউন্ট'}</span>
        </button>
      </div>

      <div className="space-y-3">
        {dashboardData.accountSummaries.map((acc) => {
          const formattedName = formatAccountTitle(acc.name, language);
          return (
            <div
              key={acc.accountId}
              className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                    {getAccountIcon(acc.kind)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{formattedName}</h3>
                    <span className="text-[10px] text-slate-400 uppercase font-mono font-medium">
                      {acc.kind}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-bold text-slate-900 tabular-nums">
                    {formatBDT(acc.currentBalanceMinor, { locale: language })}
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium">
                    {isEn ? 'Current Balance' : 'বর্তমান ব্যালেন্স'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-100 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400">
                    {isEn ? 'Opening' : 'প্রারম্ভিক'}
                  </span>
                  <div className="font-semibold text-slate-700 tabular-nums">
                    {formatBDT(acc.openingBalanceMinor, { locale: language, showDecimals: false })}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-0.5 text-emerald-600 text-[10px]">
                    <ArrowDownLeft className="w-2.5 h-2.5" />
                    <span>{isEn ? 'Total In' : 'মোট জমা'}</span>
                  </div>
                  <div className="font-semibold text-slate-700 tabular-nums">
                    {formatBDT(acc.totalDebitsMinor, { locale: language, showDecimals: false })}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-0.5 text-rose-600 text-[10px]">
                    <ArrowUpRight className="w-2.5 h-2.5" />
                    <span>{isEn ? 'Total Out' : 'মোট খরচ'}</span>
                  </div>
                  <div className="font-semibold text-slate-700 tabular-nums">
                    {formatBDT(acc.totalCreditsMinor, { locale: language, showDecimals: false })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">
                {isEn ? 'Add Account' : 'নতুন অ্যাকাউন্ট যোগ করুন'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Account Name' : 'অ্যাকাউন্টের নাম'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? 'e.g. City Bank Savings' : 'যেমন: সিটি ব্যাংক'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Account Type' : 'অ্যাকাউন্টের ধরণ'}
                </label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AccountKind)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="cash">{isEn ? 'Cash' : 'নগদ ক্যাশ'}</option>
                  <option value="bank">{isEn ? 'Bank Account' : 'ব্যাংক হিসাব'}</option>
                  <option value="bkash">{isEn ? 'bKash' : 'বিকাশ'}</option>
                  <option value="nagad">{isEn ? 'Nagad' : 'নগদ'}</option>
                  <option value="rocket">{isEn ? 'Rocket' : 'রকেট'}</option>
                  <option value="other">{isEn ? 'Other' : 'অন্যান্য'}</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Opening Balance (Optional)' : 'প্রারম্ভিক ব্যালেন্স (ঐচ্ছিক)'}
                </label>
                <input
                  type="text"
                  placeholder="0.00"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(normalizeNumericAmountInput(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono tabular-nums"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Account Number (Optional)' : 'হিসাব নম্বর / শেষ ৪ ডিজিট (ঐচ্ছিক)'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? 'e.g. ****4567' : 'যেমন: ****4567'}
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold shadow-xs transition-colors"
                >
                  {isEn ? 'Save Account' : 'সংরক্ষণ করুন'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
