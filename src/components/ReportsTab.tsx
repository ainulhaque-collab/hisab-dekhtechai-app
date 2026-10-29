import { AppSelect } from './AppSelect';
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { formatBDT, parsePaisaString, toPaisa } from '../domain/money';
import { evaluateBudget } from '../domain/recurring';
import { exportTransactionsToCSV } from '../domain/csv';
import { exportFinancialsToXLSX } from '../domain/excel';
import {
  Download,
  Plus,
  X,
  Target,
  Repeat,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  PiggyBank
} from 'lucide-react';
import { Budget, RecurringRule } from '../contracts/types';
import { generateUUID } from '../domain/journal';
import { FinancialInsightsPanel } from './FinancialInsightsPanel';
import type { JournalTransaction } from '../contracts/types';

export const ReportsTab: React.FC<{ onSelectTransaction?: (tx: JournalTransaction) => void }> = ({ onSelectTransaction }) => {
  const {
    currentWorkspace,
    dashboardData,
    transactions,
    accounts,
    categories,
    parties,
    budgets,
    recurringRules,
    db,
    language,
    refreshState,
  } = useApp();

  const isEn = language === 'en';

  const [activeSection, setActiveSection] = useState<'overview' | 'budget' | 'recurring' | 'calendar' | 'details'>(
    'overview'
  );
  const [showAddBudgetModal, setShowAddBudgetModal] = useState(false);
  const [showAddRecurringModal, setShowAddRecurringModal] = useState(false);

  // Budget form state
  const [selectedCatId, setSelectedCatId] = useState(categories[0]?.id || '');
  const [budgetLimit, setBudgetLimit] = useState('');

  // Recurring form state
  const [recName, setRecName] = useState('');
  const [recAmount, setRecAmount] = useState('');
  const [recType, setRecType] = useState<'expense' | 'income'>('expense');
  const [recFreq, setRecFreq] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [recDayOfMonth, setRecDayOfMonth] = useState('1');
  const [recAccountId, setRecAccountId] = useState(accounts[0]?.id || '');
  const [recCategoryId, setRecCategoryId] = useState(categories[0]?.id || '');

  const accountsMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoriesMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Calculate actual spending per category this month
  const categorySpendingThisMonth = useMemo(() => {
    const map = new Map<string, bigint>();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (const tx of transactions) {
      if (tx.effectiveDate.startsWith(currentMonth) && !tx.isDeleted && !tx.isReplacedBy &&
          (tx.transactionType === 'expense' || tx.transactionType === 'transfer')) {
        for (const line of tx.lines) {
          if (line.categoryId) {
            const current = map.get(line.categoryId) || 0n;
            map.set(line.categoryId, current + toPaisa(line.debitMinor));
          }
        }
      }
    }
    return map;
  }, [transactions]);

  if (!dashboardData || !currentWorkspace) return null;
  if (activeSection === 'details' || activeSection === 'calendar') return <FinancialInsightsPanel
    key={`${currentWorkspace.ownerSubjectHash}:${currentWorkspace.id}:${activeSection}`}
    initialMode={activeSection === 'calendar' ? 'calendar' : 'report'}
    onBack={() => setActiveSection('overview')} onOpenTransaction={onSelectTransaction} />;

  const netSavingsMinor =
    toPaisa(dashboardData.totalIncomeThisMonthMinor) - toPaisa(dashboardData.totalExpenseThisMonthMinor);

  // CSV Export handler
  const handleExportCSV = () => {
    const csvContent = exportTransactionsToCSV(transactions, accountsMap, categoriesMap);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Hisab_${currentWorkspace.name}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Excel (XLSX) Export handler
  const handleExportXLSX = () => {
    const data = exportFinancialsToXLSX(currentWorkspace, transactions, accounts, categories, parties);
    const blob = new Blob([data.buffer as ArrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Hisab_${currentWorkspace.name}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSaveBudget = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCatId || !budgetLimit) return;
    try {
      const limitMinor = parsePaisaString(budgetLimit).toString();
      const budget: Budget = {
        id: generateUUID(),
        workspaceId: currentWorkspace.id,
        categoryId: selectedCatId,
        period: 'monthly',
        limitMinor,
        alertThresholds: [80, 100],
        updatedAt: new Date().toISOString(),
      };
      db.setBudget(budget);
      refreshState();
      setBudgetLimit('');
      setShowAddBudgetModal(false);
    } catch {
      // invalid input
    }
  };

  const handleSaveRecurring = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recName.trim() || !recAmount) return;
    try {
      const amountMinor = parsePaisaString(recAmount).toString();
      const rule: RecurringRule = {
        id: generateUUID(),
        workspaceId: currentWorkspace.id,
        name: recName.trim(),
        frequency: recFreq,
        dayOfMonth: parseInt(recDayOfMonth, 10) || 1,
        amountMinor,
        type: recType,
        accountId: recAccountId || accounts[0]?.id,
        categoryId: recCategoryId || categories[0]?.id,
        autoPostEnabled: true,
        active: true,
        generation: 1,
        createdAt: new Date().toISOString(),
      };
      db.setRecurringRule(rule);
      refreshState();
      setRecName('');
      setRecAmount('');
      setShowAddRecurringModal(false);
    } catch {
      // invalid input
    }
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">
            {isEn ? 'Reports & Budgets' : 'রিপোর্ট ও বাজেট'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isEn ? 'Monthly cashflow and expense limits' : 'মাসিক ক্যাশফ্লো ও বাজেট পরিকল্পনা'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleExportCSV}
            className="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1 shadow-2xs transition-colors"
            title={isEn ? 'Export to CSV' : 'CSV ফাইল ডাউনলোড'}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={handleExportXLSX}
            className="px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-medium flex items-center gap-1 shadow-2xs transition-colors"
            title={isEn ? 'Export formatted Excel workbook' : 'এক্সেল ফাইল ডাউনলোড'}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Excel</span>
          </button>
        </div>
      </div>

      {/* Segmented Section Switcher */}
      <button type="button" onClick={() => setActiveSection('details')} className="min-h-11 w-full rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-left text-xs font-semibold text-blue-800">
        {isEn ? 'Detailed reports, calendar & spending review' : 'বিস্তারিত রিপোর্ট, ক্যালেন্ডার ও খরচ যাচাই'}
      </button>
      <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveSection('overview')}
          className={`py-1.5 rounded-lg transition-all ${
            activeSection === 'overview'
              ? 'bg-white text-slate-900 shadow-2xs font-semibold'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {isEn ? 'Overview' : 'সারসংক্ষেপ'}
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('budget')}
          className={`py-1.5 rounded-lg transition-all ${
            activeSection === 'budget'
              ? 'bg-white text-slate-900 shadow-2xs font-semibold'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {isEn ? 'Budgets' : 'বাজেট সীমা'}
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('recurring')}
          className={`py-1.5 rounded-lg transition-all ${
            activeSection === 'recurring'
              ? 'bg-white text-slate-900 shadow-2xs font-semibold'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {isEn ? 'Recurring' : 'পুনরাবৃত্ত বিল'}
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('calendar')}
          className="py-1.5 rounded-lg text-slate-500 transition-colors hover:text-slate-800"
        >
          {isEn ? 'Cashflow' : 'ক্যালেন্ডার'}
        </button>
      </div>

      {/* Section 1: Overview */}
      {activeSection === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2.5">
            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-emerald-600" />
                {isEn ? 'Income' : 'আয়'}
              </span>
              <div className="text-sm md:text-base font-bold text-slate-900 mt-1 tabular-nums">
                {formatBDT(dashboardData.totalIncomeThisMonthMinor, { locale: language })}
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                <TrendingDown className="w-3 h-3 text-rose-500" />
                {isEn ? 'Expense' : 'খরচ'}
              </span>
              <div className="text-sm md:text-base font-bold text-slate-900 mt-1 tabular-nums">
                {formatBDT(dashboardData.totalExpenseThisMonthMinor, { locale: language })}
              </div>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
              <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                <PiggyBank className="w-3 h-3 text-blue-600" />
                {isEn ? 'Net' : 'সঞ্চয়'}
              </span>
              <div
                className={`text-sm md:text-base font-bold mt-1 tabular-nums ${
                  netSavingsMinor >= 0n ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {formatBDT(netSavingsMinor, { locale: language })}
              </div>
            </div>
          </div>

          {/* Category-wise Breakdown */}
          <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3">
              {isEn ? 'Spending by Category' : 'খাতভিত্তিক খরচ'}
            </h3>
            <div className="space-y-3">
              {Array.from(categorySpendingThisMonth.entries()).map(([catId, spent]) => {
                const cat = categoriesMap.get(catId);
                const totalExp = toPaisa(dashboardData.totalExpenseThisMonthMinor);
                const pct = totalExp > 0n ? Math.round(Number((spent * 10000n) / totalExp) / 100) : 0;
                return (
                  <div key={catId} className="text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-slate-800">{cat?.name || (isEn ? 'Unknown' : 'অন্যান্য')}</span>
                      <span className="tabular-nums font-semibold text-slate-700">
                        {formatBDT(spent, { locale: language })} <span className="text-slate-400 font-normal">({pct}%)</span>
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-900 rounded-full"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {categorySpendingThisMonth.size === 0 && (
                <p className="text-center text-xs text-slate-400 py-6">
                  {isEn ? 'No expenses recorded this month' : 'এই মাসে এখনও কোনো খরচ হয়নি'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section 2: Budgets */}
      {activeSection === 'budget' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {isEn ? 'Category spending limits' : 'মাসিক খরচের সীমা ও সতর্কতা'}
            </span>
            <button
              type="button"
              onClick={() => setShowAddBudgetModal(true)}
              className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium flex items-center gap-1 shadow-2xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isEn ? 'Add Budget' : 'বাজেট যোগ'}</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {budgets.map((bgt) => {
              const cat = categoriesMap.get(bgt.categoryId);
              const spent = categorySpendingThisMonth.get(bgt.categoryId) || 0n;
              const evalRes = evaluateBudget(bgt, spent.toString());

              return (
                <div
                  key={bgt.id}
                  className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-slate-600" />
                      <span className="text-xs font-semibold text-slate-800">{cat?.name || 'Category'}</span>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        evalRes.alertLevel === 'danger'
                          ? 'bg-rose-50 text-rose-700'
                          : evalRes.alertLevel === 'warning'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {evalRes.alertLevel === 'danger'
                        ? (isEn ? 'Exceeded' : 'সীমা অতিক্রম করেছে')
                        : evalRes.alertLevel === 'warning'
                        ? (isEn ? 'Near Limit' : '৮০% এর বেশি ব্যবহৃত')
                        : (isEn ? 'On Track' : 'বাজেট নিয়ন্ত্রণে')}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-slate-500">
                      {isEn ? 'Spent: ' : 'খরচ: '}
                      <strong className="text-slate-800 tabular-nums">{formatBDT(spent, { locale: language })}</strong>
                    </span>
                    <span className="text-slate-500">
                      {isEn ? 'Limit: ' : 'সীমা: '}
                      <strong className="text-slate-800 tabular-nums">{formatBDT(bgt.limitMinor, { locale: language })}</strong>
                    </span>
                  </div>

                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        evalRes.alertLevel === 'danger'
                          ? 'bg-rose-600'
                          : evalRes.alertLevel === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-slate-900'
                      }`}
                      style={{ width: `${Math.min(evalRes.percentageUsed, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {budgets.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200/80">
                {isEn ? 'No budgets configured yet' : 'কোনো বাজেট নির্ধারিত নেই'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 3: Recurring Rules */}
      {activeSection === 'recurring' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {isEn ? 'Automated recurring bills' : 'স্বয়ংক্রিয় পুনরাবৃত্ত আয় ও ব্যয় রুলস'}
            </span>
            <button
              type="button"
              onClick={() => setShowAddRecurringModal(true)}
              className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium flex items-center gap-1 shadow-2xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isEn ? 'New Rule' : 'নতুন রুল'}</span>
            </button>
          </div>

          <div className="space-y-2">
            {recurringRules.map((r) => {
              const acc = accountsMap.get(r.accountId);
              const cat = categoriesMap.get(r.categoryId);
              return (
                <div
                  key={r.id}
                  className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                      <Repeat className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-800">{r.name}</h4>
                      <p className="text-[11px] text-slate-400">
                        {isEn ? `Day ${r.dayOfMonth}` : `মাসের ${r.dayOfMonth} তারিখ`} · {acc?.name} · {cat?.name}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-900 tabular-nums">
                      {formatBDT(r.amountMinor, { locale: language })}
                    </div>
                    <span className="text-[10px] text-emerald-700 font-medium">
                      {isEn ? 'Active' : 'সক্রিয়'}
                    </span>
                  </div>
                </div>
              );
            })}
            {recurringRules.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200/80">
                {isEn ? 'No recurring rules set' : 'কোনো পুনরাবৃত্ত রুল নেই'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Budget Modal */}
      {showAddBudgetModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 text-xs">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800 text-sm">
                {isEn ? 'Set Budget Limit' : 'নতুন বাজেট সীমা'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddBudgetModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveBudget} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  {isEn ? 'Category' : 'খাত / ক্যাটাগরি'}
                </label>
                <AppSelect aria-label={isEn ? 'Budget Category' : 'বাজেটের খাত'}
                  value={selectedCatId}
                  onChange={(e) => setSelectedCatId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
                >
                  {categories
                    .filter((c) => c.kind === 'expense')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </AppSelect>
              </div>
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  {isEn ? 'Monthly Limit (BDT)' : 'মাসিক সীমা (৳)'}
                </label>
                <input
                  type="text"
                  placeholder="5000"
                  value={budgetLimit}
                  onChange={(e) => setBudgetLimit(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono tabular-nums text-slate-900 focus:outline-none focus:border-slate-400"
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium shadow-2xs transition-colors"
                >
                  {isEn ? 'Save Budget' : 'সংরক্ষণ'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddBudgetModal(false)}
                  className="px-3 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg font-medium"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Recurring Modal */}
      {showAddRecurringModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 text-xs">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800 text-sm">
                {isEn ? 'Add Recurring Rule' : 'পুনরাবৃত্ত রুল'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddRecurringModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveRecurring} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  {isEn ? 'Rule Name' : 'রুলের নাম'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? 'e.g. WiFi Bill' : 'যেমন: ওয়াইফাই বিল'}
                  value={recName}
                  onChange={(e) => setRecName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
                  required
                />
              </div>
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  {isEn ? 'Amount (BDT)' : 'টাকার পরিমাণ (৳)'}
                </label>
                <input
                  type="text"
                  placeholder="0.00"
                  value={recAmount}
                  onChange={(e) => setRecAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono tabular-nums text-slate-900 focus:outline-none focus:border-slate-400"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    {isEn ? 'Frequency' : 'পুনরাবৃত্তি'}
                  </label>
                  <AppSelect aria-label={isEn ? 'Frequency' : 'পুনরাবৃত্তি'}
                    value={recFreq}
                    onChange={(e) => setRecFreq(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
                  >
                    <option value="monthly">{isEn ? 'Monthly' : 'মাসিক'}</option>
                    <option value="weekly">{isEn ? 'Weekly' : 'সাপ্তাহিক'}</option>
                    <option value="daily">{isEn ? 'Daily' : 'দৈনিক'}</option>
                  </AppSelect>
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">
                    {isEn ? 'Day of Month' : 'তারিখ'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={recDayOfMonth}
                    onChange={(e) => setRecDayOfMonth(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono tabular-nums text-slate-900 focus:outline-none focus:border-slate-400"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium shadow-2xs transition-colors"
                >
                  {isEn ? 'Save Rule' : 'রুল সংরক্ষণ'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddRecurringModal(false)}
                  className="px-3 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg font-medium"
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
