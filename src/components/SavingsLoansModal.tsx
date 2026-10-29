import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, HandCoins, Plus } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatBDT, parsePaisaString } from '../domain/money';
import { generateUUID } from '../domain/journal';
import type { NewSavingsLoan, SavingsLoanRow } from '../storage/loanBook';
import { loanToday } from '../storage/loanBook';
import { AppDateInput } from './AppDateInput';
import { AppSelect } from './AppSelect';
import { fieldClass, ModalShell, primaryButton, secondaryButton } from './ModalShell';

type Draft = { id: string; goalId: string; sourceId: string; borrowerId: string; purpose: string; amount: string; rate: string; due: string; order: 'principal-first' | 'interest-first'; autoRepay: boolean };
function loanError(error: unknown, en: boolean): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'LOAN_EXECUTOR_REQUIRED') return en ? 'Repay from the device where this loan was created. Other devices can view it.' : 'যে ডিভাইসে ঋণটি তৈরি করেছেন, সেখান থেকে পরিশোধ করুন। অন্য ডিভাইসে হিসাব দেখা যাবে।';
  if (code === 'LOAN_INSUFFICIENT_RESERVED') return en ? 'This goal does not have enough reserved money in the selected wallet.' : 'নির্বাচিত ওয়ালেটে এই লক্ষ্যের জন্য পর্যাপ্ত টাকা সংরক্ষিত নেই।';
  if (code === 'LOAN_INSUFFICIENT_AVAILABLE') return en ? 'There is not enough spendable money. Other goals’ money stays protected.' : 'পর্যাপ্ত খরচযোগ্য টাকা নেই। অন্য লক্ষ্যের টাকা সংরক্ষিত থাকবে।';
  if (code === 'LOAN_SYNC_INCOMPLETE') return en ? 'Related records are still syncing. Finish sync before continuing.' : 'সংশ্লিষ্ট তথ্য এখনও সিঙ্ক হচ্ছে। সিঙ্ক শেষ হলে আবার চেষ্টা করুন।';
  if (code === 'LOAN_OWNER_MISMATCH' || code === 'LOAN_CONTEXT_CHANGED') return en ? 'Your account or workspace changed. Close and reopen this screen.' : 'ব্যবহারকারী বা খাতা বদলেছে। এই স্ক্রিন বন্ধ করে আবার খুলুন।';
  if (code === 'LOAN_GOAL_UNAVAILABLE' || code === 'LOAN_WALLET_UNAVAILABLE') return en ? 'The goal or wallet is unavailable. Restore it before continuing.' : 'লক্ষ্য বা ওয়ালেটটি এখন ব্যবহার করা যাচ্ছে না। আগে সেটি ফিরিয়ে আনুন।';
  if (code === 'LOAN_OVERPAYMENT') return en ? 'The amount is greater than the remaining debt.' : 'পরিমাণটি বকেয়া ঋণের চেয়ে বেশি।';
  return en ? 'Could not save. Check the amount, due date, monthly rate and purpose. Your draft is kept.' : 'সেভ হয়নি। পরিমাণ, ফেরতের তারিখ, মাসিক হার ও উদ্দেশ্য দেখুন। আপনার খসড়া রাখা আছে।';
}

export function SavingsLoansModal({ onClose, initialGoalId }: { onClose: () => void; initialGoalId?: string }) {
  const { db, currentWorkspace, language, refreshState, userProfile } = useApp();
  const en = language === 'en', money = (minor: string) => formatBDT(minor, { locale: language });
  const opened = useRef({ db, ws: currentWorkspace?.id, owner: db.getIdentity()?.ownerSubjectHash, subject: userProfile?.subjectHash });
  const latest = useRef({ db, ws: currentWorkspace?.id, subject: userProfile?.subjectHash, refreshState });
  latest.current = { db, ws: currentWorkspace?.id, subject: userProfile?.subjectHash, refreshState };
  const mounted = useRef(true), saving = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [repay, setRepay] = useState<{ loanId: string; requestId: string; amount: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sameContext = () => opened.current.db === latest.current.db && opened.current.ws === latest.current.ws &&
    opened.current.owner === db.getIdentity()?.ownerSubjectHash && opened.current.subject === latest.current.subject;
  const stale = !sameContext(), day = loanToday();
  let rows: SavingsLoanRow[] = [], goals: ReturnType<typeof db.getSavingsProjection>['goals'] = [], readFailed = false;
  try { if (!stale && opened.current.ws) {
    rows = db.getSavingsLoans(opened.current.ws, day);
    goals = db.getSavingsProjection(opened.current.ws).goals.filter(g => !g.deleted && !g.goal.archived);
  } } catch { readFailed = true; }
  const owner = opened.current.owner;
  const borrowers = db.getWorkspaces().filter(ws => ws.ownerSubjectHash === owner && ws.kind === 'business')
    .flatMap(ws => db.getAccounts(ws.id).filter(a => (a.classification || 'asset') === 'asset').map(account => ({ workspace: ws, account })));
  const sourceGoal = goals.find(g => g.goal.id === draft?.goalId);
  const sources = sourceGoal?.contributions.filter(c => BigInt(c.fundedMinor) > 0n && !db.getAccount(c.accountId)?.archivedAt) || [];
  const sourceIds = [...new Set(sources.map(c => c.accountId))];
  const reserved = (accountId: string) => sources.filter(c => c.accountId === accountId).reduce((sum, c) => sum + BigInt(c.fundedMinor), 0n).toString();
  const disabled = stale || busy || readFailed || !owner;

  async function commit(action: () => Promise<unknown>, done: () => void) {
    if (saving.current) return;
    if (!sameContext()) { setError(loanError(new Error('LOAN_CONTEXT_CHANGED'), en)); return; }
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await action(); latest.current.refreshState();
      if (mounted.current) { done(); setNotice(en ? 'Saved. Principal and interest are recorded separately.' : 'সেভ হয়েছে। মূলধন ও সুদের হিসাব আলাদা রাখা হয়েছে।'); }
    } catch (failure) { if (mounted.current) setError(loanError(failure, en)); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }

  function newLoan() {
    setRepay(null); setError(''); setNotice('');
    const goal = goals.find(g => g.goal.id === initialGoalId) || goals.find(g => BigInt(g.fundedMinor) > 0n) || goals[0];
    const sourceId = goal?.contributions.find(c => BigInt(c.fundedMinor) > 0n)?.accountId || '';
    setDraft({ id: generateUUID(), goalId: goal?.goal.id || '', sourceId,
      borrowerId: borrowers.find(b => b.account.id !== sourceId)?.account.id || '', purpose: '', amount: '', rate: '', due: '', order: 'principal-first', autoRepay: true });
  }
  function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || disabled || !opened.current.ws) return;
    const value = draft;
    void commit(async () => {
      const borrower = borrowers.find(b => b.account.id === value.borrowerId);
      const principal = parsePaisaString(value.amount), rate = parsePaisaString(value.rate);
      if (!value.rate.trim() || principal <= 0n || rate < 0n || rate > 1_000_000n || !borrower) throw new Error('LOAN_INVALID_INPUT');
      const intent: NewSavingsLoan = { id: value.id, goalId: value.goalId, sourceWorkspaceId: opened.current.ws!, sourceAccountId: value.sourceId,
        borrowerWorkspaceId: borrower.workspace.id, borrowerAccountId: borrower.account.id, principalMinor: principal.toString(), dueDate: value.due,
        monthlyRateBps: Number(rate), repaymentOrder: value.order, purpose: value.purpose, autoRepay: value.autoRepay };
      await db.issueSavingsLoan(intent);
    }, () => setDraft(null));
  }

  return <ModalShell title={en ? 'Business loans from savings' : 'সঞ্চয় থেকে ব্যবসার ঋণ'} description={currentWorkspace?.name}
    icon={<HandCoins className="h-5 w-5" />} onClose={onClose} busy={busy}>
    <div className="space-y-4">
      <p className="rounded-2xl bg-blue-50 p-4 text-xs leading-relaxed text-slate-700">{en ? 'Lend reserved money to a business wallet. Repaid principal returns to the original goal. Interest is separate; no interest on interest.' : 'লক্ষ্যে রাখা টাকা ব্যবসার ওয়ালেটে ঋণ দিন। ফেরত পাওয়া মূলধন আগের লক্ষ্যেই সংরক্ষিত হবে। সুদের হিসাব আলাদা; সুদের ওপর সুদ নেই।'}</p>
      <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{en ? 'Automatic repayment runs on the original device while open, after verified sync, from 7 PM Bangladesh time on the due date. Later available money can repay the remainder after sync. Closed-app push reminders are not connected yet.' : 'ফেরতের দিন বাংলাদেশ সময় সন্ধ্যা ৭টা থেকে ঋণ তৈরির ডিভাইসে অ্যাপ খোলা ও সফল সিঙ্কের পরে অটো পরিশোধ হবে। পরে টাকা এলে সিঙ্কের পরে বাকি অংশও পরিশোধ হবে। বন্ধ অ্যাপের পুশ রিমাইন্ডার এখনও সংযুক্ত হয়নি।'}</p>
      {(error || stale || readFailed || !owner) && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs leading-relaxed text-rose-800">{error || (stale ? loanError(new Error('LOAN_CONTEXT_CHANGED'), en) : !owner ? en ? 'Connect your Google account before creating a loan.' : 'ঋণ তৈরি করার আগে গুগল অ্যাকাউন্ট সংযুক্ত করুন।' : en ? 'Loan records could not be read. Existing records are kept.' : 'ঋণের তথ্য পড়া যায়নি। আগের হিসাব রাখা আছে।')}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}
      {!draft && <button type="button" className={primaryButton} disabled={disabled} onClick={newLoan}><Plus className="h-4 w-4" />{en ? 'New loan' : 'নতুন ঋণ'}</button>}
      {draft && <form onSubmit={save} className="space-y-3 rounded-2xl border border-slate-200 p-4">
        <label className="block text-xs font-medium">{en ? 'Savings goal' : 'সঞ্চয়ের লক্ষ্য'}<AppSelect required className={fieldClass} disabled={disabled} value={draft.goalId} onChange={e => setDraft({ ...draft, goalId: e.target.value, sourceId: '' })}><option value="">{en ? 'Choose goal' : 'লক্ষ্য বেছে নিন'}</option>{goals.map(g => <option key={g.goal.id} value={g.goal.id}>{g.goal.name} · {money(g.fundedMinor)}</option>)}</AppSelect></label>
        <label className="block text-xs font-medium">{en ? 'Savings wallet' : 'কোন ওয়ালেটের সঞ্চয়'}<AppSelect required className={fieldClass} disabled={disabled} value={draft.sourceId} onChange={e => setDraft({ ...draft, sourceId: e.target.value })}><option value="">{en ? 'Choose wallet' : 'ওয়ালেট বেছে নিন'}</option>{sourceIds.map(id => <option key={id} value={id}>{db.getAccount(id)?.name} · {money(reserved(id))}</option>)}</AppSelect></label>
        <label className="block text-xs font-medium">{en ? 'Business receiving the loan' : 'কোন ব্যবসার ওয়ালেটে যাবে'}<AppSelect required className={fieldClass} disabled={disabled} value={draft.borrowerId} onChange={e => setDraft({ ...draft, borrowerId: e.target.value })}><option value="">{en ? 'Choose business wallet' : 'ব্যবসার ওয়ালেট বেছে নিন'}</option>{borrowers.filter(b => b.account.id !== draft.sourceId).map(b => <option key={b.account.id} value={b.account.id}>{b.workspace.name} · {b.account.name}</option>)}</AppSelect></label>
        {!borrowers.length && <p className="text-xs text-amber-900">{en ? 'Create a business workspace and wallet first.' : 'আগে একটি ব্যবসার খাতা ও ওয়ালেট তৈরি করুন।'}</p>}
        <label className="block text-xs font-medium">{en ? 'Purpose' : 'ঋণের উদ্দেশ্য'}<input required maxLength={120} className={fieldClass} disabled={disabled} value={draft.purpose} onChange={e => setDraft({ ...draft, purpose: e.target.value })} /></label>
        <label className="block text-xs font-medium">{en ? 'Loan amount · BDT' : 'ঋণের পরিমাণ · টাকা'}<input required inputMode="decimal" className={fieldClass} disabled={disabled} value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} /></label>
        <AppDateInput label={en ? 'Repayment date' : 'ফেরতের তারিখ'} language={language} value={draft.due} disabled={disabled} onChange={due => setDraft({ ...draft, due })} />
        <label className="block text-xs font-medium">{en ? 'Monthly simple interest · %' : 'মাসিক সরল সুদের হার · %'}<input required inputMode="decimal" className={fieldClass} disabled={disabled} placeholder={en ? 'Enter rate; 0 means no interest' : 'হার লিখুন; সুদ না থাকলে ০'} value={draft.rate} onChange={e => setDraft({ ...draft, rate: e.target.value })} /></label>
        <p className="text-xs leading-relaxed text-slate-500">{en ? 'After due: unpaid principal × monthly rate ÷ 30 per late day. Repayment-day interest is calculated before repayment; fractions round down to paisa.' : 'মেয়াদ পেরোলে প্রতিদিন: বকেয়া মূলধন × মাসিক হার ÷ ৩০। পরিশোধের দিনের সুদ আগে হিসাব হবে; পয়সার ভগ্নাংশ নিচের পূর্ণ পয়সায় নামবে।'}</p>
        <label className="block text-xs font-medium">{en ? 'Apply repayments to' : 'পরিশোধের টাকা আগে কোথায় যাবে'}<AppSelect className={fieldClass} disabled={disabled} value={draft.order} onChange={e => setDraft({ ...draft, order: e.target.value as Draft['order'] })}><option value="principal-first">{en ? 'Principal first, then interest' : 'আগে মূলধন, পরে সুদ'}</option><option value="interest-first">{en ? 'Interest first, then principal' : 'আগে সুদ, পরে মূলধন'}</option></AppSelect></label>
        <label className="flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-xs leading-relaxed"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" disabled={disabled} checked={draft.autoRepay} onChange={e => setDraft({ ...draft, autoRepay: e.target.checked })} />{en ? 'Enable automatic partial repayment from this business wallet after sync on this device, starting at 7 PM on the due date. Other goals stay protected.' : 'ফেরতের দিন সন্ধ্যা ৭টা থেকে এই ডিভাইসে সিঙ্কের পরে ব্যবসার এই ওয়ালেট দিয়ে অটো আংশিক পরিশোধ চালু রাখুন। অন্য লক্ষ্যের টাকা অক্ষত থাকবে।'}</label>
        <div className="flex gap-2"><button type="submit" disabled={disabled || !sourceIds.length || !borrowers.length || !draft.due} className={primaryButton}>{en ? 'Record loan' : 'ঋণ সেভ করুন'}</button><button type="button" disabled={busy} className={secondaryButton} onClick={() => setDraft(null)}>{en ? 'Cancel' : 'বাতিল'}</button></div>
      </form>}
      {rows.length === 0 && !draft && <p className="py-5 text-center text-xs text-slate-500">{en ? 'No loans in this workspace yet.' : 'এই খাতায় এখনও কোনো ঋণ নেই।'}</p>}
      {rows.map(row => {
        const t = row.issue.terms, b = row.balance;
        const onExecutor = row.issue.executorDeviceId === db.getDeviceId();
        return <section key={t.id} className="space-y-3 rounded-2xl border border-slate-200 p-4">
          <div className="flex justify-between gap-3"><h3 className="text-sm font-bold break-words">{row.issue.purpose}</h3><span className="text-xs font-semibold text-slate-500">{b.status === 'paid' ? en ? 'Paid' : 'পরিশোধিত' : b.status === 'overdue' ? en ? 'Overdue' : 'মেয়াদ পেরিয়েছে' : en ? 'Open' : 'চলমান'}</span></div>
          <p className="text-xs text-slate-500">{db.getWorkspace(t.sourceWorkspaceId)?.name} → {db.getWorkspace(t.borrowerWorkspaceId)?.name}</p>
          <dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="text-slate-500">{en ? 'Principal still owed' : 'মূলধন ফেরত বাকি'}</dt><dd className="mt-1 font-bold">{money(b.principalOutstandingMinor)}</dd></div><div><dt className="text-slate-500">{en ? 'Interest still owed' : 'সুদ ফেরত বাকি'}</dt><dd className="mt-1 font-bold">{money(b.interestOutstandingMinor)}</dd></div><div><dt className="text-slate-500">{en ? 'Returned principal' : 'ফেরত পাওয়া মূলধন'}</dt><dd className="mt-1 font-bold text-emerald-700">{money(b.principalRepaidMinor)}</dd></div><div><dt className="text-slate-500">{en ? 'Due date' : 'ফেরতের তারিখ'}</dt><dd className="mt-1 font-semibold">{t.dueDate}</dd></div></dl>
          <p className="text-xs text-slate-500">{en ? 'Monthly rate' : 'মাসিক হার'}: {(t.monthlyRateBps / 100).toLocaleString(en ? 'en-GB' : 'bn-BD')}% · {t.repaymentOrder === 'principal-first' ? en ? 'Principal first' : 'আগে মূলধন' : en ? 'Interest first' : 'আগে সুদ'}</p>
          <p className="text-xs text-slate-500">{en ? 'Automatic repayment' : 'অটো পরিশোধ'}: {row.autoRepayEnabled ? en ? 'Enabled on original device after sync' : 'তৈরির ডিভাইসে সিঙ্কের পরে চালু' : en ? 'Off' : 'বন্ধ'}</p>
          {b.status !== 'paid' && <button type="button" className={secondaryButton} disabled={disabled || (!row.autoRepayEnabled && !onExecutor)} onClick={() => void commit(() => db.setLoanAutoRepayment(t.id, !row.autoRepayEnabled), () => {})}>{row.autoRepayEnabled ? en ? 'Turn off automatic repayment' : 'অটো পরিশোধ বন্ধ করুন' : en ? 'Enable automatic repayment' : 'অটো পরিশোধ চালু করুন'}</button>}
          {row.pendingReferences > 0 && <p role="status" className="text-xs text-amber-900">{loanError(new Error('LOAN_SYNC_INCOMPLETE'), en)}</p>}
          {!onExecutor && b.status !== 'paid' && <p className="text-xs text-slate-500">{loanError(new Error('LOAN_EXECUTOR_REQUIRED'), en)}</p>}
          {b.status !== 'paid' && <button type="button" className={primaryButton} disabled={disabled || !onExecutor || row.pendingReferences > 0} onClick={() => { setDraft(null); setError(''); setNotice(''); setRepay({ loanId: t.id, requestId: generateUUID(), amount: '' }); }}><ArrowDownLeft className="h-4 w-4" />{en ? 'Repay' : 'পরিশোধ করুন'}</button>}
          {repay?.loanId === t.id && <form className="space-y-3 rounded-xl bg-slate-50 p-3" onSubmit={event => { event.preventDefault(); const value = repay; void commit(() => db.repaySavingsLoan(value.loanId, value.requestId, value.amount.trim() ? parsePaisaString(value.amount).toString() : undefined), () => setRepay(null)); }}>
            <p className="text-xs leading-relaxed text-slate-600">{en ? 'Pay from the designated business wallet. Leave blank to repay as much spendable money as possible, up to the debt. Other savings stay protected.' : 'নির্ধারিত ব্যবসার ওয়ালেট থেকে পরিশোধ হবে। খালি রাখলে বকেয়ার সীমার মধ্যে যত খরচযোগ্য টাকা আছে তত পরিশোধ হবে। অন্য সঞ্চয় অক্ষত থাকবে।'}</p>
            <label className="block text-xs font-medium">{en ? 'Amount · optional' : 'পরিমাণ · ঐচ্ছিক'}<input inputMode="decimal" className={fieldClass} disabled={disabled} value={repay.amount} onChange={e => setRepay({ ...repay, amount: e.target.value })} /></label>
            <div className="flex gap-2"><button type="submit" className={primaryButton} disabled={disabled}>{en ? 'Save repayment' : 'পরিশোধ সেভ করুন'}</button><button type="button" disabled={busy} className={secondaryButton} onClick={() => setRepay(null)}>{en ? 'Cancel' : 'বাতিল'}</button></div>
          </form>}
          {!!b.payments.length && <details className="text-xs"><summary className="cursor-pointer font-semibold text-slate-600">{en ? 'Repayment history' : 'পরিশোধের ইতিহাস'}</summary><ul className="mt-2 space-y-2">{b.payments.map(p => <li key={p.id} className="rounded-xl bg-slate-50 p-3">{p.effectiveDate} · {money(p.amountMinor)}<p className="mt-1 text-slate-500">{en ? 'Principal' : 'মূলধন'} {money(p.principalMinor)} · {en ? 'Interest' : 'সুদ'} {money(p.interestMinor)}</p></li>)}</ul></details>}
        </section>;
      })}
    </div>
  </ModalShell>;
}
