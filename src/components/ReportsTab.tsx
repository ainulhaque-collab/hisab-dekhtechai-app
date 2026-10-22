import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { formatBDT, parsePaisaString, toPaisa } from '../domain/money';
import { evaluateBudget } from '../domain/recurring';
import { exportTransactionsToCSV } from '../domain/csv';
import {
  BarChart3,
  Download,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Plus,
  X,
  Target,
  Repeat,
  FileSpreadsheet
} from 'lucide-react';
import { Budget, RecurringRule } from '../contracts/types';
import { generateUUID } from '../domain/journal';

export const ReportsTab: React.FC = () => {
  const {
    currentWorkspace,
    dashboardData,
    transactions,
    accounts,
    categories,
    budgets,
    recurringRules,
    db,
    language,
    refreshState,
  } = useApp();

  const [activeSection, setActiveSection] = useState<'overview' | 'budget' | 'recurring' | 'calendar'>(
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

  if (!dashboardData || !currentWorkspace) return null;

  // Calculate actual spending per category this month
  const categorySpendingThisMonth = useMemo(() => {
    const map = new Map<string, bigint>();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (const tx of transactions) {
      if (tx.effectiveDate.startsWith(currentMonth) && tx.transactionType === 'expense') {
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

  // CSV Export handler
  const handleExportCSV = () => {
    const csvContent = exportTransactionsToCSV(transactions, accountsMap, categoriesMap);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `HisabDekhteChai_${currentWorkspace.name}_${new Date().toISOString().slice(0, 10)}.csv`;
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
      alert('সঠিক বাজেট লিমিট লিখুন');
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
      alert('সঠিক টাকার অঙ্ক লিখুন');
    }
  };

  return (
    <div className="space-y-4 pb-24 animate-in fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-slate-800 tracking-tight">
            আর্থিক রিপোর্ট ও বাজেট পরিকল্পনা
          </h1>
          <p className="text-xs text-slate-500">মাসিক বিশ্লেষণ, বাজেট ট্র্যাকিং ও এক্সপোর্ট</p>
        </div>
        <button
          type="button"
          onClick={handleExportCSV}
          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
          title="নিরাপদ CSV এক্সপোর্ট"
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>CSV এক্সপোর্ট</span>
        </button>
      </div>

      {/* Section Tabs */}
      <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveSection('overview')}
          className={`py-2 rounded-lg transition-all ${
            activeSection === 'overview'
              ? 'bg-white text-blue-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          সারসংক্ষেপ
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('budget')}
          className={`py-2 rounded-lg transition-all ${
            activeSection === 'budget'
              ? 'bg-white text-blue-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          বাজেট সীমা
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('recurring')}
          className={`py-2 rounded-lg transition-all ${
            activeSection === 'recurring'
              ? 'bg-white text-blue-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          পুনরাবৃত্ত বিল
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('calendar')}
          className={`py-2 rounded-lg transition-all ${
            activeSection === 'calendar'
              ? 'bg-white text-blue-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          ক্যালেন্ডার
        </button>
      </div>

      {/* Section 1: Overview */}
      {activeSection === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500 font-medium">এই মাসে মোট আয়</span>
              <div className="text-lg font-bold text-emerald-700 mt-1 tabular-nums">
                {formatBDT(dashboardData.totalIncomeThisMonthMinor, { locale: language })}
              </div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500 font-medium">এই মাসে মোট খরচ</span>
              <div className="text-lg font-bold text-rose-700 mt-1 tabular-nums">
                {formatBDT(dashboardData.totalExpenseThisMonthMinor, { locale: language })}
              </div>
            </div>
          </div>

          {/* Category-wise Breakdown */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <h3 className="text-sm font-bold text-slate-800 mb-3">সকল খাতের খরচের বিবরণ</h3>
            <div className="space-y-3">
              {Array.from(categorySpendingThisMonth.entries()).map(([catId, spent]) => {
                const cat = categoriesMap.get(catId);
                const totalExp = toPaisa(dashboardData.totalExpenseThisMonthMinor);
                const pct = totalExp > 0n ? Math.round(Number((spent * 10000n) / totalExp) / 100) : 0;
                return (
                  <div key={catId} className="text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-slate-800">{cat?.name || 'অজ্ঞাত'}</span>
                      <span className="font-bold text-slate-900 tabular-nums">
                        {formatBDT(spent, { locale: language })} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {categorySpendingThisMonth.size === 0 && (
                <p className="text-center text-xs text-slate-400 py-4">এই মাসে এখনও কোনো খরচ হয়নি</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section 2: Budgets */}
      {activeSection === 'budget' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">মাসিক খরচের সীমা ও সতর্কতা</span>
            <button
              type="button"
              onClick={() => setShowAddBudgetModal(true)}
              className="px-2.5 py-1 bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>বাজেট যোগ করুন</span>
            </button>
          </div>

          <div className="space-y-3">
            {budgets.map((bgt) => {
              const cat = categoriesMap.get(bgt.categoryId);
              const spent = categorySpendingThisMonth.get(bgt.categoryId) || 0n;
              const evalRes = evaluateBudget(bgt, spent.toString());

              return (
                <div
                  key={bgt.id}
                  className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-blue-700" />
                      <span className="text-sm font-bold text-slate-800">{cat?.name || 'খাত'}</span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        evalRes.alertLevel === 'danger'
                          ? 'bg-rose-100 text-rose-800'
                          : evalRes.alertLevel === 'warning'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {evalRes.alertLevel === 'danger'
                        ? 'সীমা অতিক্রম করেছে!'
                        : evalRes.alertLevel === 'warning'
                        ? '৮০% এর বেশি ব্যবহৃত'
                        : 'বাজেট নিয়ন্ত্রণে'}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-slate-500">
                      খরচ: <strong className="text-slate-800">{formatBDT(spent, { locale: language })}</strong>
                    </span>
                    <span className="text-slate-500">
                      সীমা: <strong className="text-slate-800">{formatBDT(bgt.limitMinor, { locale: language })}</strong>
                    </span>
                  </div>

                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        evalRes.alertLevel === 'danger'
                          ? 'bg-rose-600'
                          : evalRes.alertLevel === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-emerald-600'
                      }`}
                      style={{ width: `${Math.min(evalRes.percentageUsed, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {budgets.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
                কোনো বাজেট নির্ধারিত নেই। "বাজেট যোগ করুন" বাটনে ক্লিক করুন।
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 3: Recurring Rules */}
      {activeSection === 'recurring' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">স্বয়ংক্রিয় পুনরাবৃত্ত আয় ও ব্যয় রুলস</span>
            <button
              type="button"
              onClick={() => setShowAddRecurringModal(true)}
              className="px-2.5 py-1 bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>নতুন রুল</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {recurringRules.map((r) => {
              const acc = accountsMap.get(r.accountId);
              const cat = categoriesMap.get(r.categoryId);
              return (
                <div
                  key={r.id}
                  className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
                      <Repeat className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-800">{r.name}</h4>
                      <p className="text-[11px] text-slate-400">
                        প্রতি মাসের {r.dayOfMonth} তারিখ • {acc?.name} • {cat?.name}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-slate-900 tabular-nums">
                      {formatBDT(r.amountMinor, { locale: language })}
                    </div>
                    <span className="text-[10px] text-emerald-700 font-medium">সক্রিয়</span>
                  </div>
                </div>
              );
            })}
            {recurringRules.length === 0 && (
              <div className="p-8 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
                কোনো পুনরাবৃত্ত রুল নেই (যেমন: বাড়ি ভাড়া, ইন্টারনেট বিল)।
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 4: Calendar Cashflow */}
      {activeSection === 'calendar' && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-blue-700" />
            <span>দৈনিক ক্যাশফ্লো ক্যালেন্ডার</span>
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            প্রতিটি দিনের লেনদেনের মোট আয় ও ব্যয়ের তালিকা:
          </p>
          <div className="space-y-2 text-xs">
            {transactions.slice(0, 10).map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-700">{tx.effectiveDate}</span>
                  <span className="text-slate-500">• {tx.note || tx.transactionType}</span>
                </div>
                <span
                  className={`font-semibold tabular-nums ${
                    tx.transactionType === 'income' ? 'text-emerald-700' : 'text-slate-900'
                  }`}
                >
                  {tx.transactionType === 'income' ? '+' : '-'}
                  {formatBDT(tx.lines[0]?.debitMinor || tx.lines[0]?.creditMinor || '0', {
                    locale: language,
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Budget Modal */}
      {showAddBudgetModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 text-xs">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 text-sm">নতুন বাজেট সীমা নির্ধারণ</h3>
              <button
                type="button"
                onClick={() => setShowAddBudgetModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleSaveBudget} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">ক্যাটাগরি / খাত</label>
                <select
                  value={selectedCatId}
                  onChange={(e) => setSelectedCatId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                >
                  {categories
                    .filter((c) => c.kind === 'expense')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  মাসিক সর্বোচ্চ সীমা (৳)
                </label>
                <input
                  type="text"
                  placeholder="যেমন: ১০০০.০০"
                  value={budgetLimit}
                  onChange={(e) => setBudgetLimit(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-blue-700 text-white rounded-xl font-bold"
                >
                  বাজেট সংরক্ষণ
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddBudgetModal(false)}
                  className="px-3 py-2 text-slate-600 rounded-xl font-semibold"
                >
                  বাতিল
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Recurring Modal */}
      {showAddRecurringModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 text-xs">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 text-sm">পুনরাবৃত্ত রুল যোগ করুন</h3>
              <button
                type="button"
                onClick={() => setShowAddRecurringModal(false)}
                className="p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleSaveRecurring} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">রুলের নাম</label>
                <input
                  type="text"
                  placeholder="যেমন: বাসা ভাড়া / ওয়াইফাই বিল"
                  value={recName}
                  onChange={(e) => setRecName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  required
                />
              </div>
              <div>
                <label className="block text-slate-700 font-semibold mb-1">টাকার অঙ্ক (৳)</label>
                <input
                  type="text"
                  placeholder="0.00"
                  value={recAmount}
                  onChange={(e) => setRecAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl tabular-nums"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">পুনরাবৃত্তি</label>
                  <select
                    value={recFreq}
                    onChange={(e) => setRecFreq(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  >
                    <option value="monthly">মাসিক</option>
                    <option value="weekly">সাপ্তাহিক</option>
                    <option value="daily">দৈনিক</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">মাসের তারিখ</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={recDayOfMonth}
                    onChange={(e) => setRecDayOfMonth(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-blue-700 text-white rounded-xl font-bold"
                >
                  রুল সংরক্ষণ
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddRecurringModal(false)}
                  className="px-3 py-2 text-slate-600 rounded-xl font-semibold"
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
