import React, { useState } from 'react';
import { BarChart3, PieChart, EyeOff } from 'lucide-react';
import { DashboardData } from '../contracts/types';
import { formatBDT } from '../domain/money';

const colors = ['#2563eb', '#8b5cf6', '#0d9488', '#f59e0b', '#ec4899', '#94a3b8'];
const ratio = (amount: bigint, total: bigint) => total > 0n ? Number(amount * 10_000n / total) / 100 : 0;

/** Read-only charts of the same ledger totals already shown on the dashboard. */
export function DashboardCharts({ data, language, visible }: { data: DashboardData; language: 'bn' | 'en'; visible: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const en = language === 'en';
  const money = (amount: string) => formatBDT(amount, { locale: language });
  if (!visible) return <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-6 text-xs text-slate-500"><EyeOff className="h-4 w-4" />{en ? 'Charts hidden with your balance' : 'ব্যালেন্সের সঙ্গে চার্টও লুকানো আছে'}</div>;
  const income = BigInt(data.totalIncomeThisMonthMinor), expense = BigInt(data.totalExpenseThisMonthMinor);
  const maximum = income > expense ? income : expense;
  const rows = [{ name: en ? 'Income' : 'আয়', amount: income, color: '#059669' }, { name: en ? 'Expense' : 'ব্যয়', amount: expense, color: '#f43f5e' }];
  const segments = data.topExpenseCategories.filter(cat => BigInt(cat.amountMinor) > 0n).map(cat => ({ id: cat.categoryId, name: cat.name, amount: BigInt(cat.amountMinor) }));
  const covered = segments.reduce((sum, cat) => sum + cat.amount, 0n);
  if (expense > covered) segments.push({ id: '__other', name: en ? 'Other expenses & fees' : 'অন্যান্য খরচ ও ফি', amount: expense - covered });
  const active = segments.find(cat => cat.id === selected);
  let offset = 0;
  const hasFlows = income > 0n || expense > 0n;
  const card = 'min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs';
  return <section aria-label={en ? 'Financial overview charts' : 'আর্থিক সারসংক্ষেপ চার্ট'} className="grid gap-4 sm:grid-cols-2">
    <article className={card}>
      <div className="flex items-center gap-2"><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><BarChart3 className="h-4 w-4" /></span><div><h2 className="text-sm font-bold text-slate-900">{en ? 'Income vs expense' : 'আয় ও ব্যয়ের তুলনা'}</h2><p className="mt-0.5 text-[11px] text-slate-400">{en ? 'This month · BDT' : 'এই মাস · টাকা'}</p></div></div>
      <div className="mt-6 space-y-5">
        {rows.map(row => <div key={row.name}><div className="mb-2 flex items-center justify-between gap-2 text-xs"><span className="font-medium text-slate-500">{row.name}</span><span className="font-semibold tabular-nums text-slate-900">{money(row.amount.toString())}</span></div><div role="img" aria-label={`${row.name}: ${money(row.amount.toString())}`} className="h-8 overflow-hidden rounded-lg bg-slate-100"><div className="h-full rounded-lg motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${ratio(row.amount, maximum)}%`, backgroundColor: row.color }} /></div></div>)}
      </div>
      <div className={`mt-6 rounded-xl p-3 ${BigInt(data.netFlowThisMonthMinor) < 0n ? 'bg-rose-50' : 'bg-emerald-50'}`}><p className="text-[11px] text-slate-500">{en ? 'Income minus expense' : 'আয় থেকে ব্যয় বাদে'}</p><p className={`mt-1 text-lg font-bold tabular-nums ${BigInt(data.netFlowThisMonthMinor) < 0n ? 'text-rose-700' : 'text-emerald-700'}`}>{money(data.netFlowThisMonthMinor)}</p></div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{!hasFlows ? (en ? 'Your first income or expense will appear here.' : 'প্রথম আয় বা খরচ যোগ করলে এখানে দেখা যাবে।') : (en ? 'Opening balances and transfers are excluded; transfer fees count as expense.' : 'প্রারম্ভিক ব্যালেন্স ও স্থানান্তর বাদ; স্থানান্তরের ফি খরচে অন্তর্ভুক্ত।')}</p>
    </article>
    <article className={card}>
      <div className="flex items-center gap-2"><span className="rounded-lg bg-blue-50 p-2 text-blue-700"><PieChart className="h-4 w-4" /></span><div><h2 className="text-sm font-bold text-slate-900">{en ? 'Where your money goes' : 'কোন খাতে কত খরচ'}</h2><p className="mt-0.5 text-[11px] text-slate-400">{en ? 'This month · Tap a category' : 'এই মাস · খাতে চাপ দিয়ে দেখুন'}</p></div></div>
      <div className="relative mx-auto my-4 h-40 w-40">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img" aria-label={en ? 'Monthly expenses by category; amounts are listed below' : 'মাসের খরচের খাতভিত্তিক চার্ট; পরিমাণ নিচে দেওয়া আছে'}>
          <circle className="app-chart-track" cx="60" cy="60" r="46" fill="none" stroke="#f1f5f9" strokeWidth="13" />
          {segments.map((cat, index) => { const share = ratio(cat.amount, expense), start = offset; offset += share;
            return <circle key={cat.id} cx="60" cy="60" r="46" pathLength="100" fill="none" stroke={colors[index % colors.length]} strokeWidth={active?.id === cat.id ? '17' : '13'} strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-start} opacity={active && active.id !== cat.id ? 0.3 : 1} className="motion-safe:transition-opacity"><title>{cat.name}: {money(cat.amount.toString())}</title></circle>;
          })}
        </svg>
        <div aria-live="polite" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-5 text-center"><span className="max-w-full truncate text-[10px] text-slate-500">{active?.name || (en ? 'Total expense' : 'মোট খরচ')}</span><strong className="mt-1 max-w-full truncate text-sm tabular-nums text-slate-900" title={money(active?.amount.toString() || data.totalExpenseThisMonthMinor)}>{money(active?.amount.toString() || data.totalExpenseThisMonthMinor)}</strong></div>
      </div>
      {segments.length ? <div className="space-y-1">{segments.map((cat, index) => <button key={cat.id} type="button" aria-pressed={active?.id === cat.id} onClick={() => setSelected(active?.id === cat.id ? null : cat.id)} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] transition-colors ${active?.id === cat.id ? 'bg-blue-50 ring-1 ring-blue-100' : 'hover:bg-slate-50'}`}><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} /><span className="min-w-0 flex-1 truncate text-slate-600" title={cat.name}>{cat.name}</span><span className="text-right"><span className="block font-semibold tabular-nums text-slate-900">{money(cat.amount.toString())}</span><span className="text-[10px] tabular-nums text-slate-400">{ratio(cat.amount, expense).toLocaleString(en ? 'en-GB' : 'bn-BD', { maximumFractionDigits: 1 })}%</span></span></button>)}</div> : <p className="pb-3 text-center text-xs leading-relaxed text-slate-400">{en ? 'No expenses this month. Your spending breakdown will appear here.' : 'এই মাসে খরচ নেই। খরচ যোগ করলে খাতভিত্তিক ভাগ দেখা যাবে।'}</p>}
    </article>
  </section>;
}
