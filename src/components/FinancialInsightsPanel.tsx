import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, CalendarDays, FileDown } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { JournalTransaction } from '../contracts/types';
import { buildFinancialReport, previousReportPeriod, reviewSpending, shiftReportDate, UNALLOCATED_REPORT_CATEGORY, type ReportEntry } from '../domain/financialReports';
import { formatBDT } from '../domain/money';
import { localDate } from '../domain/transactionTime';
import { calendarMonth, moveCalendarMonth } from './calendarDate';
import { AppDateInput } from './AppDateInput';
import { AppSelect } from './AppSelect';
import { secondaryButton } from './ModalShell';
import { summaryForGuide,guideInputHash } from '../ai/financialGuide';
import { FinancialGuidePanel } from './FinancialGuidePanel';

type Mode = 'report' | 'calendar' | 'review' | 'digest';
const card = 'rounded-2xl border border-slate-200 bg-white p-4';
const dateClass = 'w-full rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-800';
export function FinancialInsightsPanel({ onBack, onOpenTransaction, initialMode = 'report' }: {
  onBack: () => void; onOpenTransaction?: (tx: JournalTransaction) => void; initialMode?: Mode;
}) {
  const { db, currentWorkspace, transactions, accounts, accountGroups, categories, language } = useApp();
  const en = language === 'en', today = localDate();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [scopeId, setScopeId] = useState('all');
  const [calendarDate, setCalendarDate] = useState(today);
  const [limit, setLimit] = useState(50);
  const [printing,setPrinting] = useState(false);
  const [printError,setPrintError] = useState<string|null>(null);
  const allAccounts = useMemo(() => currentWorkspace ? db.getAllAccounts(currentWorkspace.id) : [], [db, currentWorkspace, accounts, transactions]);
  const groups = useMemo(() => currentWorkspace ? db.getAccountGroups(currentWorkspace.id, true) : [], [db, currentWorkspace, accountGroups]);
  const month = /^\d{4}-\d{2}-\d{2}$/.test(calendarDate) ? calendarDate.slice(0, 7) : today.slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number);
  const monthDays = calendarMonth(year, monthNumber);
  const monthEnd = monthDays.filter((date): date is string => !!date).at(-1) || today;
  const projection = useMemo(() => {
    if (!currentWorkspace) return null;
    try {
      const accountIds = scopeId === 'all' ? undefined : scopeId.startsWith('account:')
        ? allAccounts.filter(a => a.id === scopeId.slice(8)).map(a => a.id)
        : allAccounts.filter(a => a.groupId === scopeId.slice(6)).map(a => a.id);
      const scope = { workspaceId: currentWorkspace.id, from: mode === 'calendar' ? month + '-01' : from,
        to: mode === 'calendar' ? monthEnd : to, accounts: allAccounts, transactions, accountIds };
      const report = buildFinancialReport(scope);
      return { report, previous: mode === 'digest' ? buildFinancialReport({ ...scope, ...previousReportPeriod(from, to) }) : null,
        reviews: mode === 'review' ? reviewSpending(scope) : [] };
    } catch { return null; }
  }, [currentWorkspace, allAccounts, transactions, scopeId, from, to, mode, month, monthEnd]);
  const categoryNames = new Map(categories.map(category => [category.id, en ? category.nameEn || category.name : category.name]));
  categoryNames.set(UNALLOCATED_REPORT_CATEGORY, en ? 'Mixed categories — wallet allocation unspecified' : 'একাধিক খাত — ওয়ালেটভিত্তিক ভাগ নির্ধারিত নয়');
  const guideInput=useMemo(()=>{try{return projection?summaryForGuide(projection.report,categoryNames,language):null;}catch{return null;}},[projection,language,categories]);
  const money = (amount: string) => formatBDT(amount, { locale: language });
  const scopeName = scopeId === 'all' ? (en?'All wallets':'সব ওয়ালেট') : scopeId.startsWith('account:')
    ? allAccounts.find(account=>account.id===scopeId.slice(8))?.name || (en?'Selected wallet':'নির্বাচিত ওয়ালেট')
    : groups.find(group=>group.id===scopeId.slice(6))?.name || (en?'Selected group':'নির্বাচিত গ্রুপ');
  const number = (value: number) => value.toLocaleString(en ? 'en-GB' : 'bn-BD');
  const setPeriod = (period: 'week' | 'month') => {
    setFrom(period === 'week' ? shiftReportDate(today, -6) : today.slice(0, 7) + '-01'); setTo(today); setLimit(50);
  };
  const moveMonth = (delta: number) => {
    const moved = moveCalendarMonth(year, monthNumber, delta);
    if (moved) setCalendarDate(`${String(moved.year).padStart(4, '0')}-${String(moved.month).padStart(2, '0')}-01`);
  };
  const entries = (items: ReportEntry[]) => <div className="space-y-2">{items.slice(0, limit).map(item => <button type="button" key={item.transaction.id}
    disabled={!onOpenTransaction} onClick={() => onOpenTransaction?.(item.transaction)}
    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white p-3 text-left text-xs hover:bg-slate-50 disabled:cursor-default">
    <span className="min-w-0"><span className="block text-slate-500">{item.transaction.effectiveDate}</span><span className="mt-1 block break-words text-slate-800">{item.transaction.note || (en ? item.transaction.transactionType : ({income:'আয়',expense:'খরচ',transfer:'স্থানান্তর',opening:'প্রারম্ভিক স্থিতি',correction:'সংশোধন',reversal:'বাতিল'}[item.transaction.transactionType]))}</span></span>
    <span className="shrink-0 text-right font-semibold tabular-nums">{BigInt(item.incomeMinor) > 0n ? <span className="text-emerald-700">+{money(item.incomeMinor)}</span> : BigInt(item.expenseMinor) > 0n ? <span className="text-rose-700">−{money(item.expenseMinor)}</span> : <span className="text-slate-500">{en ? 'Transfer / capital' : 'স্থানান্তর / মূলধন'}</span>}</span>
  </button>)}{items.length > limit && <button type="button" className={`${secondaryButton} w-full`} onClick={() => setLimit(value => value + 50)}>{en ? 'Show 50 more' : 'আরও ৫০টি দেখুন'}</button>}{!items.length && <p className="py-5 text-center text-xs text-slate-500">{en ? 'No entries in this selection.' : 'এই নির্বাচনে কোনো লেনদেন নেই।'}</p>}</div>;
  return <div className="space-y-4 pb-24">
    <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 text-xs text-slate-600"><ArrowLeft className="h-4 w-4" />{en ? 'Reports & budgets' : 'রিপোর্ট ও বাজেট'}</button>
    <div><h1 className="text-lg font-bold text-slate-900">{en ? 'Your financial overview' : 'আপনার হিসাবের বিস্তারিত'}</h1><p className="mt-1 text-xs text-slate-500">{currentWorkspace?.name}</p></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(['report','calendar','review','digest'] as Mode[]).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`min-h-11 rounded-xl border px-2 text-xs ${mode === value ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>{({report:en?'Details':'বিস্তারিত',calendar:en?'Calendar':'ক্যালেন্ডার',review:en?'Review spending':'খরচ যাচাই',digest:en?'Summary':'সারাংশ'})[value]}</button>)}</div>
    <section className={`${card} space-y-3`} aria-label={en ? 'Report filters' : 'রিপোর্টের নির্বাচন'}>
      <label className="block text-xs font-medium text-slate-700">{en ? 'Wallet or group' : 'ওয়ালেট বা গ্রুপ'}<AppSelect aria-label={en ? 'Wallet or group' : 'ওয়ালেট বা গ্রুপ'} value={scopeId} onChange={event => { setScopeId(event.target.value); setLimit(50); }} className={`${dateClass} mt-2`}>
        <option value="all">{en ? 'All wallets' : 'সব ওয়ালেট'}</option>
        {groups.map(group => <option key={group.id} value={'group:'+group.id}>{en ? 'Group: ' : 'গ্রুপ: '}{group.name}{group.archivedAt ? (en?' (archived)':' (আর্কাইভ)') : ''}</option>)}
        {allAccounts.filter(a => (a.classification || 'asset') === 'asset' && !a.id.startsWith('sl-account-')).map(account => <option key={account.id} value={'account:'+account.id}>{account.name}{account.archivedAt ? (en?' (archived)':' (আর্কাইভ)') : ''}</option>)}
      </AppSelect></label>
      {mode !== 'calendar' && <><div className="grid grid-cols-2 gap-3"><div><p className="mb-2 text-xs text-slate-500">{en?'From':'শুরু'}</p><AppDateInput label={en?'Report start':'রিপোর্টের শুরুর তারিখ'} value={from} onChange={setFrom} language={language} className={dateClass}/></div><div><p className="mb-2 text-xs text-slate-500">{en?'To':'শেষ'}</p><AppDateInput label={en?'Report end':'রিপোর্টের শেষ তারিখ'} value={to} onChange={setTo} language={language} className={dateClass}/></div></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setPeriod('week')} className={secondaryButton}>{en?'Last 7 days':'গত ৭ দিন'}</button><button type="button" onClick={() => setPeriod('month')} className={secondaryButton}>{en?'This month':'এই মাস'}</button></div></>}
    </section>
    {projection && <div className="space-y-2"><button type="button" disabled={printing} className={`${secondaryButton} w-full`} onClick={async()=>{
      setPrintError(null);setPrinting(true);
      try { const {printFinancialReport}=await import('../platform/printReport'); await printFinancialReport(projection.report,{workspace:currentWorkspace?.name||'',scope:scopeName,language}); }
      catch(error) { setPrintError(error instanceof Error && error.message==='REPORT_TOO_LARGE' ? (en?'Choose a shorter period with no more than 2,000 entries.':'সর্বোচ্চ ২,০০০ লেনদেনের ছোট সময় বেছে নিন।') : (en?'Print preview could not open. Try again; your records are unchanged.':'প্রিন্ট প্রিভিউ খোলেনি। আবার চেষ্টা করুন; আপনার হিসাব অক্ষত আছে।')); }
      finally { setPrinting(false); }
    }}><FileDown className="h-4 w-4"/>{printing?(en?'Preparing report…':'রিপোর্ট তৈরি হচ্ছে…'):(en?'Save as PDF / Print':'PDF হিসেবে সেভ / প্রিন্ট')}</button><p className="text-xs text-slate-500">{en?'In the print dialog choose Save as PDF. This report stays on your device.':'প্রিন্ট ডায়ালগে Save as PDF বেছে নিন। রিপোর্ট এই ডিভাইসেই তৈরি হয়।'}</p>{printError && <p role="alert" className="text-xs text-rose-700">{printError}</p>}</div>}
    {!projection ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-xs text-rose-800">{en?'This report cannot be calculated. Check the dates and try again. Your records are unchanged.':'রিপোর্টের হিসাব করা যায়নি। তারিখ দেখে আবার চেষ্টা করুন। আপনার হিসাব সংরক্ষিত আছে।'}</p> : <>
      <div className="grid grid-cols-2 gap-3">{[
        [en?'Income':'আয়',projection.report.incomeMinor], [en?'Expense':'খরচ',projection.report.expenseMinor],
        [en?'Income minus expense':'আয় থেকে ব্যয় বাদে',projection.report.netMinor], [en?'Wallet balance at period end':'শেষ তারিখে ওয়ালেটের স্থিতি',projection.report.closingWalletMinor]
      ].map(([label, amount]) => <div key={label} className={card}><p className="text-xs text-slate-500">{label}</p><p className="mt-2 break-words text-base font-bold tabular-nums text-slate-900">{money(amount)}</p></div>)}</div>
      <p className="text-xs leading-relaxed text-slate-500">{en?'Income and expense exclude opening capital, loan principal and transfers; transfer fees are expense. Reversals are replayed in wallet balances.':'আয়-ব্যয়ে প্রারম্ভিক মূলধন, ঋণের আসল ও স্থানান্তরের মূল টাকা নেই; স্থানান্তরের ফি খরচ। ওয়ালেটের স্থিতিতে বাতিলের বিপরীত এন্ট্রিও হিসাব হয়।'}</p>
      {mode === 'report' && <><section className={card}><h2 className="mb-3 text-sm font-semibold">{en?'Spending by category':'খাতভিত্তিক খরচ'}</h2><div className="space-y-3">{projection.report.categories.map(category => <div key={category.id} className="flex justify-between gap-3 text-xs"><span className="break-words">{categoryNames.get(category.id) || (en?'Archived / unknown category':'আর্কাইভ / অজানা খাত')}</span><span className="shrink-0 font-semibold tabular-nums">{money(category.amountMinor)}</span></div>)}</div></section>{entries(projection.report.entries)}</>}
      {mode === 'calendar' && <section className={`${card} space-y-4`}><div className="flex items-center gap-2"><button type="button" aria-label={en?'Previous month':'আগের মাস'} className="min-h-11 min-w-11 rounded-xl border border-slate-200 p-3" onClick={() => moveMonth(-1)}><ChevronLeft className="h-4 w-4"/></button><AppDateInput label={en?'Calendar date':'ক্যালেন্ডারের তারিখ'} value={calendarDate} onChange={setCalendarDate} language={language} className={`${dateClass} flex-1`}/><button type="button" aria-label={en?'Next month':'পরের মাস'} className="min-h-11 min-w-11 rounded-xl border border-slate-200 p-3" onClick={() => moveMonth(1)}><ChevronRight className="h-4 w-4"/></button></div><div className="grid grid-cols-7 gap-1">{(en?['Su','Mo','Tu','We','Th','Fr','Sa']:['রবি','সোম','মঙ্গল','বুধ','বৃহঃ','শুক্র','শনি']).map(day => <span key={day} className="py-2 text-center text-[11px] text-slate-500">{day}</span>)}{calendarMonth(year,monthNumber).map((date,index) => date ? <button key={date} type="button" aria-pressed={calendarDate===date} aria-label={date} onClick={() => setCalendarDate(date)} className={`min-h-12 rounded-lg border p-1 text-center text-xs ${calendarDate===date?'border-blue-700 bg-blue-700 text-white':'border-slate-100 text-slate-800 hover:bg-slate-50'}`}><span>{number(Number(date.slice(-2)))}</span><span className="mt-1 block text-[10px]">{projection.report.days.find(day=>day.date===date)?.count ? number(projection.report.days.find(day=>day.date===date)!.count) + (en?' tx':'টি') : '·'}</span></button> : <span key={'empty'+index}/>)}</div><h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4"/>{calendarDate}</h2>{entries(projection.report.entries.filter(item=>item.transaction.effectiveDate===calendarDate))}</section>}
      {mode === 'review' && <section className={`${card} space-y-4`}><p className="text-xs leading-relaxed text-slate-600">{en?'Suggestions for review, not confirmed errors. Duplicate candidates share date, type, amount, wallets and categories. Unusual expenses are at least ৳100 and 3× the category median from at least 5 expenses in the 90 days before this period starts.':'এগুলো যাচাইয়ের পরামর্শ। একই তারিখ, ধরন, টাকা, ওয়ালেট ও খাত মিললে সম্ভাব্য ডুপ্লিকেট দেখায়। নির্বাচিত সময় শুরুর আগের ৯০ দিনে একই খাতে অন্তত ৫টি খরচের মধ্যকের ৩ গুণ এবং অন্তত ৳১০০ হলে অস্বাভাবিক খরচ হিসেবে দেখায়।'}</p>{projection.reviews.map((review,index)=><div key={review.kind+index} className="rounded-xl border border-amber-200 bg-amber-50 p-3"><h2 className="text-xs font-semibold text-amber-900">{review.kind==='possible-duplicate'?(en?'Possible duplicate':'সম্ভাব্য ডুপ্লিকেট'):(en?'Larger than usual':'স্বাভাবিকের চেয়ে বেশি')}</h2>{review.baselineMinor && <p className="mt-2 text-xs text-slate-600">{en?'Prior median: ':'আগের মধ্যক: '}{money(review.baselineMinor)}</p>}<div className="mt-3">{entries(projection.report.entries.filter(item=>review.transactionIds.includes(item.transaction.id)))}</div></div>)}{!projection.reviews.length && <p className="py-4 text-center text-xs text-slate-500">{en?'No review suggestions for this selection.':'এই নির্বাচনে যাচাইয়ের পরামর্শ নেই।'}</p>}</section>}
      {mode === 'digest' && projection.previous && <section className={`${card} space-y-4`}><h2 className="text-sm font-semibold">{en?'Period summary':'সময়ের সারাংশ'}</h2><p className="text-xs text-slate-600">{from} — {to} · {number(projection.report.entries.length)} {en?'entries':'লেনদেন'}</p><p className="text-xs text-slate-500">{en?'Compared with equal-length prior period: ':'আগের সমান দৈর্ঘ্যের সময়ের তুলনা: '}{projection.previous.from} — {projection.previous.to}</p><dl className="space-y-3 text-xs">{[[en?'Income change':'আয়ের পরিবর্তন',(BigInt(projection.report.incomeMinor)-BigInt(projection.previous.incomeMinor)).toString()],[en?'Expense change':'খরচের পরিবর্তন',(BigInt(projection.report.expenseMinor)-BigInt(projection.previous.expenseMinor)).toString()]].map(([label,amount])=><div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="font-semibold tabular-nums">{money(amount)}</dd></div>)}</dl>{projection.report.categories[0] && <p className="text-xs leading-relaxed text-slate-700">{en?'Largest spending category: ':'সবচেয়ে বেশি খরচের খাত: '}{categoryNames.get(projection.report.categories[0].id) || (en?'Other':'অন্যান্য')} · {money(projection.report.categories[0].amountMinor)}</p>}</section>}
      {mode==='digest' && guideInput && <FinancialGuidePanel key={`${db.getIdentity()?.ownerSubjectHash}:${guideInputHash(guideInput)}`} input={guideInput}/>}
    </>}
  </div>;
}
