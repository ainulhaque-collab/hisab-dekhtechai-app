import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Archive, ArrowDownLeft, Plus, ShieldCheck, Target, Trash2, Wallet } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatAccountTitle, formatBDT, fromBengaliDigits, paisaToDecimalString, parsePaisaString, toBengaliDigits } from '../domain/money';
import type { SavingsGoal, SavingsProjection } from '../domain/savingsGoals';
import { AppSelect } from './AppSelect';
import { AppDateInput } from './AppDateInput';
import { fieldClass, ModalShell, primaryButton, secondaryButton } from './ModalShell';

type GoalForm = {
  id?: string;
  name: string;
  kind: 'general' | 'emergency';
  target: string;
  deadline: string;
  monthly: string;
  essential: string;
  months: string;
};
const blankGoal = (): GoalForm => ({ name: '', kind: 'general', target: '', deadline: '', monthly: '', essential: '', months: '3' });

function errorMessage(error: unknown, en: boolean): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'SAVINGS_CONTEXT_CHANGED') return en ? 'Your workspace or account changed. Close and reopen Goals before continuing.' : 'খাতা বা ব্যবহারকারী বদলেছে। লক্ষ্য বন্ধ করে আবার খুলুন।';
  if (code === 'SAVINGS_OWNER_MISMATCH' || code === 'SAVINGS_WORKSPACE_UNAVAILABLE') return en ? 'This workspace is no longer available for this account. Close and reopen Goals.' : 'এই ব্যবহারকারীর জন্য খাতাটি আর উপলব্ধ নেই। লক্ষ্য বন্ধ করে আবার খুলুন।';
  if (code === 'SAVINGS_NAME_REQUIRED') return en ? 'Enter a goal name.' : 'লক্ষ্যের নাম লিখুন।';
  if (code === 'SAVINGS_INVALID_AMOUNT') return en ? 'Enter a positive amount with at most two decimal places.' : 'শূন্যের বেশি টাকার পরিমাণ লিখুন, দশমিকের পরে সর্বোচ্চ দুই ঘর।';
  if (code === 'SAVINGS_INVALID_MONTHS') return en ? 'Choose between 1 and 24 months of essential expenses.' : 'প্রয়োজনীয় খরচের জন্য ১ থেকে ২৪ মাস বেছে নিন।';
  if (code === 'SAVINGS_ACCOUNT_REQUIRED') return en ? 'Choose an active wallet to reserve money from.' : 'টাকা আলাদা রাখার জন্য একটি সক্রিয় ওয়ালেট বেছে নিন।';
  if (code === 'SAVINGS_INSUFFICIENT_AVAILABLE') return en ? 'This wallet does not have enough unreserved money. Check its available balance and try a smaller amount.' : 'এই ওয়ালেটে পর্যাপ্ত অব্যবহৃত টাকা নেই। উপলব্ধ ব্যালান্স দেখে কম টাকা দিন।';
  if (code === 'SAVINGS_ACCOUNT_UNAVAILABLE') return en ? 'This wallet is no longer available for new reservations. Choose another active wallet.' : 'এই ওয়ালেটে নতুন বরাদ্দ রাখা যাচ্ছে না। অন্য সক্রিয় ওয়ালেট বেছে নিন।';
  if (code === 'SAVINGS_ALLOCATIONS_REMAIN') return en ? 'Release this goal’s remaining reservations first.' : 'আগে এই লক্ষ্যের জন্য বাকি আলাদা রাখা টাকা ছাড়ুন।';
  if (code === 'SAVINGS_DELETE_CONFIRMATION') return en ? 'Type exactly DELETE to delete this goal.' : 'লক্ষ্যটি মুছতে হুবহু DELETE লিখুন।';
  if (code === 'SAVINGS_ARCHIVE_BEFORE_DELETE') return en ? 'Archive the goal before deleting it.' : 'মুছে দেওয়ার আগে লক্ষ্যটি আর্কাইভ করুন।';
  if (code === 'SAVINGS_GOAL_DELETED') return en ? 'This goal was already deleted. Its transaction history is kept.' : 'লক্ষ্যটি ইতিমধ্যে মুছে দেওয়া হয়েছে। লেনদেনের ইতিহাস রাখা আছে।';
  if (code === 'SAVINGS_GOAL_ARCHIVED' || code === 'SAVINGS_GOAL_NOT_FOUND') return en ? 'This goal has changed or was archived. Check the latest goal list before continuing.' : 'লক্ষ্যটি বদলেছে বা আর্কাইভ হয়েছে। চালিয়ে যাওয়ার আগে সর্বশেষ তালিকা দেখুন।';
  if (code === 'SAVINGS_RELEASE_EXCEEDS_ALLOCATION') return en ? 'Some of this money was already released on another device. Check the updated history and try again.' : 'এই টাকার কিছু অংশ অন্য ডিভাইসে ইতিমধ্যে ছাড়া হয়েছে। হালনাগাদ ইতিহাস দেখে আবার চেষ্টা করুন।';
  if (code === 'SAVINGS_SYNC_INCOMPLETE') return en ? 'Wait for the related savings records to finish syncing before reserving more money.' : 'আরও টাকা আলাদা রাখার আগে সংশ্লিষ্ট সঞ্চয়ের তথ্য সিঙ্ক হয়ে আসা পর্যন্ত অপেক্ষা করুন।';
  if (code === 'SAVINGS_INVALID_EVENT' || code === 'SAVINGS_EVENT_INVALID') return en ? 'Check the name, amount, date and note, then try again. Your draft is kept.' : 'নাম, টাকার পরিমাণ, তারিখ ও নোট দেখে আবার চেষ্টা করুন। আপনার খসড়া রাখা আছে।';
  if (code.includes('CONFLICT') || code.includes('REVISION')) return en ? 'This goal changed during sync. Check its latest details and try again; your draft is kept.' : 'সিঙ্কের সময় লক্ষ্যটি বদলেছে। সর্বশেষ তথ্য দেখে আবার চেষ্টা করুন; আপনার খসড়া রাখা আছে।';
  return en ? 'This change could not be saved. Your existing records and draft are kept. Please try again.' : 'পরিবর্তনটি সেভ হয়নি। আগের হিসাব ও আপনার খসড়া রাখা আছে। আবার চেষ্টা করুন।';
}

function positiveAmount(value: string): string {
  try {
    const amount = parsePaisaString(value);
    if (amount <= 0n || amount > 999999999999999999n) throw new Error();
    return amount.toString();
  } catch { throw new Error('SAVINGS_INVALID_AMOUNT'); }
}

export function SavingsGoalsModal({ onClose }: { onClose: () => void }) {
  const { db, currentWorkspace, accounts, language, refreshState, userProfile } = useApp();
  const en = language === 'en';
  const money = (amount: string) => formatBDT(amount, { locale: language });
  const opened = useRef({ db, workspaceId: currentWorkspace?.id, owner: db.getIdentity()?.ownerSubjectHash, profile: userProfile?.subjectHash });
  const latest = useRef({ db, workspaceId: currentWorkspace?.id, profile: userProfile?.subjectHash, refreshState });
  latest.current = { db, workspaceId: currentWorkspace?.id, profile: userProfile?.subjectHash, refreshState };
  const mounted = useRef(true);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [, redraw] = useState(0);
  const [archived, setArchived] = useState(false);
  const [form, setForm] = useState<GoalForm | null>(null);
  const [allocateTo, setAllocateTo] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [deleteGoalId, setDeleteGoalId] = useState<string | null>(null);
  const [deleteText, setDeleteText] = useState('');
  const deleteInput = useRef<HTMLInputElement>(null);
  const allocationHintId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (deleteGoalId) deleteInput.current?.focus(); }, [deleteGoalId]);

  const sameContext = () => !!opened.current.workspaceId && opened.current.db === latest.current.db
    && opened.current.workspaceId === latest.current.workspaceId
    && opened.current.owner === opened.current.db.getIdentity()?.ownerSubjectHash
    && opened.current.profile === latest.current.profile;
  const stale = !sameContext();
  let projection: SavingsProjection | null = null;
  try { if (!stale) projection = db.getSavingsProjection(opened.current.workspaceId!); } catch { /* Show a safe read failure below. */ }
  const rows = projection?.goals.filter(row => !row.deleted && row.goal.archived === archived) || [];
  const availableAccounts = accounts.filter(account => account.workspaceId === opened.current.workspaceId && !account.archivedAt && (!account.classification || account.classification === 'asset'));
  const accountName = (id: string) => {
    const account = db.getAccount(id);
    return account ? formatAccountTitle(account.name, language) : en ? 'Previous wallet' : 'আগের ওয়ালেট';
  };
  const available = (id: string) => projection?.accounts.find(account => account.accountId === id)?.availableMinor || '0';
  const disabled = busy || stale || !projection;
  const syncIncomplete = !!projection && (projection.orphanAllocationCount > 0 || projection.orphanReleaseCount > 0);
  const allocationDisabled = disabled || syncIncomplete;
  const selectedWallet = projection?.accounts.find(account => account.accountId === accountId);
  const walletAvailable = selectedWallet?.availableMinor || '0';
  let allocationAmount: string | null = null;
  try { if (amount.trim()) allocationAmount = positiveAmount(amount); } catch { /* Keep incomplete input editable. */ }
  let allocationIssue = '';
  if (!availableAccounts.some(account => account.id === accountId)) {
    allocationIssue = errorMessage(new Error('SAVINGS_ACCOUNT_REQUIRED'), en);
  } else if (BigInt(walletAvailable) === 0n) {
    allocationIssue = BigInt(selectedWallet?.balanceMinor || '0') <= 0n
      ? en ? 'This wallet has a zero or negative balance. Choose a wallet with money, or record money actually received before setting it aside.' : 'এই ওয়ালেটের ব্যালান্স শূন্য বা ঋণাত্মক। টাকা আছে এমন ওয়ালেট বেছে নিন, অথবা বাস্তবে পাওয়া টাকা আগে হিসাবে যোগ করুন।'
      : en ? 'All money in this wallet is already set aside. Release an existing reservation or choose another wallet.' : 'এই ওয়ালেটের সব টাকা ইতিমধ্যে লক্ষ্যে আলাদা রাখা আছে। আগের বরাদ্দ ছাড়ুন অথবা অন্য ওয়ালেট বেছে নিন।';
  } else if (amount.trim() && !allocationAmount) {
    allocationIssue = errorMessage(new Error('SAVINGS_INVALID_AMOUNT'), en);
  } else if (allocationAmount && BigInt(allocationAmount) > BigInt(walletAvailable)) {
    allocationIssue = en ? `You can set aside up to ${money(walletAvailable)} from this wallet. Enter a smaller amount or choose another wallet.` : `এই ওয়ালেট থেকে সর্বোচ্চ ${money(walletAvailable)} আলাদা রাখা যাবে। কম টাকা লিখুন অথবা অন্য ওয়ালেট বেছে নিন।`;
  }
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dateLabel = (value: string) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(en ? 'en-GB' : 'bn-BD');
  };

  async function commit(operation: () => Promise<unknown>, after?: () => void, successNotice?: string) {
    if (locked.current) return;
    if (!sameContext()) { setError(errorMessage(new Error('SAVINGS_CONTEXT_CHANGED'), en)); return; }
    locked.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      await operation();
      latest.current.refreshState();
      if (!mounted.current) return;
      redraw(value => value + 1);
      if (!sameContext()) {
        setNotice(en ? 'The change was saved in the original workspace. Close and reopen Goals to view your current workspace.' : 'পরিবর্তনটি আগের খাতায় সেভ হয়েছে। বর্তমান খাতা দেখতে লক্ষ্য বন্ধ করে আবার খুলুন।');
        return;
      }
      after?.();
      setNotice(successNotice || (en ? 'Saved. Your wallet balance and income/expense totals are unchanged.' : 'সেভ হয়েছে। ওয়ালেটের ব্যালান্স ও আয়-ব্যয়ের মোট পরিমাণ বদলায়নি।'));
    } catch (failure) {
      if (mounted.current) { redraw(value => value + 1); setError(errorMessage(failure, en)); }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function edit(goal: SavingsGoal) {
    setDeleteGoalId(null); setDeleteText('');
    setAllocateTo(null); setError(''); setNotice('');
    setForm({ id: goal.id, name: goal.name, kind: goal.kind, target: paisaToDecimalString(goal.targetMinor), deadline: goal.deadline || '',
      monthly: goal.monthlyContributionMinor ? paisaToDecimalString(goal.monthlyContributionMinor) : '',
      essential: goal.essentialMonthlyMinor ? paisaToDecimalString(goal.essentialMonthlyMinor) : '', months: String(goal.coverageMonths || 3) });
  }

  function saveGoal(event: React.FormEvent) {
    event.preventDefault();
    if (!form || disabled) return;
    const draft = form;
    void commit(async () => {
      const name = draft.name.trim();
      if (!name) throw new Error('SAVINGS_NAME_REQUIRED');
      const months = Number(fromBengaliDigits(draft.months));
      if (draft.kind === 'emergency' && (!Number.isInteger(months) || months < 1 || months > 24)) throw new Error('SAVINGS_INVALID_MONTHS');
      const essentialMonthlyMinor = draft.kind === 'emergency' ? positiveAmount(draft.essential) : undefined;
      const targetMinor = essentialMonthlyMinor ? (BigInt(essentialMonthlyMinor) * BigInt(months)).toString() : positiveAmount(draft.target);
      if (BigInt(targetMinor) > 999999999999999999n) throw new Error('SAVINGS_INVALID_AMOUNT');
      return db.saveSavingsGoal(opened.current.workspaceId!, { id: draft.id, name, kind: draft.kind, targetMinor,
        deadline: draft.deadline || undefined, monthlyContributionMinor: draft.monthly.trim() ? positiveAmount(draft.monthly) : undefined,
        essentialMonthlyMinor, coverageMonths: draft.kind === 'emergency' ? months : undefined });
    }, () => setForm(null));
  }

  function allocate(event: React.FormEvent) {
    event.preventDefault();
    if (!allocateTo || allocationDisabled || allocationIssue || !allocationAmount) return;
    const goalId = allocateTo;
    const amountMinor = allocationAmount;
    void commit(async () => {
      if (!availableAccounts.some(account => account.id === accountId)) throw new Error('SAVINGS_ACCOUNT_REQUIRED');
      return db.allocateSavingsGoal(opened.current.workspaceId!, goalId, accountId, amountMinor, note.trim() || undefined);
    }, () => { setAllocateTo(null); setAmount(''); setNote(''); });
  }

  const patch = (value: Partial<GoalForm>) => setForm(previous => previous ? { ...previous, ...value } : previous);
  let emergencyTarget: string | null = null;
  if (form?.kind === 'emergency') {
    try {
      const months = Number(fromBengaliDigits(form.months));
      if (Number.isInteger(months) && months >= 1 && months <= 24) emergencyTarget = (BigInt(positiveAmount(form.essential)) * BigInt(months)).toString();
    } catch { /* Incomplete amount stays editable. */ }
  }

  return <ModalShell title={en ? 'Savings goals' : 'সঞ্চয়ের লক্ষ্য'} description={currentWorkspace?.name}
    icon={<Target className="h-5 w-5" />} onClose={onClose} busy={busy}>
    <div className="space-y-4">
      <p className="rounded-2xl bg-blue-50 p-3.5 text-xs leading-relaxed text-blue-900">
        {en ? 'Set aside money already in your wallets for a goal or emergency fund. This is a plan inside the app; it does not move money to a bank or create income or expenses.' : 'ওয়ালেটে থাকা টাকা লক্ষ্য বা জরুরি তহবিলের জন্য আলাদা রাখুন। এটি অ্যাপের ভেতরের পরিকল্পনা; ব্যাংকে টাকা জমা হয় না এবং আয়-ব্যয় তৈরি হয় না।'}
      </p>
      {(error || stale || !projection) && <div role="alert" className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs leading-relaxed text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>{error || (stale ? errorMessage(new Error('SAVINGS_CONTEXT_CHANGED'), en) : en ? 'Goals could not be loaded. Close and reopen this screen. Existing records are kept.' : 'লক্ষ্যগুলো লোড হয়নি। স্ক্রিনটি বন্ধ করে আবার খুলুন। আগের হিসাব রাখা আছে।')}</p></div>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-900">{notice}</p>}
      {syncIncomplete && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{en ? 'Some savings changes are waiting for matching records from sync. Let sync finish before reserving more money.' : 'সঞ্চয়ের কিছু পরিবর্তনের মিল থাকা তথ্য এখনও সিঙ্ক হয়ে আসেনি। আরও টাকা আলাদা রাখার আগে সিঙ্ক শেষ হতে দিন।'}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-xl bg-slate-100 p-1" role="group" aria-label={en ? 'Goal status' : 'লক্ষ্যের অবস্থা'}>
          {[false, true].map(value => <button key={String(value)} type="button" disabled={busy} aria-pressed={archived === value}
            className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${archived === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            onClick={() => { setArchived(value); setForm(null); setAllocateTo(null); setDeleteGoalId(null); setDeleteText(''); setError(''); }}>{value ? en ? 'Archived' : 'আর্কাইভ' : en ? 'Active' : 'চলমান'}</button>)}
        </div>
        <button type="button" disabled={disabled} className={primaryButton} onClick={() => { setArchived(false); setAllocateTo(null); setDeleteGoalId(null); setDeleteText(''); setForm(blankGoal()); setError(''); setNotice(''); }}><Plus className="h-4 w-4" />{en ? 'New goal' : 'নতুন লক্ষ্য'}</button>
      </div>

      {form && !stale && <form onSubmit={saveGoal} className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
        <h3 className="text-sm font-bold">{form.id ? en ? 'Edit goal' : 'লক্ষ্য সম্পাদনা' : en ? 'Create a goal' : 'লক্ষ্য তৈরি করুন'}</h3>
        <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
          <label className="block text-xs font-medium">{en ? 'Name' : 'নাম'}<input className={fieldClass} maxLength={80} required value={form.name} onChange={event => patch({ name: event.target.value })} placeholder={en ? 'Buy a car' : 'গাড়ি কেনা'} /></label>
          <label className="block text-xs font-medium">{en ? 'Goal type' : 'লক্ষ্যের ধরন'}<AppSelect className={fieldClass} disabled={disabled} value={form.kind} onChange={event => patch({ kind: event.target.value as GoalForm['kind'] })} aria-label={en ? 'Goal type' : 'লক্ষ্যের ধরন'}><option value="general">{en ? 'Savings goal' : 'সঞ্চয়ের লক্ষ্য'}</option><option value="emergency">{en ? 'Emergency fund' : 'জরুরি তহবিল'}</option></AppSelect></label>
          {form.kind === 'emergency' ? <>
            <label className="block text-xs font-medium">{en ? 'Essential monthly expenses (BDT)' : 'প্রয়োজনীয় মাসিক খরচ (টাকা)'}<input className={fieldClass} inputMode="decimal" required value={form.essential} onChange={event => patch({ essential: event.target.value })} placeholder="10000" /></label>
            <label className="block text-xs font-medium">{en ? 'Months to cover (1–24)' : 'কত মাসের খরচ (১–২৪)'}<input className={fieldClass} inputMode="numeric" required value={form.months} onChange={event => patch({ months: event.target.value })} /></label>
            <p className="text-xs font-semibold text-blue-800">{en ? 'Target: ' : 'লক্ষ্য: '}{emergencyTarget ? money(emergencyTarget) : '—'}</p>
          </> : <label className="block text-xs font-medium">{en ? 'Target amount (BDT)' : 'লক্ষ্যের পরিমাণ (টাকা)'}<input className={fieldClass} inputMode="decimal" required value={form.target} onChange={event => patch({ target: event.target.value })} placeholder="100000" /></label>}
          <label className="block text-xs font-medium">{en ? 'Target date · optional' : 'লক্ষ্যের তারিখ · ঐচ্ছিক'}<AppDateInput className={fieldClass} label={en ? 'Target date · optional' : 'লক্ষ্যের তারিখ · ঐচ্ছিক'} language={language} disabled={disabled} value={form.deadline} onChange={deadline => patch({ deadline })} /></label>
          <label className="block text-xs font-medium">{en ? 'Planned monthly savings (BDT) · optional' : 'মাসিক সঞ্চয়ের পরিকল্পনা (টাকা) · ঐচ্ছিক'}<input className={fieldClass} inputMode="decimal" value={form.monthly} onChange={event => patch({ monthly: event.target.value })} /></label>
          <p className="text-xs leading-relaxed text-slate-500">{en ? 'The monthly plan is a reminder only. Money is reserved when you add it from a wallet.' : 'মাসিক পরিকল্পনা শুধু মনে রাখার জন্য। ওয়ালেট থেকে যোগ করলেই টাকা আলাদা রাখা হবে।'}</p>
          <div className="flex gap-2"><button type="submit" disabled={disabled} className={`${primaryButton} flex-1`}>{busy ? en ? 'Saving…' : 'সেভ হচ্ছে…' : en ? 'Save goal' : 'লক্ষ্য সেভ করুন'}</button><button type="button" disabled={busy} className={secondaryButton} onClick={() => setForm(null)}>{en ? 'Cancel' : 'বাতিল'}</button></div>
        </fieldset>
      </form>}

      {rows.length === 0 && projection && <p className="py-7 text-center text-sm text-slate-500">{archived ? en ? 'No archived goals.' : 'কোনো আর্কাইভ লক্ষ্য নেই।' : en ? 'Create your first goal to start setting money aside.' : 'টাকা আলাদা রাখা শুরু করতে প্রথম লক্ষ্যটি তৈরি করুন।'}</p>}
      {rows.map(row => <section key={row.goal.id} className="space-y-3 rounded-2xl border border-slate-200 p-4">
        <div className="flex items-start gap-2"><span className={`rounded-xl p-2 ${row.goal.kind === 'emergency' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{row.goal.kind === 'emergency' ? <ShieldCheck className="h-4 w-4" /> : <Target className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-bold">{row.goal.name}</h3><p className="mt-1 text-xs text-slate-500">{en ? 'Target ' : 'লক্ষ্য '}{money(row.goal.targetMinor)}{row.goal.deadline && ` · ${dateLabel(row.goal.deadline)}`}</p></div></div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={row.goal.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, row.progressPercent))}><div className="h-full rounded-full bg-blue-600 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(0, Math.min(100, row.progressPercent))}%` }} /></div>
        <div className="grid grid-cols-2 gap-3 text-xs"><div><p className="text-slate-500">{en ? 'Funded' : 'আলাদা রাখা আছে'}</p><p className="mt-1 break-all text-base font-bold text-emerald-700">{money(row.fundedMinor)}</p></div><div><p className="text-slate-500">{en ? 'Still needed' : 'আরও প্রয়োজন'}</p><p className="mt-1 break-all text-base font-bold">{money(row.remainingMinor)}</p></div></div>
        {BigInt(row.shortfallMinor) > 0n && <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{row.goal.archived ? (en ? 'Archived goals do not reserve wallet money. Release the remaining reservations here, or restore the goal to fund it again.' : 'আর্কাইভ লক্ষ্য ওয়ালেটের টাকা আলাদা রাখে না। এখান থেকে বাকি বরাদ্দ ছাড়ুন, অথবা আবার বরাদ্দ রাখতে লক্ষ্যটি ফিরিয়ে আনুন।') : en ? `${money(row.shortfallMinor)} of the reserved money is no longer covered by the wallet balance. Spending or changes on another device can cause this. Release allocations or add money to the wallet.` : `আলাদা রাখা ${money(row.shortfallMinor)} এখন ওয়ালেটের ব্যালান্সে নেই। খরচ বা অন্য ডিভাইসের পরিবর্তনে এটি হতে পারে। বরাদ্দ ছাড়ুন অথবা ওয়ালেটে টাকা যোগ করুন।`}</p>}
        {row.recommendedMonthlyMinor !== null && (!row.goal.deadline || row.goal.deadline > today) && BigInt(row.remainingMinor) > 0n && <div className="text-xs leading-relaxed text-slate-600"><p>{en ? 'Calculated monthly savings: ' : 'হিসাব অনুযায়ী মাসিক সঞ্চয়: '}<strong>{money(row.recommendedMonthlyMinor)}</strong></p><p className="mt-1 text-slate-500">{en ? 'Divides the remaining target across this month and every calendar month through your target date.' : 'বাকি টাকাকে চলতি মাস থেকে লক্ষ্যের তারিখের মাস পর্যন্ত ভাগ করে হিসাব করা হয়েছে।'}</p></div>}
        {row.goal.monthlyContributionMinor && <p className="text-xs text-slate-500">{en ? 'Your monthly plan: ' : 'আপনার মাসিক পরিকল্পনা: '}{money(row.goal.monthlyContributionMinor)}</p>}
        {row.goal.deadline && row.goal.deadline <= today && BigInt(row.remainingMinor) > 0n && <p className="text-xs text-amber-800">{en ? 'The target date has arrived or passed. Update the date or your savings plan.' : 'লক্ষ্যের তারিখ এসে গেছে বা পেরিয়েছে। তারিখ বা সঞ্চয়ের পরিকল্পনা বদলে নিন।'}</p>}
        {row.emergencyCoverageMonths !== null && <p className="text-xs text-slate-600">{en ? 'Essential expenses covered: ' : 'প্রয়োজনীয় খরচ চলবে: '}<strong>{en ? row.emergencyCoverageMonths : toBengaliDigits(row.emergencyCoverageMonths)}</strong>{en ? ' months' : ' মাস'}</p>}
        {!row.goal.archived ? <div className="flex flex-wrap gap-2">
          <button type="button" disabled={allocationDisabled || availableAccounts.length === 0} className={primaryButton} onClick={() => { setForm(null); setAllocateTo(row.goal.id); setAccountId(availableAccounts.find(account => BigInt(available(account.id)) > 0n)?.id || availableAccounts[0]?.id || ''); setAmount(''); setNote(''); setError(''); setNotice(''); }}><Plus className="h-3.5 w-3.5" />{en ? 'Set money aside' : 'টাকা আলাদা রাখুন'}</button>
          <button type="button" disabled={disabled} className={secondaryButton} onClick={() => edit(row.goal)}>{en ? 'Edit' : 'সম্পাদনা'}</button>
          <button type="button" disabled={disabled || BigInt(row.requestedMinor) > 0n} title={BigInt(row.requestedMinor) > 0n ? en ? 'Release all reservations first' : 'আগে সব বরাদ্দ ছাড়ুন' : undefined} className={secondaryButton} onClick={() => void commit(() => db.setSavingsGoalArchived(opened.current.workspaceId!, row.goal.id, true), () => { if (form?.id === row.goal.id) setForm(null); if (allocateTo === row.goal.id) setAllocateTo(null); })}><Archive className="h-3.5 w-3.5" />{en ? 'Archive' : 'আর্কাইভ'}</button>
        </div> : <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled} className={secondaryButton} onClick={() => void commit(() => db.setSavingsGoalArchived(opened.current.workspaceId!, row.goal.id, false), () => { setDeleteGoalId(null); setDeleteText(''); })}>{en ? 'Restore goal' : 'ফিরিয়ে আনুন'}</button>
          <button type="button" disabled={disabled || BigInt(row.requestedMinor) > 0n} title={BigInt(row.requestedMinor) > 0n ? en ? 'Release all reservations first' : 'আগে সব বরাদ্দ ছাড়ুন' : undefined}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-rose-600"
            onClick={() => { setDeleteGoalId(row.goal.id); setDeleteText(''); setError(''); setNotice(''); }}><Trash2 className="h-3.5 w-3.5" />{en ? 'Delete goal' : 'লক্ষ্য মুছুন'}</button>
        </div>}
        {deleteGoalId === row.goal.id && <form className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-3" onSubmit={event => {
          event.preventDefault();
          if (disabled || deleteText !== 'DELETE' || BigInt(row.requestedMinor) > 0n) return;
          void commit(() => db.safeDeleteSavingsGoal(opened.current.workspaceId!, row.goal.id, deleteText), () => { setDeleteGoalId(null); setDeleteText(''); }, en ? 'Goal deleted. Your wallet balances and transaction history are unchanged.' : 'লক্ষ্যটি মুছে দেওয়া হয়েছে। ওয়ালেটের ব্যালান্স ও লেনদেনের ইতিহাস বদলায়নি।');
        }}>
          <p className="break-words text-sm font-bold text-rose-900">{en ? `Delete “${row.goal.name}”?` : `“${row.goal.name}” মুছে দেবেন?`}</p>
          <p className="text-xs leading-relaxed text-rose-900">{en ? 'This removes the goal from your lists. Wallet money and transaction history stay the same. This goal cannot be restored from Archived afterwards.' : 'লক্ষ্যটি তালিকা থেকে মুছে যাবে। ওয়ালেটের টাকা ও লেনদেনের ইতিহাস বদলাবে না। এরপর আর্কাইভ থেকে এই লক্ষ্যটি ফিরিয়ে আনা যাবে না।'}</p>
          {BigInt(row.requestedMinor) > 0n && <p role="status" className="text-xs font-semibold text-rose-900">{errorMessage(new Error('SAVINGS_ALLOCATIONS_REMAIN'), en)}</p>}
          <label className="block text-xs font-semibold text-rose-900">{en ? 'Type DELETE to confirm' : 'নিশ্চিত করতে DELETE লিখুন'}<input ref={deleteInput} className={fieldClass} aria-label={en ? 'Type DELETE to confirm' : 'নিশ্চিত করতে DELETE লিখুন'} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={disabled} value={deleteText} onChange={event => setDeleteText(event.target.value)} /></label>
          <div className="flex gap-2"><button type="submit" disabled={disabled || deleteText !== 'DELETE' || BigInt(row.requestedMinor) > 0n} className="min-h-11 flex-1 rounded-xl bg-rose-700 px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-rose-600">{busy ? en ? 'Deleting…' : 'মুছে দেওয়া হচ্ছে…' : en ? 'Delete permanently' : 'স্থায়ীভাবে মুছুন'}</button>
            <button type="button" disabled={busy} className={secondaryButton} onClick={() => { setDeleteGoalId(null); setDeleteText(''); setError(''); }}>{en ? 'Cancel' : 'বাতিল'}</button></div>
        </form>}
        {!row.goal.archived && availableAccounts.length === 0 && <p className="text-xs text-amber-800">{en ? 'Create or restore an asset wallet to set money aside.' : 'টাকা আলাদা রাখতে একটি সম্পদ ওয়ালেট তৈরি করুন বা ফিরিয়ে আনুন।'}</p>}

        {allocateTo === row.goal.id && <form className="space-y-3 rounded-xl bg-slate-50 p-3" onSubmit={allocate}>
          <label className="block text-xs font-medium">{en ? 'From wallet' : 'কোন ওয়ালেট থেকে'}<AppSelect aria-label={en ? 'From wallet' : 'কোন ওয়ালেট থেকে'} className={fieldClass} disabled={allocationDisabled} value={accountId} onChange={event => { setAccountId(event.target.value); setError(''); }}>{availableAccounts.map(account => <option key={account.id} value={account.id}>{formatAccountTitle(account.name, language)} · {money(available(account.id))}</option>)}</AppSelect></label>
          <dl className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">{en ? 'Wallet balance' : 'ওয়ালেটের ব্যালান্স'}</dt><dd className="break-all text-right font-semibold">{money(selectedWallet?.balanceMinor || '0')}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">{en ? 'Set aside across all goals' : 'সব লক্ষ্যে আলাদা রাখা'}</dt><dd className="break-all text-right">{money(selectedWallet?.allocatedMinor || '0')}</dd></div>
            <div className="flex justify-between gap-3 border-t border-slate-100 pt-2"><dt className="font-semibold">{en ? 'Available to set aside' : 'এখন আলাদা রাখা যাবে'}</dt><dd className="break-all text-right font-bold text-blue-800">{money(walletAvailable)}</dd></div>
          </dl>
          <label className="block text-xs font-medium">{en ? 'Amount (BDT)' : 'পরিমাণ (টাকা)'}<input className={fieldClass} inputMode="decimal" required disabled={allocationDisabled} value={amount} aria-describedby={allocationHintId} aria-invalid={!!amount.trim() && !!allocationIssue} onChange={event => { setAmount(event.target.value); setError(''); }} /></label>
          <p id={allocationHintId} role="status" className={`text-xs leading-relaxed ${allocationIssue ? 'rounded-xl bg-amber-50 p-3 text-amber-900' : 'text-slate-500'}`}>{allocationIssue || (en ? 'The target and monthly plan do not add money to your wallet. Only existing, unreserved money can be set aside.' : 'লক্ষ্য বা মাসিক পরিকল্পনা লিখলে ওয়ালেটে টাকা যোগ হয় না। ওয়ালেটে থাকা অব্যবহৃত টাকাই আলাদা রাখা যায়।')}</p>
          <label className="block text-xs font-medium">{en ? 'Note · optional' : 'নোট · ঐচ্ছিক'}<input className={fieldClass} maxLength={200} disabled={allocationDisabled} value={note} onChange={event => setNote(event.target.value)} /></label>
          <div className="flex gap-2"><button type="submit" disabled={allocationDisabled || !!allocationIssue || !allocationAmount} className={`${primaryButton} flex-1`}><Wallet className="h-3.5 w-3.5" />{busy ? en ? 'Saving…' : 'সেভ হচ্ছে…' : en ? 'Reserve money' : 'আলাদা রাখুন'}</button><button type="button" disabled={busy} className={secondaryButton} onClick={() => setAllocateTo(null)}>{en ? 'Cancel' : 'বাতিল'}</button></div>
        </form>}

        {row.contributions.length > 0 && <details className="border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-600">{en ? 'Reservation history' : 'টাকা আলাদা রাখার ইতিহাস'}</summary><ul className="mt-3 space-y-3">{row.contributions.map(contribution => <li key={contribution.allocationId} className="rounded-xl bg-slate-50 p-3 text-xs"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="break-words font-semibold">{accountName(contribution.accountId)}</p><p className="mt-1 text-slate-500">{dateLabel(contribution.createdAtUtc)} · {money(contribution.amountMinor)}</p>{contribution.note && <p className="mt-1 break-words text-slate-500">{contribution.note}</p>}</div>{BigInt(contribution.requestedMinor) > 0n && <button type="button" disabled={disabled} className={secondaryButton} aria-label={en ? `Release ${money(contribution.requestedMinor)} from ${accountName(contribution.accountId)}` : `${accountName(contribution.accountId)} থেকে ${money(contribution.requestedMinor)} ছাড়ুন`} onClick={() => void commit(() => db.releaseSavingsAllocation(opened.current.workspaceId!, row.goal.id, contribution.allocationId, contribution.requestedMinor))}><ArrowDownLeft className="h-3.5 w-3.5" />{en ? 'Release' : 'ছাড়ুন'} {money(contribution.requestedMinor)}</button>}</div><p className="mt-2 leading-relaxed text-slate-500">{en ? 'Still reserved: ' : 'এখনও বরাদ্দ: '}{money(contribution.requestedMinor)}{BigInt(contribution.releasedMinor) > 0n && <>{en ? ' · Released: ' : ' · ছাড়া হয়েছে: '}{money(contribution.releasedMinor)}</>}</p></li>)}</ul></details>}
      </section>)}
    </div>
  </ModalShell>;
}
