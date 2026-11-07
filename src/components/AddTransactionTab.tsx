import { AppSelect } from './AppSelect';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  toPaisa,
  parsePaisaString,
  formatBDT,
  normalizeNumericAmountInput
} from '../domain/money';
import {
  buildIncomeJournal,
  buildExpenseJournal,
  buildTransferJournal,
  generateUUID
} from '../domain/journal';
import { SyncOperation, Category, PartyRole, ReceiptBlob } from '../contracts/types';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import { AccountPickerModal } from './AccountPickerModal';
import { soundService } from '../services/soundService';
import { resolveJournalTime } from '../domain/transactionTime';
import { createReceiptBlob } from '../storage/receipts';
import { AIEntryModal } from './AIEntryModal';
import { aiFeaturesEnabled } from '../ai/availability';
import { EntryDraft } from '../ai/entryDraft';
import {walletError} from './walletText';
import {
  TrendingDown,
  TrendingUp,
  ArrowRightLeft,
  Calendar,
  FileText,
  Camera,
  Check,
  AlertCircle,
  X,
  Plus,
  FolderPlus,
  UserPlus,
  Users,
  Briefcase,
  ChevronDown,
  Wallet,
  Sparkles
} from 'lucide-react';

interface AddTransactionTabProps {
  onSuccess: () => void;
}

export const AddTransactionTab: React.FC<AddTransactionTabProps> = ({ onSuccess }) => {
  const {
    db,
    currentWorkspace,
    accounts,
    categories,
    parties,
    dashboardData,
    createCategory,
    createParty,
    language,
    refreshState,
    triggerManualSync,
    isOnline,
  } = useApp();

  const isEn = language === 'en';
  const isBusiness = currentWorkspace?.kind === 'business';

  const activeAccounts = useMemo(() => {
    return accounts.filter((a) => !a.archivedAt);
  }, [accounts]);

  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id || '');
  const [toAccountId, setToAccountId] = useState(
    activeAccounts[1]?.id || activeAccounts[0]?.id || ''
  );
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [showToAccountPicker, setShowToAccountPicker] = useState(false);
  const [isAIForm, setIsAIForm] = useState(false);

  // Synchronize selected account when activeAccounts or currentWorkspace changes
  useEffect(() => {
    if (isAIForm) {
      if (accountId && !activeAccounts.some(account => account.id === accountId)) setAccountId('');
      if (toAccountId && (!activeAccounts.some(account => account.id === toAccountId) || toAccountId === accountId)) setToAccountId('');
      return;
    }
    if (activeAccounts.length > 0) {
      if (!accountId || !activeAccounts.some((a) => a.id === accountId)) {
        setAccountId(activeAccounts[0].id);
      }
      if (
        !toAccountId ||
        !activeAccounts.some((a) => a.id === toAccountId) ||
        toAccountId === accountId
      ) {
        const other = activeAccounts.find((a) => a.id !== (accountId || activeAccounts[0].id));
        setToAccountId(other?.id || activeAccounts[0].id);
      }
    } else {
      setAccountId('');
      setToAccountId('');
    }
  }, [activeAccounts, currentWorkspace?.id, isAIForm]);

  const getAccountBalance = (accId: string): string => {
    const summary = dashboardData?.accountSummaries?.find((s) => s.accountId === accId);
    if (summary) return summary.currentBalanceMinor;
    const acc = accounts.find((a) => a.id === accId);
    return acc?.openingBalanceMinor || '0';
  };

  const selectedAccount = useMemo(() => {
    return accounts.find((a) => a.id === accountId);
  }, [accounts, accountId]);

  const selectedToAccount = useMemo(() => {
    return accounts.find((a) => a.id === toAccountId);
  }, [accounts, toAccountId]);

  const [categoryId, setCategoryId] = useState('');
  const [subCategoryId, setSubCategoryId] = useState('');
  const [partyId, setPartyId] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [effectiveTime, setEffectiveTime] = useState('');
  const [note, setNote] = useState('');
  const [feeStr, setFeeStr] = useState('');
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [receiptBlob, setReceiptBlob] = useState<ReceiptBlob | null>(null);
  const [isReceiptLoading, setIsReceiptLoading] = useState(false);
  const receiptSelection = useRef(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const submissionInFlight = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState(false);
  const [showAIEntry, setShowAIEntry] = useState(false);
  const [aiDraft, setAIDraft] = useState<EntryDraft | null>(null);
  const [aiTypeMissing, setAITypeMissing] = useState(false);
  const [aiCurrency, setAICurrency] = useState('BDT');

  const applyAIEntry = (entry: EntryDraft, image: ReceiptBlob | null) => {
    setIsAIForm(true);
    setAIDraft(entry); setAITypeMissing(entry.transactionType === 'unknown');
    setAICurrency(entry.currency === 'unknown' ? '' : entry.currency);
    if (entry.transactionType !== 'unknown') setType(entry.transactionType);
    setAmountStr(entry.amountDecimal || ''); setNote([entry.merchant, entry.note].filter(Boolean).join(' · ').slice(0, 1000));
    setEffectiveDate(entry.transactionDate || ''); setEffectiveTime(entry.transactionTime || '');
    // Keep the user's current wallet. Model output has no authority to choose accounts.
    setPartyId(''); setFeeStr('');
    setSubCategoryId(''); setReceiptBlob(image); setReceiptName(image?.fileName || null);
    setErrorMsg(null); setShowAIEntry(false);
  };

  // Simplified Category Modal: 'category' (top-level) or 'subcategory' (child of categoryId)
  const [categoryModalMode, setCategoryModalMode] = useState<'category' | 'subcategory' | null>(null);
  const [singleCatName, setSingleCatName] = useState('');

  // Quick Party / Member Creation Modal for Business Ledgers
  const [showAddPartyModal, setShowAddPartyModal] = useState(false);
  const [newPartyName, setNewPartyName] = useState('');
  const [newPartyRole, setNewPartyRole] = useState<PartyRole>('partner');
  const [newPartyPhone, setNewPartyPhone] = useState('');

  // Parent categories for current type
  const availableParentCategories = useMemo(() => {
    return categories.filter(
      (c) => (type === 'income' ? c.kind === 'income' : c.kind === 'expense') && !c.parentId
    );
  }, [categories, type]);

  // Subcategories under selected parent category
  const availableSubCategories = useMemo(() => {
    if (!categoryId) return [];
    return categories.filter((c) => c.parentId === categoryId);
  }, [categories, categoryId]);

  // Current selected parent category object for subcategory modal header
  const currentParentCat = useMemo(() => {
    return availableParentCategories.find((c) => c.id === categoryId) || availableParentCategories[0];
  }, [availableParentCategories, categoryId]);

  // Set default category when type or available categories change
  React.useEffect(() => {
    if (availableParentCategories.length > 0) {
      if (!categoryId || !availableParentCategories.find((c) => c.id === categoryId)) {
        setCategoryId(availableParentCategories[0].id);
        setSubCategoryId('');
      }
    }
  }, [type, availableParentCategories, categoryId]);

  // Reset subcategory when parent category changes
  const handleParentCategoryChange = (newParentId: string) => {
    setCategoryId(newParentId);
    setSubCategoryId('');
  };

  const quickAmounts = ['100', '500', '1000', '2000', '5000'];

  const handleQuickAmount = (val: string) => {
    setAmountStr(val);
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const selection = ++receiptSelection.current;
    setReceiptName(null); setReceiptBlob(null); setIsReceiptLoading(true);
    try {
      const blob = await createReceiptBlob(file);
      if (selection === receiptSelection.current) { setReceiptName(blob.fileName); setReceiptBlob(blob); setErrorMsg(null); }
    } catch {
      if (selection === receiptSelection.current) setErrorMsg(isEn ? 'Choose a valid JPEG, PNG or WebP receipt up to 2 MB.' : 'সর্বোচ্চ ২ মেগাবাইটের সঠিক JPEG, PNG বা WebP রসিদ বেছে নিন।');
    } finally {
      if (selection === receiptSelection.current) setIsReceiptLoading(false);
    }
  };

  // Clean, single-field Category / Sub-Category creation
  const handleCreateCategory = async (e: React.FormEvent) => {
    try {
    e.preventDefault();
    const trimmed = singleCatName.trim();
    if (!trimmed) return;

    const kind = type === 'transfer' ? 'expense' : type;

    if (categoryModalMode === 'subcategory') {
      // Sub-category attaches automatically to the current parent category!
      const parentId = categoryId || availableParentCategories[0]?.id || null;
      const newCat = await createCategory(trimmed, kind, parentId);
      setSubCategoryId(newCat.id);
    } else {
      // Main Category: The category ITSELF is the top-level parent!
      const newCat = await createCategory(trimmed, kind, null);
      setCategoryId(newCat.id);
      setSubCategoryId('');
    }

    setSingleCatName('');
    setCategoryModalMode(null);
    } catch {setErrorMsg(isEn?'Category could not be saved. Retry.':'খাত সংরক্ষণ হয়নি। আবার চেষ্টা করুন।');}
  };

  // Quick Party / Member creation
  const handleCreateParty = async (e: React.FormEvent) => {
    try {
    e.preventDefault();
    if (!newPartyName.trim()) return;

    const party = await createParty(newPartyName.trim(), newPartyRole, newPartyPhone.trim());
    setPartyId(party.id);
    setNewPartyName('');
    setNewPartyPhone('');
    setNewPartyRole('partner');
    setShowAddPartyModal(false);
    } catch { setErrorMsg(isEn?'Changes could not be saved. Retry.':'পরিবর্তন সংরক্ষণ হয়নি। আবার চেষ্টা করুন।'); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (isAIForm && (aiTypeMissing || aiCurrency !== 'BDT')) {
      setErrorMsg(isEn ? 'Choose the transaction type and BDT currency in the form.' : 'ফর্মে লেনদেনের ধরন ও BDT মুদ্রা বেছে নিন।');
      return;
    }

    if (!currentWorkspace) {
      setErrorMsg(isEn ? 'No active workspace found' : 'কোনো সক্রিয় খাতা পাওয়া যায়নি');
      return;
    }

    let parsedPaisa = 0n;
    try {
      parsedPaisa = parsePaisaString(amountStr);
      if (parsedPaisa <= 0n) {
        setErrorMsg(isEn ? 'Amount must be greater than zero' : 'টাকার পরিমাণ অবশ্যই শূন্যের চেয়ে বেশি হতে হবে');
        return;
      }
    } catch {
      setErrorMsg(isEn ? 'Please enter a valid amount' : 'সঠিক টাকার অঙ্ক লিখুন');
      return;
    }

    if (!accountId || !activeAccounts.some((a) => a.id === accountId)) {
      setErrorMsg(isEn ? 'Please select a valid account' : 'অনুগ্রহ করে একটি সঠিক অ্যাকাউন্ট নির্বাচন করুন');
      return;
    }

    if (type === 'transfer') {
      if (!toAccountId || !activeAccounts.some((a) => a.id === toAccountId)) {
        setErrorMsg(isEn ? 'Please select a valid destination account' : 'অনুগ্রহ করে একটি সঠিক গন্তব্য অ্যাকাউন্ট নির্বাচন করুন');
        return;
      }
      if (accountId === toAccountId) {
        setErrorMsg(isEn ? 'Source and destination accounts must be different' : 'উৎস এবং গন্তব্য অ্যাকাউন্ট ভিন্ন হতে হবে');
        return;
      }
    }

    if (submissionInFlight.current || isReceiptLoading) return;
    submissionInFlight.current = true;
    setIsSubmitting(true);

    try {
      const timing = resolveJournalTime({ effectiveDate, effectiveTime });
      const opId = generateUUID();
      let balancedJournal;
      let opPayload: any;
      let opType: SyncOperation['type'];

      // Pick the effective category: if subcategory is selected, use it, else parent category
      const effectiveCategoryId = subCategoryId || categoryId || availableParentCategories[0]?.id;
      const effectivePartyId = isBusiness && partyId ? partyId : null;

      if (type === 'expense') {
        balancedJournal = buildExpenseJournal({
          workspaceId: currentWorkspace.id,
          assetAccountId: accountId,
          expenseCategoryId: effectiveCategoryId,
          amountMinor: parsedPaisa.toString(),
          ...timing,
          note: note.trim() || undefined,
          opId,
          partyId: effectivePartyId,
          receiptBlobSha256: receiptBlob?.sha256 || null,
          receiptName,
        });
        opType = 'journal.post';
        opPayload = {
          balancedJournal,
          workspaceId: currentWorkspace.id,
          assetAccountId: accountId,
          expenseCategoryId: effectiveCategoryId,
          amountMinor: parsedPaisa.toString(),
          effectiveDate: timing.effectiveDate,
          note: note.trim() || undefined,
          partyId: effectivePartyId,
        };
      } else if (type === 'income') {
        balancedJournal = buildIncomeJournal({
          workspaceId: currentWorkspace.id,
          assetAccountId: accountId,
          revenueCategoryId: effectiveCategoryId,
          amountMinor: parsedPaisa.toString(),
          ...timing,
          note: note.trim() || undefined,
          opId,
          partyId: effectivePartyId,
          receiptBlobSha256: receiptBlob?.sha256 || null,
          receiptName,
        });
        opType = 'journal.post';
        opPayload = {
          balancedJournal,
          workspaceId: currentWorkspace.id,
          assetAccountId: accountId,
          revenueCategoryId: effectiveCategoryId,
          amountMinor: parsedPaisa.toString(),
          effectiveDate: timing.effectiveDate,
          note: note.trim() || undefined,
          partyId: effectivePartyId,
        };
      } else {
        // Transfer with optional fee
        let feePaisa = 0n;
        if (feeStr.trim()) {
          try {
            feePaisa = parsePaisaString(feeStr);
          } catch {
            feePaisa = 0n;
          }
        }

        balancedJournal = buildTransferJournal({
          workspaceId: currentWorkspace.id,
          fromAssetAccountId: accountId,
          toAssetAccountId: toAccountId,
          amountMinor: parsedPaisa.toString(),
          feeMinor: feePaisa.toString(),
          feeExpenseCategoryId: 'cat-transfer-fee',
          ...timing,
          note: note.trim() || (isEn ? 'Account Transfer' : 'অ্যাকাউন্ট স্থানান্তর'),
          opId,
          partyId: effectivePartyId,
          receiptBlobSha256: receiptBlob?.sha256 || null,
          receiptName,
        });
        opType = 'journal.post';
        opPayload = {
          balancedJournal,
          workspaceId: currentWorkspace.id,
          fromAssetAccountId: accountId,
          toAssetAccountId: toAccountId,
          amountMinor: parsedPaisa.toString(),
          feeMinor: feePaisa.toString(),
          effectiveDate: timing.effectiveDate,
          note: note.trim() || (isEn ? 'Account Transfer' : 'অ্যাকাউন্ট স্থানান্তর'),
          partyId: effectivePartyId,
        };
      }

      const opCanonical = canonicalJson(opPayload);
      const contentSha256 = await computeSha256(opCanonical);

      const op: SyncOperation = {
        protocolVersion: 1,
        ownerHash: db.getIdentity()?.ownerSubjectHash || 'local-owner',
        deviceId: db.getDeviceId(),
        seq: 0, // Assigned atomically by commitJournalWithOutbox after validation.
        operationId: opId,
        entityId: balancedJournal.transaction.id,
        type: opType,
        baseRevision: 'v1',
        createdAtUtc: new Date().toISOString(),
        payload: opPayload,
        contentSha256,
      };

      await db.commitJournalWithOutbox(balancedJournal, op, receiptBlob);
      await db.waitForPendingWrites();
      soundService.playTransactionSuccess(type);
      refreshState();
      setSuccessToast(true);


      // Reset form
      setAmountStr('');
      setNote('');
      setFeeStr('');
      setPartyId('');
      setReceiptName(null);
      setEffectiveDate('');
      setEffectiveTime('');
      setReceiptBlob(null);
      setIsAIForm(false);
      setAIDraft(null); setAITypeMissing(false); setAICurrency('BDT');

      setTimeout(() => {
        setSuccessToast(false);
        onSuccess();
      }, 700);
    } catch (err: any) {
      setErrorMsg(typeof err?.message==='string'&&err.message.startsWith('WALLET_')?walletError(err,isEn):(err.message || (isEn ? 'Failed to save transaction' : 'লেনদেন সংরক্ষণ ব্যর্থ হয়েছে')));
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const getRoleLabel = (r: PartyRole) => {
    switch (r) {
      case 'partner':
        return isEn ? 'Partner' : 'অংশীদার';
      case 'staff':
        return isEn ? 'Staff' : 'কর্মচারী';
      case 'customer':
        return isEn ? 'Customer' : 'কাস্টমার';
      case 'supplier':
        return isEn ? 'Supplier' : 'সাপ্লায়ার';
      default:
        return isEn ? 'Other' : 'অন্যান্য';
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-36 animate-in fade-in">
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-4 sm:p-5">
        <h1 className="text-base font-bold text-slate-900 mb-4 tracking-tight">
          {isEn ? 'New Transaction' : 'নতুন লেনদেন'}
        </h1>

        {aiFeaturesEnabled && <button type="button" disabled={isSubmitting || isReceiptLoading} onClick={() => setShowAIEntry(true)}
          className="mb-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs font-semibold text-blue-700 disabled:opacity-40">
          <Sparkles className="h-4 w-4" />{isEn ? 'Fill from receipt or voice with AI' : 'রিসিপ্ট বা ভয়েস থেকে AI দিয়ে লিখুন'}
        </button>}

        {aiFeaturesEnabled && showAIEntry && <AIEntryModal key={currentWorkspace?.id} onClose={() => setShowAIEntry(false)} onApply={applyAIEntry} />}

        {/* Transaction Type Segmented Switcher */}
        <div className="app-entry-type grid grid-cols-3 gap-1 p-1 bg-slate-100/90 rounded-xl mb-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => { setType('expense'); setAITypeMissing(false); }}
            className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              type === 'expense'
                ? 'bg-white text-rose-600 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5" />
            <span>{isEn ? 'Expense' : 'খরচ'}</span>
          </button>

          <button
            type="button"
            onClick={() => { setType('income'); setAITypeMissing(false); }}
            className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              type === 'income'
                ? 'bg-white text-emerald-600 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{isEn ? 'Income' : 'জমা'}</span>
          </button>

          <button
            type="button"
            onClick={() => { setType('transfer'); setAITypeMissing(false); }}
            className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              type === 'transfer'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>{isEn ? 'Transfer' : 'স্থানান্তর'}</span>
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successToast && (
          <div className="p-3 mb-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 animate-in zoom-in-95">
            <Check className="w-4 h-4 shrink-0 text-emerald-600" />
            <span className="font-semibold">
              {isEn ? 'Transaction saved!' : 'লেনদেন সংরক্ষিত হয়েছে!'}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {aiDraft && <div className="space-y-2 rounded-xl bg-blue-50 p-3 text-blue-900">
            <p>{isEn ? 'AI filled these details. Edit anything you need, then Save once.' : 'AI তথ্য বসিয়েছে। প্রয়োজন হলে ঠিক করে একবার Save করুন।'}</p>
            {aiTypeMissing && <p role="alert" className="text-amber-900">{isEn ? 'Choose Expense, Income or Transfer above.' : 'উপরে খরচ, জমা বা স্থানান্তর বেছে নিন।'}</p>}
            {aiDraft.currency === 'unknown' && <label className="block">{isEn ? 'Choose currency' : 'মুদ্রা বেছে নিন'}<AppSelect value={aiCurrency} onChange={event => setAICurrency(event.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2"><option value="">{isEn ? 'Not identified' : 'বোঝা যায়নি'}</option><option value="BDT">BDT — ৳</option></AppSelect></label>}
            {aiDraft.transcript && <details><summary className="cursor-pointer font-semibold">{isEn ? 'What AI heard' : 'AI যা শুনেছে'}</summary><p className="mt-2 whitespace-pre-wrap break-words">{aiDraft.transcript}</p></details>}
            {aiDraft.warnings.length > 0 && <ul className="list-disc space-y-1 pl-4 text-amber-900">{aiDraft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          </div>}
          {/* Amount Input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-700 font-semibold">
                {isEn ? 'Amount (BDT)' : 'টাকার পরিমাণ'}
              </label>
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-400">
                ৳
              </span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amountStr}
                onChange={(e) => setAmountStr(normalizeNumericAmountInput(e.target.value))}
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xl font-bold text-slate-900 tracking-tight focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 tabular-nums"
                autoFocus
              />
            </div>

            {/* Quick Amount Chips */}
            <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
              {quickAmounts.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleQuickAmount(q)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold tabular-nums transition-colors"
                >
                  +৳{q}
                </button>
              ))}
            </div>
          </div>

          {/* Account and Category Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                {type === 'transfer'
                  ? isEn
                    ? 'Source Account (From)'
                    : 'উৎস অ্যাকাউন্ট (From)'
                  : isEn
                  ? 'Account / Wallet'
                  : 'অ্যাকাউন্ট / ওয়ালেট'}
              </label>
              <button
                type="button"
                id="source-account-picker-btn"
                onClick={() => setShowAccountPicker(true)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-left flex items-center justify-between hover:bg-slate-100/80 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 min-h-[44px]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <Wallet className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-bold text-slate-800 truncate">
                    {selectedAccount?.name || (isEn ? 'Select Account' : 'অ্যাকাউন্ট নির্বাচন করুন')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {selectedAccount && (
                    <span className="text-xs font-semibold text-slate-600 tabular-nums">
                      {formatBDT(getAccountBalance(selectedAccount.id), {
                        locale: language,
                        showDecimals: false,
                      })}
                    </span>
                  )}
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </div>
              </button>
            </div>

            {type === 'transfer' ? (
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {isEn ? 'Destination Account (To)' : 'গন্তব্য অ্যাকাউন্ট (To)'}
                </label>
                <button
                  type="button"
                  id="destination-account-picker-btn"
                  onClick={() => setShowToAccountPicker(true)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-left flex items-center justify-between hover:bg-slate-100/80 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 min-h-[44px]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <Wallet className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold text-slate-800 truncate">
                      {selectedToAccount?.name || (isEn ? 'Select Destination' : 'গন্তব্য নির্বাচন করুন')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {selectedToAccount && (
                      <span className="text-xs font-semibold text-slate-600 tabular-nums">
                        {formatBDT(getAccountBalance(selectedToAccount.id), {
                          locale: language,
                          showDecimals: false,
                        })}
                      </span>
                    )}
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  </div>
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-700 font-semibold">
                    {isEn ? 'Category (Main)' : 'ক্যাটাগরি / খাত'}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setSingleCatName('');
                      setCategoryModalMode('category');
                    }}
                    className="text-blue-700 hover:text-blue-900 font-semibold flex items-center gap-1 text-[11px]"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{isEn ? 'New' : 'নতুন'}</span>
                  </button>
                </div>
                <AppSelect aria-label={isEn ? 'Main Category' : 'প্রধান খাত'}
                  value={categoryId}
                  onChange={(e) => handleParentCategoryChange(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {availableParentCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {isEn && c.nameEn ? c.nameEn : c.name}
                    </option>
                  ))}
                </AppSelect>
              </div>
            )}
          </div>

          {/* Sub-Category Selector (when not transfer) */}
          {type !== 'transfer' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-700 font-semibold">
                  {isEn ? 'Sub-Category (Optional)' : 'সাব-ক্যাটাগরি (ঐচ্ছিক)'}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setSingleCatName('');
                    setCategoryModalMode('subcategory');
                  }}
                  className="text-blue-700 hover:text-blue-900 font-semibold flex items-center gap-1 text-[11px]"
                >
                  <Plus className="w-3 h-3" />
                  <span>{isEn ? 'Sub-category' : 'সাব-ক্যাটাগরি'}</span>
                </button>
              </div>
              <AppSelect aria-label={isEn ? 'Sub-category' : 'উপখাত'}
                value={subCategoryId}
                onChange={(e) => setSubCategoryId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="">
                  {isEn ? '-- None / General Category --' : '-- কোনোটি নয় / মূল ক্যাটাগরি --'}
                </option>
                {availableSubCategories.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {isEn && sc.nameEn ? sc.nameEn : sc.name}
                  </option>
                ))}
              </AppSelect>
            </div>
          )}

          {/* Multiple Business Persons / Members Selector */}
          {isBusiness && (
            <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/80">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-slate-600" />
                  <label className="text-slate-800 font-semibold">
                    {isEn ? 'Associated Member' : 'সংশ্লিষ্ট সদস্য'}
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewPartyName('');
                    setNewPartyPhone('');
                    setNewPartyRole('partner');
                    setShowAddPartyModal(true);
                  }}
                  className="text-blue-700 hover:text-blue-900 font-semibold flex items-center gap-1 text-[11px]"
                >
                  <UserPlus className="w-3 h-3" />
                  <span>{isEn ? 'Add' : 'যোগ'}</span>
                </button>
              </div>

              <AppSelect aria-label={isEn ? 'Associated Person' : 'সংশ্লিষ্ট ব্যক্তি'}
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="">
                  {isEn ? '-- None / General Business --' : '-- সাধারণ ব্যবসা (ব্যক্তি ছাড়া) --'}
                </option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {getRoleLabel(p.role)} {p.phone ? `(${p.phone})` : ''}
                  </option>
                ))}
              </AppSelect>
            </div>
          )}

          {/* Transfer Fee if Transfer type */}
          {type === 'transfer' && (
            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                {isEn ? 'Transfer Fee (Optional)' : 'চার্জ বা ফি (ঐচ্ছিক)'}
              </label>
              <input
                type="text"
                placeholder="0.00"
                value={feeStr}
                onChange={(e) => setFeeStr(normalizeNumericAmountInput(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono tabular-nums"
              />
            </div>
          )}

          {/* Date & Note */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="transaction-date" className="block text-slate-700 font-semibold mb-1">
                {isEn ? 'Date (optional)' : 'তারিখ (ঐচ্ছিক)'}
              </label>
              <input
                type="date"
                id="transaction-date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="transaction-time" className="block text-slate-700 font-semibold mb-1">
                {isEn ? 'Time (optional)' : 'সময় (ঐচ্ছিক)'}
              </label>
              <input id="transaction-time" type="time" value={effectiveTime}
                onChange={event => setEffectiveTime(event.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600" />
            </div>
            <p className="sm:col-span-2 text-[11px] leading-relaxed text-slate-500">
              {isEn ? 'Leave blank to use the date and time when you save. Selected values are kept; an unselected time uses the save-time clock.' : 'খালি রাখলে সেভ করার সময়ের তারিখ ও সময় বসবে। বেছে দেওয়া তারিখ/সময় থাকবে; সময় না বাছলে সেভের সময় বসবে।'}
            </p>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                {isEn ? 'Note (Optional)' : 'বিবরণ (ঐচ্ছিক)'}
              </label>
              <input
                type="text"
                placeholder={isEn ? 'e.g., Grocery, lunch, vendor bill' : 'যেমন: বাজার খরচ, মালামাল ক্রয়'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {/* Receipt Attachment */}
          <div>
            {isReceiptLoading && <p role="status" className="mb-2 text-xs text-slate-500">{isEn ? 'Checking receipt…' : 'রসিদ যাচাই হচ্ছে…'}</p>}
            <label className="block text-slate-700 font-semibold mb-1">
              {isEn ? 'Receipt Photo (Optional)' : 'রসিদের ছবি (ঐচ্ছিক)'}
            </label>
            {!receiptName ? (
              <label className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-xl hover:border-slate-400 cursor-pointer bg-slate-50/50 transition-colors">
                <Camera className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600 font-medium">
                  {isEn ? 'Upload receipt photo' : 'রসিদের ছবি তুলুন বা আপলোড করুন'}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleReceiptUpload}
                  className="hidden"
                />
              </label>
            ) : (
              <div className="flex items-center justify-between p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-900">
                <span className="truncate max-w-[200px]">{receiptName}</span>
                <button
                  type="button"
                  onClick={() => {
                    setReceiptName(null);
                    receiptSelection.current++;
                    setReceiptBlob(null);
                    setIsReceiptLoading(false);
                  }}
                  className="p-1 hover:bg-slate-200 rounded text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || isReceiptLoading}
            className="w-full py-3 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white rounded-xl text-sm font-bold shadow-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            <span>{isEn ? 'Save Transaction' : 'সংরক্ষণ করুন'}</span>
          </button>
        </form>
      </div>

      {/* Simplified, Single-Name Category / Sub-Category Modal (Issue #2 Fix) */}
      {categoryModalMode !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 text-xs animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-blue-700" />
                <h3 className="font-bold text-slate-800 text-sm">
                  {categoryModalMode === 'subcategory'
                    ? isEn
                      ? 'Add Sub-Category'
                      : 'নতুন সাব-ক্যাটাগরি যোগ করুন'
                    : isEn
                    ? 'Add New Category'
                    : 'নতুন ক্যাটাগরি তৈরি করুন'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCategoryModalMode(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="space-y-3 pt-3">
              {/* If subcategory mode, show the parent category badge clearly */}
              {categoryModalMode === 'subcategory' && (
                <div>
                  <label className="block text-slate-500 font-medium mb-1 text-[11px]">
                    {isEn ? 'Parent Category' : 'মূল ক্যাটাগরি'}
                  </label>
                  <div className="p-2.5 bg-slate-100 rounded-xl text-slate-800 font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    <span>{isEn && currentParentCat?.nameEn ? currentParentCat.nameEn : currentParentCat?.name || 'Category'}</span>
                  </div>
                </div>
              )}

              {/* Single clean name input */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {categoryModalMode === 'subcategory'
                    ? isEn
                      ? 'Sub-Category Name'
                      : 'উপ-খাত / সাব-ক্যাটাগরির নাম'
                    : isEn
                    ? 'Category Name'
                    : 'খাত / ক্যাটাগরির নাম'}
                </label>
                <input
                  type="text"
                  placeholder={
                    categoryModalMode === 'subcategory'
                      ? isEn
                        ? 'e.g. Bus Fare, Gas Bill...'
                        : 'যেমন: বাস ভাড়া, গ্যাস বিল'
                      : isEn
                      ? 'e.g. Transportation, Utilities...'
                      : 'যেমন: যাতায়াত, বাড়ি ভাড়া, পাইকারি ক্রয়'
                  }
                  value={singleCatName}
                  onChange={(e) => setSingleCatName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  required
                  autoFocus
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold shadow-xs transition-colors"
                >
                  {isEn ? 'Save' : 'সংরক্ষণ করুন'}
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryModalMode(null)}
                  className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add Person / Member Modal for Business (Issue #3) */}
      {showAddPartyModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 text-xs animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-700" />
                <h3 className="font-bold text-slate-800 text-sm">
                  {isEn ? 'Add Person to Business Ledger' : 'ব্যবসায় নতুন ব্যক্তি যোগ করুন'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddPartyModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateParty} className="space-y-3 pt-3">
              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  {isEn ? 'Person Name *' : 'ব্যক্তির নাম *'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? 'e.g. Rafiq Ahmed' : 'যেমন: মো: করিম সাহেব'}
                  value={newPartyName}
                  onChange={(e) => setNewPartyName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  {isEn ? 'Role in Business' : 'ব্যবসার সাথে সম্পর্ক / পদবি'}
                </label>
                <AppSelect aria-label={isEn ? 'Role in Business' : 'ব্যবসার সাথে সম্পর্ক'}
                  value={newPartyRole}
                  onChange={(e) => setNewPartyRole(e.target.value as PartyRole)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 font-medium"
                >
                  <option value="partner">{isEn ? 'Partner / Co-Owner' : 'অংশীদার / পার্টনার'}</option>
                  <option value="staff">{isEn ? 'Staff / Employee' : 'কর্মচারী / স্টাফ'}</option>
                  <option value="customer">{isEn ? 'Customer / Client' : 'গ্রাহক / কাস্টমার'}</option>
                  <option value="supplier">{isEn ? 'Supplier / Vendor' : 'সরবরাহকারী / মহাজন'}</option>
                  <option value="other">{isEn ? 'Other' : 'অন্যান্য'}</option>
                </AppSelect>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  {isEn ? 'Phone Number (Optional)' : 'মোবাইল নম্বর (ঐচ্ছিক)'}
                </label>
                <input
                  type="tel"
                  placeholder="017xxxxxxxx"
                  value={newPartyPhone}
                  onChange={(e) => setNewPartyPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold shadow-xs transition-colors"
                >
                  {isEn ? 'Add Person' : 'যুক্ত করুন'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddPartyModal(false)}
                  className="px-3 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
                >
                  {isEn ? 'Cancel' : 'বাতিল'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Account Picker Modals */}
      <AccountPickerModal
        isOpen={showAccountPicker}
        onClose={() => setShowAccountPicker(false)}
        accounts={activeAccounts}
        selectedAccountId={accountId}
        onSelectAccount={(id) => {
          setAccountId(id);
          if (!isAIForm && type === 'transfer' && id === toAccountId) {
            const nextTo = activeAccounts.find((a) => a.id !== id);
            if (nextTo) setToAccountId(nextTo.id);
          }
        }}
        title={
          type === 'transfer'
            ? isEn
              ? 'Select Source Account (From)'
              : 'উৎস অ্যাকাউন্ট নির্বাচন করুন'
            : isEn
            ? 'Select Account / Wallet'
            : 'অ্যাকাউন্ট / ওয়ালেট নির্বাচন করুন'
        }
        excludeAccountId={type === 'transfer' ? toAccountId : undefined}
        language={language}
        getBalance={getAccountBalance}
      />

      <AccountPickerModal
        isOpen={showToAccountPicker}
        onClose={() => setShowToAccountPicker(false)}
        accounts={activeAccounts}
        selectedAccountId={toAccountId}
        onSelectAccount={(id) => setToAccountId(id)}
        title={isEn ? 'Select Destination Account (To)' : 'গন্তব্য অ্যাকাউন্ট নির্বাচন করুন'}
        excludeAccountId={accountId}
        language={language}
        getBalance={getAccountBalance}
      />
    </div>
  );
};
