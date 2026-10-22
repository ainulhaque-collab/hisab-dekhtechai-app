import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatBDT } from '../domain/money';
import {
  TrendingUp,
  TrendingDown,
  ArrowRightLeft,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Receipt,
  Building,
  Smartphone,
  Banknote,
  PieChart
} from 'lucide-react';
import { JournalTransaction } from '../contracts/types';

interface DashboardTabProps {
  onNavigateToAdd: () => void;
  onNavigateToHistory: () => void;
  onSelectTransaction: (tx: JournalTransaction) => void;
  onOpenSyncModal: () => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  onNavigateToAdd,
  onNavigateToHistory,
  onSelectTransaction,
  onOpenSyncModal,
}) => {
  const { dashboardData, currentWorkspace, language, syncStatus, isOnline, triggerManualSync } =
    useApp();
  const [showBalance, setShowBalance] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  if (!dashboardData) {
    return (
      <div className="p-6 text-center text-slate-500">
        লোডিং হচ্ছে... (Loading dashboard data...)
      </div>
    );
  }

  const handleSyncClick = async () => {
    setIsSyncing(true);
    await triggerManualSync();
    setIsSyncing(false);
  };

  const getAccountIcon = (kind: string) => {
    switch (kind) {
      case 'bkash':
      case 'nagad':
      case 'rocket':
        return <Smartphone className="w-4 h-4 text-pink-600" />;
      case 'bank':
        return <Building className="w-4 h-4 text-blue-600" />;
      case 'cash':
      default:
        return <Banknote className="w-4 h-4 text-emerald-600" />;
    }
  };

  return (
    <div className="space-y-4 pb-20 animate-in fade-in">
      {/* Sync Alert Banner if pending or offline */}
      {(!isOnline || syncStatus.pendingOutboxCount > 0 || syncStatus.state === 'conflict') && (
        <div
          onClick={onOpenSyncModal}
          className="cursor-pointer p-3 rounded-xl border flex items-center justify-between text-xs transition-all shadow-sm bg-amber-50/80 border-amber-200 text-amber-900 hover:bg-amber-100"
        >
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-700 shrink-0" />
            <div>
              <span className="font-semibold">
                {!isOnline
                  ? 'অফলাইন মোড: লেনদেন স্থানীয়ভাবে নিরাপদে সংরক্ষিত'
                  : syncStatus.state === 'conflict'
                  ? 'সংঘাত পর্যালোচনা প্রয়োজন (Conflict review needed)'
                  : `${syncStatus.pendingOutboxCount}টি নতুন লেনদেন ড্রাইভে সিঙ্ক অপেক্ষায়`}
              </span>
              <p className="text-[11px] text-amber-700">
                {!isOnline
                  ? 'ইন্টারনেট পেলে স্বয়ংক্রিয়ভাবে ড্রাইভে সিঙ্ক হবে।'
                  : 'গুগল ড্রাইভ স্ট্যাটাস দেখতে ট্যাপ করুন।'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSyncClick();
            }}
            disabled={!isOnline || isSyncing}
            className="px-2.5 py-1 bg-amber-700 text-white rounded-lg font-medium text-[11px] flex items-center gap-1 hover:bg-amber-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>সিঙ্ক</span>
          </button>
        </div>
      )}

      {/* Primary Balance Card (Minimal Deep Blue) */}
      <div className="bg-gradient-to-br from-blue-700 via-blue-800 to-indigo-900 rounded-2xl p-5 text-white shadow-lg shadow-blue-700/20 relative overflow-hidden">
        {/* Background geometric accents */}
        <div className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute right-12 -bottom-10 w-28 h-28 rounded-full bg-white/5 pointer-events-none" />

        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-blue-200 text-xs font-medium">
            <span>{currentWorkspace?.name} • সর্বমোট ব্যালেন্স</span>
            <button
              type="button"
              onClick={() => setShowBalance(!showBalance)}
              className="p-1 hover:bg-white/10 rounded-full transition-colors"
              aria-label={showBalance ? 'Hide balance' : 'Show balance'}
            >
              {showBalance ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/15 text-white font-medium">
            BDT (৳)
          </span>
        </div>

        <div className="text-3xl font-bold tracking-tight mb-4 tabular-nums">
          {showBalance
            ? formatBDT(dashboardData.totalConsolidatedBalanceMinor, { locale: language })
            : '৳ ••••••••'}
        </div>

        {/* Month Summary Bar */}
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/15 text-xs">
          <div>
            <div className="flex items-center gap-1 text-emerald-300 text-[11px] font-medium">
              <TrendingUp className="w-3 h-3" />
              <span>এই মাসে আয়</span>
            </div>
            <div className="font-semibold text-white mt-0.5 tabular-nums">
              {showBalance
                ? formatBDT(dashboardData.totalIncomeThisMonthMinor, {
                    locale: language,
                    showDecimals: false,
                  })
                : '••••'}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1 text-rose-300 text-[11px] font-medium">
              <TrendingDown className="w-3 h-3" />
              <span>এই মাসে খরচ</span>
            </div>
            <div className="font-semibold text-white mt-0.5 tabular-nums">
              {showBalance
                ? formatBDT(dashboardData.totalExpenseThisMonthMinor, {
                    locale: language,
                    showDecimals: false,
                  })
                : '••••'}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1 text-blue-200 text-[11px] font-medium">
              <ArrowRightLeft className="w-3 h-3" />
              <span>নেট প্রবৃদ্ধি</span>
            </div>
            <div className="font-semibold text-white mt-0.5 tabular-nums">
              {showBalance
                ? formatBDT(dashboardData.netFlowThisMonthMinor, {
                    locale: language,
                    showDecimals: false,
                    showSign: true,
                  })
                : '••••'}
            </div>
          </div>
        </div>
      </div>

      {/* Asset Accounts Grid */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-sm font-bold text-slate-800 tracking-tight">
            অ্যাকাউন্ট ও ওয়ালেট ({dashboardData.accountSummaries.length})
          </h2>
          <span className="text-xs text-blue-700 font-medium">সর্বশেষ স্থিতি</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {dashboardData.accountSummaries.map((acc) => (
            <div
              key={acc.accountId}
              className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs hover:border-blue-300 transition-colors"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="p-1 rounded-lg bg-slate-50 border border-slate-100">
                  {getAccountIcon(acc.kind)}
                </span>
                <span className="text-[10px] text-slate-400 font-medium uppercase">
                  {acc.kind}
                </span>
              </div>
              <div className="text-xs font-semibold text-slate-800 truncate mb-1" title={acc.name}>
                {acc.name}
              </div>
              <div className="text-sm font-bold text-blue-700 tabular-nums">
                {showBalance
                  ? formatBDT(acc.currentBalanceMinor, { locale: language })
                  : '৳ ••••••'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top Expense Categories */}
      {dashboardData.topExpenseCategories.length > 0 && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
              <PieChart className="w-4 h-4 text-blue-700" />
              <span>শীর্ষ খরচ খাত (এই মাসে)</span>
            </div>
            <span className="text-xs text-slate-500 font-medium">শতাংশ</span>
          </div>

          <div className="space-y-2.5">
            {dashboardData.topExpenseCategories.map((cat) => (
              <div key={cat.categoryId} className="text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-slate-700">{cat.name}</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {formatBDT(cat.amountMinor, { locale: language, showDecimals: false })} (
                    {cat.percentage}%)
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Transactions List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">সাম্প্রতিক লেনদেন</h2>
          <button
            type="button"
            onClick={onNavigateToHistory}
            className="text-xs text-blue-700 font-semibold flex items-center gap-0.5 hover:underline"
          >
            <span>সব দেখুন</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {dashboardData.recentTransactions.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center mx-auto mb-2">
              <Receipt className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-slate-700 mb-1">এখনও কোনো লেনদেন লিপিবদ্ধ হয়নি</p>
            <p className="text-xs text-slate-400 mb-3">
              নিচের যোগ বাটনে ট্যাপ করে নতুন আয় বা খরচ যোগ করুন।
            </p>
            <button
              type="button"
              onClick={onNavigateToAdd}
              className="px-3.5 py-1.5 bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm hover:bg-blue-800"
            >
              + লেনদেন যোগ করুন
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {dashboardData.recentTransactions.slice(0, 8).map((tx) => {
              const isIncome = tx.transactionType === 'income';
              const isExpense = tx.transactionType === 'expense';
              const isTransfer = tx.transactionType === 'transfer';
              const isReversal =
                tx.transactionType === 'reversal' || tx.transactionType === 'correction';

              // Extract nominal amount from journal lines
              let displayAmount = '0';
              if (isIncome) {
                const line = tx.lines.find((l) => l.debitMinor !== '0');
                displayAmount = line ? line.debitMinor : '0';
              } else if (isExpense) {
                const line = tx.lines.find((l) => l.creditMinor !== '0');
                displayAmount = line ? line.creditMinor : '0';
              } else if (isTransfer) {
                const line = tx.lines.find((l) => l.creditMinor !== '0');
                displayAmount = line ? line.creditMinor : '0';
              }

              return (
                <div
                  key={tx.id}
                  onClick={() => onSelectTransaction(tx)}
                  className="p-3 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isIncome
                          ? 'bg-emerald-50 text-emerald-700'
                          : isExpense
                          ? 'bg-rose-50 text-rose-700'
                          : isTransfer
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-purple-50 text-purple-700'
                      }`}
                    >
                      {isIncome ? (
                        <TrendingUp className="w-4 h-4" />
                      ) : isExpense ? (
                        <TrendingDown className="w-4 h-4" />
                      ) : isTransfer ? (
                        <ArrowRightLeft className="w-4 h-4" />
                      ) : (
                        <AlertCircle className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-800 line-clamp-1">
                        {tx.note ||
                          (isIncome
                            ? 'আয়'
                            : isExpense
                            ? 'দৈনন্দিন খরচ'
                            : isTransfer
                            ? 'অ্যাকাউন্ট স্থানান্তর'
                            : 'সংশোধনী এন্ট্রি')}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {tx.effectiveDate}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div
                      className={`text-xs font-bold tabular-nums ${
                        isIncome
                          ? 'text-emerald-700'
                          : isExpense
                          ? 'text-slate-900'
                          : 'text-blue-700'
                      }`}
                    >
                      {isIncome ? '+' : isExpense ? '-' : ''}
                      {formatBDT(displayAmount, { locale: language })}
                    </div>
                    {tx.receiptBlobSha256 && (
                      <span className="text-[10px] text-blue-600 flex items-center justify-end gap-0.5 mt-0.5">
                        <Receipt className="w-2.5 h-2.5" />
                        <span>রসিদ</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
