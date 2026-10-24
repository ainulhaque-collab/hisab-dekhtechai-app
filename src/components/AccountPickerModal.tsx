import React, { useState, useEffect, useRef } from 'react';
import { Account, AccountKind } from '../contracts/types';
import { formatBDT } from '../domain/money';
import {
  Wallet,
  Landmark,
  Smartphone,
  CreditCard,
  Plus,
  Check,
  Search,
  X,
  AlertCircle
} from 'lucide-react';

interface AccountPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: Account[];
  selectedAccountId: string;
  onSelectAccount: (accountId: string) => void;
  title?: string;
  excludeAccountId?: string;
  onAddNewAccount?: () => void;
  language?: 'bn' | 'en';
  getBalance?: (accountId: string) => string;
}

export const AccountPickerModal: React.FC<AccountPickerModalProps> = ({
  isOpen,
  onClose,
  accounts,
  selectedAccountId,
  onSelectAccount,
  title,
  excludeAccountId,
  onAddNewAccount,
  language = 'en',
  getBalance,
}) => {
  const isEn = language === 'en';
  const [searchQuery, setSearchQuery] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on Android hardware Back or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Focus search when opened
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Filter out archived accounts and excluded account (e.g. source account in transfer)
  const activeAccounts = accounts.filter(
    (a) => !a.archivedAt && (!excludeAccountId || a.id !== excludeAccountId)
  );

  const filteredAccounts = activeAccounts.filter((a) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const nameMatch = a.name.toLowerCase().includes(query);
    const numMatch = a.accountNumberMasked?.toLowerCase().includes(query);
    const kindMatch = a.kind.toLowerCase().includes(query);
    return nameMatch || numMatch || kindMatch;
  });

  const getAccountIcon = (kind: AccountKind) => {
    switch (kind) {
      case 'cash':
        return Wallet;
      case 'bank':
        return Landmark;
      case 'bkash':
      case 'nagad':
      case 'rocket':
        return Smartphone;
      default:
        return CreditCard;
    }
  };

  const getKindLabel = (kind: AccountKind) => {
    switch (kind) {
      case 'cash':
        return isEn ? 'Cash' : 'ক্যাশ';
      case 'bank':
        return isEn ? 'Bank' : 'ব্যাংক';
      case 'bkash':
        return 'bKash';
      case 'nagad':
        return 'Nagad';
      case 'rocket':
        return 'Rocket';
      default:
        return isEn ? 'Wallet' : 'ওয়ালেট';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title || (isEn ? 'Select Account' : 'অ্যাকাউন্ট নির্বাচন করুন')}
    >
      <div
        ref={modalRef}
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-xl flex flex-col max-h-[85vh] sm:max-h-[80vh] overflow-hidden animate-in slide-in-from-bottom duration-200"
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center font-bold">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {title || (isEn ? 'Select Account / Wallet' : 'অ্যাকাউন্ট / ওয়ালেট নির্বাচন করুন')}
              </h2>
              <p className="text-[11px] text-slate-500">
                {isEn
                  ? `${activeAccounts.length} available accounts`
                  : `${activeAccounts.length}টি অ্যাকাউন্ট উপলব্ধ`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Input (shown when accounts > 3) */}
        {activeAccounts.length > 3 && (
          <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-100">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={isEn ? 'Search account name or number...' : 'অ্যাকাউন্টের নাম বা নম্বর খুঁজুন...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Accounts List */}
        <div className="p-3 overflow-y-auto space-y-1.5 flex-1 divide-y divide-slate-100/60">
          {filteredAccounts.length === 0 ? (
            <div className="py-8 text-center px-4">
              <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2">
                <AlertCircle className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-slate-700">
                {activeAccounts.length === 0
                  ? isEn
                    ? 'No accounts found in this workspace'
                    : 'এই খাতায় কোনো অ্যাকাউন্ট নেই'
                  : isEn
                  ? 'No matching accounts found'
                  : 'কোনো মিল পাওয়া যায়নি'}
              </p>
              {onAddNewAccount && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onAddNewAccount();
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Add New Account' : 'নতুন অ্যাকাউন্ট তৈরি করুন'}</span>
                </button>
              )}
            </div>
          ) : (
            filteredAccounts.map((acc) => {
              const Icon = getAccountIcon(acc.kind);
              const isSelected = acc.id === selectedAccountId;
              const balanceMinor = getBalance ? getBalance(acc.id) : acc.openingBalanceMinor;

              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => {
                    onSelectAccount(acc.id);
                    onClose();
                  }}
                  className={`w-full text-left p-3 rounded-xl flex items-center justify-between transition-all pt-2.5 ${
                    isSelected
                      ? 'bg-blue-50/90 border border-blue-300/80 shadow-2xs'
                      : 'hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-900 truncate">
                          {acc.name}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">
                          {getKindLabel(acc.kind)}
                        </span>
                      </div>
                      {acc.accountNumberMasked && (
                        <p className="text-[10px] text-slate-400 font-mono">
                          {acc.accountNumberMasked}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 ml-2">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block font-medium">
                        {isEn ? 'Balance' : 'ব্যালেন্স'}
                      </span>
                      <span className="text-xs font-bold text-slate-900 tabular-nums">
                        {formatBDT(balanceMinor, { locale: language, showDecimals: true })}
                      </span>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'border border-slate-300 text-transparent'
                      }`}
                    >
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer with Add Account action */}
        {onAddNewAccount && (
          <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between pb-safe">
            <span className="text-[11px] text-slate-500 font-medium">
              {isEn ? 'Need another wallet?' : 'অন্য অ্যাকাউন্ট দরকার?'}
            </span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onAddNewAccount();
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-blue-700 hover:text-blue-900 hover:bg-blue-50/80 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isEn ? 'Create Account' : 'অ্যাকাউন্ট যোগ করুন'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
