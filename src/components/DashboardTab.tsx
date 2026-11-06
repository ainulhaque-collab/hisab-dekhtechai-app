import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatBDT, formatAccountTitle } from '../domain/money';
import { getT } from '../locales/i18n';
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
  Target
} from 'lucide-react';
import { JournalTransaction } from '../contracts/types';
import { Users, UserPlus } from 'lucide-react';
import { DashboardCharts } from './DashboardCharts';
import {walletFeatureEnabled} from './walletText';
import {personalWalletHome} from '../storage/walletBook';

interface DashboardTabProps {
  onNavigateToAdd: () => void;
  onNavigateToHistory: () => void;
  onSelectTransaction: (tx: JournalTransaction) => void;
  onOpenSyncModal: () => void;
  onOpenPartiesModal?: () => void;
  onOpenSavingsGoals?: () => void;
  onOpenAllWallets?:()=>void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  onNavigateToAdd,
  onNavigateToHistory,
  onSelectTransaction,
  onOpenSyncModal,
  onOpenPartiesModal,
  onOpenSavingsGoals,
  onOpenAllWallets,
}) => {
  const { db, dashboardData, currentWorkspace, parties, language, syncStatus, isOnline, triggerManualSync } =
    useApp();
  const [showBalance, setShowBalance] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const t = getT(language);
  const savings = useMemo(() => {
    if (!currentWorkspace || !dashboardData) return null;
    try { return db.getSavingsProjection(currentWorkspace.id); } catch { return null; }
  }, [db, currentWorkspace?.id, dashboardData]);
  const activeGoals = savings?.goals.filter(item => !item.deleted && !item.goal.archived) || [];
  const savedMinor = activeGoals.reduce((total, item) => total + BigInt(item.fundedMinor), 0n);
  const shortfall = activeGoals.some(item => BigInt(item.shortfallMinor) > 0n);
  const activeAccountIds=useMemo(()=>new Set(currentWorkspace?db.getAccounts(currentWorkspace.id).map(a=>a.id):[]),[db,currentWorkspace?.id,dashboardData]);
  const spendableMinor=savings?.accounts.reduce((total,a)=>total+(activeAccountIds.has(a.accountId)?BigInt(a.availableMinor):0n),0n).toString();
  const reservedMinor=savings?.accounts.reduce((total,a)=>total+BigInt(a.allocatedMinor),0n).toString()||'0';
  const localFinanceOnly=import.meta.env.VITE_SUPABASE_AUTH_ENABLED==='true';

  if (!dashboardData) {
    return (
      <div className="p-6 text-center text-slate-500">
        {language === 'en' ? 'Loading dashboard data...' : 'লোডিং হচ্ছে...'}
      </div>
    );
  }

  const handleSyncClick = async () => {
    setIsSyncing(true);
    try { await triggerManualSync(); }
    catch { onOpenSyncModal(); }
    finally { setIsSyncing(false); }
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
      {walletFeatureEnabled&&currentWorkspace?.id===personalWalletHome(db.getRawState().workspaces.values(),db.getIdentity()?.ownerSubjectHash||'local-owner')?.id&&<button type="button" onClick={onOpenAllWallets} className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-left"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-blue-700"><Banknote className="h-5 w-5"/></span><span className="min-w-0 flex-1"><strong className="block text-sm text-slate-900">{language==='en'?'All wallets':'সব ওয়ালেট'}</strong><span className="mt-1 block text-xs text-slate-600">{language==='en'?'See total cash and each workspace’s share':'মোট টাকা ও প্রতিটি খাতার বরাদ্দ দেখুন'}</span></span><ChevronRight className="h-4 w-4 text-blue-700"/></button>}
      {/* Offline or Pending Sync Notice */}
      {(!isOnline || syncStatus.pendingOutboxCount > 0 || syncStatus.state === 'conflict') && (
        <div
          onClick={onOpenSyncModal}
          className="cursor-pointer px-3.5 py-2 rounded-xl border flex items-center justify-between text-xs transition-colors bg-amber-50/70 border-amber-200/80 text-amber-900 hover:bg-amber-100/70"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span className="font-medium truncate">
              {!isOnline
                ? (language === 'en' ? 'Offline · Changes saved locally' : 'অফলাইন · ডাটা ডিভাইসে সংরক্ষিত')
                : syncStatus.state === 'conflict'
                ? (language === 'en' ? 'Conflict review required' : 'সংঘাত পর্যালোচনা প্রয়োজন')
                : localFinanceOnly?(language==='en'?'Saved on this device · cloud sync not enabled':'ডিভাইসে সংরক্ষিত · ক্লাউড সিঙ্ক চালু হয়নি'):(language === 'en' ? `${syncStatus.pendingOutboxCount} pending sync` : `${syncStatus.pendingOutboxCount}টি সিঙ্ক অপেক্ষমান`)}
            </span>
          </div>
          {!localFinanceOnly&&<button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSyncClick();
            }}
            disabled={!isOnline || isSyncing}
            className="px-2 py-0.5 bg-amber-700 text-white rounded-md font-medium text-[11px] shrink-0 hover:bg-amber-800 disabled:opacity-50"
          >
            {language === 'en' ? 'Sync' : 'সিঙ্ক'}
          </button>}
        </div>
      )}

      {/* Primary Balance Card (Modern Deep Slate Navy) */}
      <div className="app-balance-card bg-slate-900 text-white rounded-2xl p-5 shadow-sm border border-slate-800 relative overflow-hidden">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs font-medium">
            <span className="truncate">
              {formatAccountTitle(currentWorkspace?.name || '', language)} · {walletFeatureEnabled?(language==='en'?'Spendable allocation':'খরচযোগ্য বরাদ্দ'):t.totalBalance}
            </span>
          </div>
          <span className="text-[10px] font-mono tracking-wider px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
            BDT
          </span>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <span className="min-w-0 break-all text-3xl sm:text-4xl font-bold tracking-tight tabular-nums text-white">{showBalance
            ? formatBDT(walletFeatureEnabled&&spendableMinor!==undefined?spendableMinor:dashboardData.totalConsolidatedBalanceMinor, { locale: language })
            : '৳ ••••••••'}</span>
          <button
            type="button"
            onClick={() => setShowBalance(value => !value)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
            aria-label={showBalance ? (language === 'en' ? 'Hide balance' : 'ব্যালেন্স লুকান') : (language === 'en' ? 'Show balance' : 'ব্যালেন্স দেখান')}
          >
            {showBalance ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {walletFeatureEnabled&&<div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-300"><span>{language==='en'?'Workspace total':'খাতার মোট'}: {showBalance?formatBDT(dashboardData.totalConsolidatedBalanceMinor,{locale:language}):'••••'}</span><span>{language==='en'?'Goal savings':'Goal-এ'}: {showBalance?formatBDT(reservedMinor,{locale:language}):'••••'}</span></div>}

        {/* 3-Metric Summary Strip */}
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-800 text-xs">
          <div>
            <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>{t.monthIncome}</span>
            </div>
            <div className="font-semibold text-emerald-400 mt-1 tabular-nums text-sm">
              {showBalance
                ? formatBDT(dashboardData.totalIncomeThisMonthMinor, {
                    locale: language,
                    showDecimals: false,
                  })
                : '••••'}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span>{t.monthExpense}</span>
            </div>
            <div className="font-semibold text-rose-400 mt-1 tabular-nums text-sm">
              {showBalance
                ? formatBDT(dashboardData.totalExpenseThisMonthMinor, {
                    locale: language,
                    showDecimals: false,
                  })
                : '••••'}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span>{walletFeatureEnabled?(language==='en'?'Income − expense':'আয় − ব্যয়'):t.netSavings}</span>
            </div>
            <div className="font-semibold text-slate-100 mt-1 tabular-nums text-sm">
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

      <DashboardCharts key={currentWorkspace?.id} data={dashboardData} language={language} visible={showBalance} />

      {onOpenSavingsGoals && <button type="button" onClick={onOpenSavingsGoals}
        className="flex w-full items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-xs transition hover:border-blue-300">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Target className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{language === 'en' ? 'Savings goals' : 'সঞ্চয়ের লক্ষ্য'}</span>
          <span className={`mt-1 block text-xs ${shortfall ? 'text-amber-700' : 'text-slate-500'}`}>
            {!savings ? (language === 'en' ? 'Open to check your savings goals' : 'লক্ষ্যের অবস্থা দেখতে খুলুন') : shortfall ? (language === 'en' ? 'Wallet balance changed · review allocations' : 'ওয়ালেটের ব্যালান্স বদলেছে · বরাদ্দ দেখুন') : activeGoals.length
              ? `${showBalance ? formatBDT(savedMinor, { locale: language }) : '••••'} · ${activeGoals.length.toLocaleString(language === 'en' ? 'en-GB' : 'bn-BD')} ${language === 'en' ? 'active goals' : 'সক্রিয় লক্ষ্য'}`
              : (language === 'en' ? 'Plan a purchase or build an emergency fund' : 'কেনাকাটার লক্ষ্য বা জরুরি তহবিল তৈরি করুন')}
          </span></span><ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      </button>}

      {/* Business Workspace: Members Strip */}
      {currentWorkspace?.kind === 'business' && (
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-600" />
              <h3 className="text-xs font-bold text-slate-900">
                {language === 'en' ? 'Business Members' : 'ব্যবসার অংশীদার ও সদস্য'}
              </h3>
            </div>
            <button
              type="button"
              onClick={onOpenPartiesModal}
              className="text-xs font-semibold text-blue-700 hover:text-blue-900 flex items-center gap-1"
            >
              <span>{language === 'en' ? 'Manage' : 'পরিচালনা'}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {parties.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={onOpenPartiesModal}
                className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/80 text-xs font-medium text-slate-700 transition-colors"
              >
                <span>{p.name}</span>
                <span className="text-[10px] text-slate-400">
                  {p.role === 'partner' ? (language === 'en' ? 'Partner' : 'পার্টনার') : p.role === 'staff' ? (language === 'en' ? 'Staff' : 'স্টাফ') : p.role === 'customer' ? (language === 'en' ? 'Client' : 'গ্রাহক') : (language === 'en' ? 'Vendor' : 'মহাজন')}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={onOpenPartiesModal}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-dashed border-slate-300 text-slate-600 hover:text-blue-700 hover:border-blue-400 text-xs font-medium transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>{language === 'en' ? 'Add' : 'যোগ'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Accounts & Wallets */}
      <div>
        <div className="flex items-center justify-between mb-2 px-0.5">
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            {t.accountsAndWallets}
          </h2>
          <span className="text-[11px] text-slate-400 font-medium">{t.latestBalance}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {dashboardData.accountSummaries.map((acc) => {
            const formattedName = formatAccountTitle(acc.name, language);
            return (
              <div
                key={acc.accountId}
                className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-colors flex flex-col justify-between"
              >
                <div className="flex items-start justify-between gap-1 mb-2">
                  <div className="p-1.5 rounded-lg bg-slate-50 text-slate-600">
                    {getAccountIcon(acc.kind)}
                  </div>
                  <span className="text-[10px] text-slate-400 uppercase font-mono">
                    {acc.kind}
                  </span>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-600 truncate mb-0.5" title={formattedName}>
                    {formattedName}
                  </div>
                  <div className="text-sm font-bold text-slate-900 tabular-nums">
                    {showBalance
                      ? formatBDT(acc.currentBalanceMinor, { locale: language })
                      : '৳ ••••••'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Transactions List */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            {t.recentTransactions}
          </h2>
          <button
            type="button"
            onClick={onNavigateToHistory}
            className="text-xs text-blue-700 hover:text-blue-900 font-semibold flex items-center gap-0.5"
          >
            <span>{t.seeAll}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {dashboardData.recentTransactions.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2">
              <Receipt className="w-5 h-5" />
            </div>
            <p className="text-xs font-medium text-slate-700 mb-1">
              {t.noTransactionsYet}
            </p>
            <p className="text-[11px] text-slate-400 mb-3">
              {t.cleanSlateDescription}
            </p>
            <button
              type="button"
              onClick={onNavigateToAdd}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs"
            >
              {t.addTransaction}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {dashboardData.recentTransactions.slice(0, 8).map((tx) => {
              const isIncome = tx.transactionType === 'income';
              const isExpense = tx.transactionType === 'expense';
              const isTransfer = tx.transactionType === 'transfer';

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
                  className="px-3.5 py-3 hover:bg-slate-50/80 transition-colors cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isIncome
                          ? 'bg-emerald-50 text-emerald-600'
                          : isExpense
                          ? 'bg-rose-50 text-rose-600'
                          : isTransfer
                          ? 'bg-blue-50 text-blue-600'
                          : 'bg-purple-50 text-purple-600'
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
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">
                        {tx.note ||
                          (isIncome
                            ? (language === 'en' ? 'Income' : 'জমা')
                            : isExpense
                            ? (language === 'en' ? 'Expense' : 'খরচ')
                            : isTransfer
                            ? (language === 'en' ? 'Transfer' : 'স্থানান্তর')
                            : (language === 'en' ? 'Correction' : 'সংশোধন'))}
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
                          ? 'text-emerald-600'
                          : isExpense
                          ? 'text-slate-900'
                          : 'text-blue-600'
                      }`}
                    >
                      {isIncome ? '+' : isExpense ? '-' : ''}
                      {formatBDT(displayAmount, { locale: language })}
                    </div>
                    {tx.receiptBlobSha256 && (
                      <span className="text-[10px] text-slate-400 flex items-center justify-end gap-0.5 mt-0.5">
                        <Receipt className="w-2.5 h-2.5" />
                        <span>{language === 'en' ? 'Receipt' : 'রসিদ'}</span>
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
