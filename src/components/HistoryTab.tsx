import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { formatBDT, parsePaisaString, normalizeNumericAmountInput } from '../domain/money';
import {
  Search,
  Filter,
  TrendingDown,
  TrendingUp,
  ArrowRightLeft,
  AlertCircle,
  Receipt,
  RotateCcw,
  X,
  Check,
  Calendar,
  Layers,
  Edit3,
  Trash2,
  AlertTriangle,
  User,
  Users,
  Phone
} from 'lucide-react';
import { JournalTransaction, PartyRole } from '../contracts/types';

interface HistoryTabProps {
  selectedTransaction?: JournalTransaction | null;
  onClearSelected: () => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({
  selectedTransaction: propSelectedTx,
  onClearSelected,
}) => {
  const {
    transactions,
    accounts,
    categories,
    parties,
    currentWorkspace,
    language,
    db,
    refreshState,
    triggerManualSync,
    deleteTransaction,
    editTransaction,
    isOnline,
  } = useApp();

  const isEn = language === 'en';
  const isBusiness = currentWorkspace?.kind === 'business';

  const [searchTerm, setSearchTerm] = useState('');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense' | 'transfer' | 'correction'>(
    'all'
  );
  const [partyFilter, setPartyFilter] = useState<string>('all');

  const [activeModalTx, setActiveModalTx] = useState<JournalTransaction | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Edit form state
  const [editAmountStr, setEditAmountStr] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editPartyId, setEditPartyId] = useState<string>('');
  const [editEffectiveDate, setEditEffectiveDate] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Handle selected transaction from outside
  React.useEffect(() => {
    if (propSelectedTx) {
      handleOpenDetail(propSelectedTx);
    }
  }, [propSelectedTx]);

  const accountsMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoriesMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const partiesMap = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);

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
        return isEn ? 'Member' : 'সদস্য';
    }
  };

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return transactions.filter((tx) => {
      // Period filter
      if (periodFilter === 'today' && tx.effectiveDate !== todayStr) return false;
      if (periodFilter === 'month' && !tx.effectiveDate.startsWith(currentMonthPrefix)) return false;

      // Type filter
      if (typeFilter !== 'all') {
        if (typeFilter === 'correction' && tx.transactionType !== 'reversal') return false;
        if (typeFilter !== 'correction' && tx.transactionType !== typeFilter) return false;
      }

      // Party filter
      if (partyFilter !== 'all') {
        if (partyFilter === 'none' && tx.partyId) return false;
        if (partyFilter !== 'none' && tx.partyId !== partyFilter) return false;
      }

      // Search term
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const noteMatch = (tx.note || '').toLowerCase().includes(term);
        const catMatch = tx.lines.some((l) => {
          if (!l.categoryId) return false;
          const cat = categoriesMap.get(l.categoryId);
          return (
            (cat?.name || '').toLowerCase().includes(term) ||
            (cat?.nameEn || '').toLowerCase().includes(term)
          );
        });
        const accMatch = tx.lines.some((l) => {
          const acc = accountsMap.get(l.accountId);
          return (acc?.name || '').toLowerCase().includes(term);
        });
        const partyMatch = tx.partyId ? (partiesMap.get(tx.partyId)?.name || '').toLowerCase().includes(term) : false;
        if (!noteMatch && !catMatch && !accMatch && !partyMatch) return false;
      }

      return true;
    });
  }, [transactions, periodFilter, typeFilter, partyFilter, searchTerm, categoriesMap, accountsMap, partiesMap]);

  const handleOpenDetail = (tx: JournalTransaction) => {
    setActiveModalTx(tx);
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setEditError(null);

    // Find original amount
    const primaryLine = tx.lines.find((l) => l.debitMinor !== '0' || l.creditMinor !== '0');
    const amountVal = primaryLine
      ? primaryLine.debitMinor !== '0'
        ? primaryLine.debitMinor
        : primaryLine.creditMinor
      : '0';

    const paisaNum = Number(amountVal) / 100;
    setEditAmountStr(paisaNum > 0 ? paisaNum.toFixed(2) : '');
    setEditAccountId(tx.lines[0]?.accountId || accounts[0]?.id || '');
    setEditCategoryId(tx.lines.find((l) => l.categoryId)?.categoryId || categories[0]?.id || '');
    setEditPartyId(tx.partyId || '');
    setEditEffectiveDate(tx.effectiveDate);
    setEditNote(tx.note || '');
  };

  const handleCloseModal = () => {
    setActiveModalTx(null);
    setIsEditing(false);
    setShowDeleteConfirm(false);
    onClearSelected();
  };

  // Safe Transaction Deletion (Balanced Double-Entry Reversal + Outbox)
  const handleDeleteTransaction = async () => {
    if (!activeModalTx) return;
    setIsDeleting(true);
    try {
      await deleteTransaction(
        activeModalTx.id,
        isEn ? 'Deleted by user from history' : 'ব্যবহারকারী কর্তৃক লেনদেন মুছে ফেলা হয়েছে'
      );
      handleCloseModal();
    } catch (err: any) {
      alert(err.message || 'Failed to delete transaction');
    } finally {
      setIsDeleting(false);
    }
  };

  // Safe Transaction Edit Execution
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeModalTx) return;
    setEditError(null);

    try {
      const parsedPaisa = parsePaisaString(editAmountStr);
      if (parsedPaisa <= 0n) {
        setEditError(isEn ? 'Amount must be greater than zero' : 'টাকার পরিমাণ শূন্যের চেয়ে বেশি হতে হবে');
        return;
      }

      await editTransaction(activeModalTx.id, {
        amountMinor: parsedPaisa.toString(),
        effectiveDate: editEffectiveDate,
        assetAccountId: editAccountId,
        categoryId: editCategoryId,
        partyId: editPartyId || null,
        note: editNote.trim() || undefined,
        reason: isEn ? 'User edited transaction' : 'ব্যবহারকারী কর্তৃক লেনদেন সংশোধন',
      });

      handleCloseModal();
    } catch (err: any) {
      setEditError(err.message || (isEn ? 'Failed to update transaction' : 'লেনদেন আপডেট ব্যর্থ হয়েছে'));
    }
  };

  return (
    <div className="space-y-4 pb-24 animate-in fade-in text-xs">
      <div>
        <h1 className="text-base font-bold text-slate-800 tracking-tight">
          {isEn ? 'Transaction History & Search' : 'লেনদেনের ইতিহাস ও অনুসন্ধান'}
        </h1>
        <p className="text-slate-500 text-[11px]">
          {isEn
            ? 'Complete double-entry journal with editable records and audit log'
            : 'অডিট ট্রেইল এবং রদবদল রেকর্ডসহ পূর্ণ বিবরণ'}
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder={
            isEn
              ? 'Search by note, category, account, or person...'
              : 'বিবরণ, খাত, অ্যাকাউন্ট বা ব্যক্তির নাম দিয়ে খুঁজুন...'
          }
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 shadow-xs"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Filters: Period, Type & Party */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Period Chips */}
        <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg font-medium">
          {(['all', 'today', 'month'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriodFilter(p)}
              className={`px-2.5 py-1 rounded-md text-[11px] capitalize transition-colors ${
                periodFilter === p
                  ? 'bg-white text-slate-900 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {p === 'all'
                ? isEn
                  ? 'All'
                  : 'সকল'
                : p === 'today'
                ? isEn
                  ? 'Today'
                  : 'আজ'
                : isEn
                ? 'This Month'
                : 'এই মাস'}
            </button>
          ))}
        </div>

        {/* Filter Dropdowns */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Party Filter (for business workspaces) */}
          {isBusiness && parties.length > 0 && (
            <select
              value={partyFilter}
              onChange={(e) => setPartyFilter(e.target.value)}
              className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 shadow-xs focus:outline-none"
            >
              <option value="all">{isEn ? 'All Persons / Parties' : 'সকল ব্যক্তি / সদস্য'}</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({getRoleLabel(p.role)})
                </option>
              ))}
              <option value="none">{isEn ? 'General (No Person)' : 'ব্যক্তি ছাড়া (সাধারণ)'}</option>
            </select>
          )}

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 shadow-xs focus:outline-none"
          >
            <option value="all">{isEn ? 'All Types' : 'সকল ধরণ'}</option>
            <option value="expense">{isEn ? 'Expenses' : 'খরচ'}</option>
            <option value="income">{isEn ? 'Income' : 'আয়'}</option>
            <option value="transfer">{isEn ? 'Transfers' : 'স্থানান্তর'}</option>
            <option value="correction">{isEn ? 'Reversals / Corrections' : 'রিভার্সাল / সংশোধন'}</option>
          </select>
        </div>
      </div>

      {/* Transactions List */}
      <div className="space-y-2">
        {filteredTransactions.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Search className="w-5 h-5" />
            </div>
            <div className="font-bold text-slate-700">
              {isEn ? 'No Transactions Found' : 'কোনো লেনদেন পাওয়া যায়নি'}
            </div>
            <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
              {searchTerm || periodFilter !== 'all' || typeFilter !== 'all' || partyFilter !== 'all'
                ? isEn
                  ? 'Try adjusting your filters or search keywords.'
                  : 'অনুগ্রহ করে ফিল্টার পরিবর্তন করুন।'
                : isEn
                ? 'Fresh install has zero mock transactions. Add an entry or sync with Google Drive.'
                : 'নতুন ইনস্টলে কোনো কৃত্রিম ডাটা নেই। নতুন লেনদেন যোগ করুন বা গুগল ড্রাইভে সিঙ্ক করুন।'}
            </p>
          </div>
        ) : (
          filteredTransactions.map((tx) => {
            const isExpense = tx.transactionType === 'expense';
            const isIncome = tx.transactionType === 'income';
            const isTransfer = tx.transactionType === 'transfer';
            const isReversal = tx.transactionType === 'reversal';

            // Find effective display amount
            let displayAmountMinor = '0';
            for (const l of tx.lines) {
              if (isExpense && l.debitMinor !== '0' && l.categoryId) {
                displayAmountMinor = l.debitMinor;
                break;
              }
              if (isIncome && l.creditMinor !== '0' && l.categoryId) {
                displayAmountMinor = l.creditMinor;
                break;
              }
              if (isTransfer && l.debitMinor !== '0') {
                displayAmountMinor = l.debitMinor;
                break;
              }
              if (l.debitMinor !== '0') displayAmountMinor = l.debitMinor;
            }

            // Find category, account, and party name
            const firstCategoryLine = tx.lines.find((l) => l.categoryId);
            const cat = firstCategoryLine ? categoriesMap.get(firstCategoryLine.categoryId!) : null;
            const primaryAcc = accountsMap.get(tx.lines[0]?.accountId);
            const party = tx.partyId ? partiesMap.get(tx.partyId) : null;

            const isDeleted = (tx as any).isDeleted;

            return (
              <div
                key={tx.id}
                onClick={() => handleOpenDetail(tx)}
                className={`p-3.5 bg-white rounded-xl border transition-all cursor-pointer hover:shadow-xs flex items-center justify-between gap-3 ${
                  isDeleted
                    ? 'border-rose-200 bg-rose-50/30 opacity-75'
                    : isReversal
                    ? 'border-purple-200 bg-purple-50/20'
                    : 'border-slate-200 hover:border-blue-300'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isExpense
                        ? 'bg-rose-50 text-rose-600'
                        : isIncome
                        ? 'bg-emerald-50 text-emerald-600'
                        : isTransfer
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-purple-50 text-purple-600'
                    }`}
                  >
                    {isExpense ? (
                      <TrendingDown className="w-4 h-4" />
                    ) : isIncome ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : isTransfer ? (
                      <ArrowRightLeft className="w-4 h-4" />
                    ) : (
                      <RotateCcw className="w-4 h-4" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 truncate flex items-center gap-1.5 flex-wrap">
                      <span>
                        {cat
                          ? isEn && cat.nameEn
                            ? cat.nameEn
                            : cat.name
                          : tx.note || (isEn ? 'Journal Entry' : 'জার্নাল এন্ট্রি')}
                      </span>
                      {party && (
                        <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.2 rounded font-semibold border border-blue-200 inline-flex items-center gap-1">
                          <User className="w-2.5 h-2.5" />
                          <span>{party.name}</span>
                        </span>
                      )}
                      {isDeleted && (
                        <span className="text-[9px] bg-rose-100 text-rose-700 px-1 py-0.2 rounded font-semibold">
                          {isEn ? 'Deleted' : 'বাতিল'}
                        </span>
                      )}
                      {isReversal && (
                        <span className="text-[9px] bg-purple-100 text-purple-700 px-1 py-0.2 rounded font-semibold">
                          {isEn ? 'Reversal' : 'সংশোধন'}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate flex items-center gap-1.5 mt-0.5">
                      <span>{tx.effectiveDate}</span>
                      <span>•</span>
                      <span>{primaryAcc?.name || 'Account'}</span>
                      {tx.note && <span className="truncate max-w-[140px] text-slate-400">• {tx.note}</span>}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div
                    className={`font-bold tabular-nums text-sm ${
                      isDeleted
                        ? 'line-through text-slate-400'
                        : isExpense
                        ? 'text-rose-600'
                        : isIncome
                        ? 'text-emerald-600'
                        : isTransfer
                        ? 'text-blue-600'
                        : 'text-purple-600'
                    }`}
                  >
                    {isExpense ? '-' : isIncome ? '+' : ''}
                    {formatBDT(displayAmountMinor, { locale: language })}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {isEn ? 'Tap to view / edit' : 'বিস্তারিত / এডিট'}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Transaction Detail & Actions Modal */}
      {activeModalTx && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-700" />
                <h3 className="font-bold text-slate-800">
                  {isEditing
                    ? isEn
                      ? 'Edit Transaction'
                      : 'লেনদেন এডিট করুন'
                    : showDeleteConfirm
                    ? isEn
                      ? 'Delete Confirmation'
                      : 'লেনদেন মুছে ফেলার নিশ্চিতকরণ'
                    : isEn
                    ? 'Transaction Details'
                    : 'লেনদেনের বিস্তারিত ও অডিট ট্রেইল'}
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* View Mode */}
            {!isEditing && !showDeleteConfirm && (
              <div className="space-y-4 pt-3">
                <div className="grid grid-cols-2 gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-slate-400 text-[10px]">
                      {isEn ? 'Date' : 'তারিখ'}
                    </span>
                    <div className="font-semibold text-slate-800">{activeModalTx.effectiveDate}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px]">
                      {isEn ? 'Type' : 'ধরণ'}
                    </span>
                    <div className="font-semibold text-slate-800 uppercase">
                      {activeModalTx.transactionType}
                    </div>
                  </div>

                  {/* Associated Person / Party */}
                  {activeModalTx.partyId && partiesMap.get(activeModalTx.partyId) && (
                    <div className="col-span-2 p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg">
                      <span className="text-blue-700 font-bold text-[10px] uppercase block mb-1">
                        {isEn ? 'Associated Person / Party' : 'সংশ্লিষ্ট ব্যক্তি / পক্ষ'}
                      </span>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-bold text-slate-900">
                          <User className="w-3.5 h-3.5 text-blue-700" />
                          <span>{partiesMap.get(activeModalTx.partyId)?.name}</span>
                          <span className="text-[10px] px-1.5 py-0.2 bg-white rounded border border-blue-200 text-blue-700">
                            {getRoleLabel(partiesMap.get(activeModalTx.partyId)!.role)}
                          </span>
                        </div>
                        {partiesMap.get(activeModalTx.partyId)?.phone && (
                          <a
                            href={`tel:${partiesMap.get(activeModalTx.partyId)!.phone}`}
                            className="text-[11px] text-blue-700 hover:underline flex items-center gap-1"
                          >
                            <Phone className="w-3 h-3" />
                            <span>{partiesMap.get(activeModalTx.partyId)!.phone}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="col-span-2">
                    <span className="text-slate-400 text-[10px]">
                      {isEn ? 'Note / Description' : 'বিবরণ / নোট'}
                    </span>
                    <div className="font-semibold text-slate-800">
                      {activeModalTx.note || (isEn ? 'No note provided' : 'কোনো বিবরণ দেওয়া হয়নি')}
                    </div>
                  </div>
                </div>

                {/* Balanced Double-Entry Lines */}
                <div>
                  <h4 className="font-bold text-slate-700 mb-2 flex items-center gap-1.5 text-xs">
                    <Layers className="w-3.5 h-3.5 text-blue-700" />
                    <span>
                      {isEn
                        ? 'Balanced Journal Lines (Debits & Credits)'
                        : 'জার্নাল এন্ট্রি লাইন (Balanced Debits & Credits)'}
                    </span>
                  </h4>
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                    <div className="grid grid-cols-3 p-2 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase">
                      <span>{isEn ? 'Account / Category' : 'খাত / অ্যাকাউন্ট'}</span>
                      <span className="text-right">{isEn ? 'Debit ৳' : 'ডেবিট ৳'}</span>
                      <span className="text-right">{isEn ? 'Credit ৳' : 'ক্রেডিট ৳'}</span>
                    </div>
                    {activeModalTx.lines.map((line) => {
                      const acc = accountsMap.get(line.accountId);
                      const cat = line.categoryId ? categoriesMap.get(line.categoryId) : null;
                      return (
                        <div key={line.id} className="grid grid-cols-3 p-2 text-xs">
                          <span className="truncate font-medium text-slate-800">
                            {cat ? (isEn && cat.nameEn ? cat.nameEn : cat.name) : acc ? acc.name : line.accountId}
                          </span>
                          <span className="text-right font-semibold text-slate-700 tabular-nums">
                            {line.debitMinor !== '0'
                              ? formatBDT(line.debitMinor, { locale: language })
                              : '-'}
                          </span>
                          <span className="text-right font-semibold text-slate-700 tabular-nums">
                            {line.creditMinor !== '0'
                              ? formatBDT(line.creditMinor, { locale: language })
                              : '-'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Action Buttons: Edit and Delete */}
                {activeModalTx.transactionType !== 'reversal' && !(activeModalTx as any).isDeleted && (
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="flex-1 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-xs transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Edit Entry' : 'এডিট করুন'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Delete' : 'মুছে ফেলুন'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Delete Confirmation Dialog */}
            {showDeleteConfirm && (
              <div className="space-y-4 pt-3 text-xs">
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-rose-800">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>
                      {isEn ? 'Are you sure you want to delete?' : 'আপনি কি নিশ্চিত মুছে ফেলতে চান?'}
                    </span>
                  </div>
                  <p className="text-[11px] text-rose-700 leading-relaxed">
                    {isEn
                      ? 'This entry will be voided using balanced double-entry accounting. Your account balance will be restored, and the change will sync to Google Drive.'
                      : 'এই লেনদেনটি ডাবল-এন্ট্রি হিসাবের অডিট ট্রেইল অনুযায়ী বাতিল হবে এবং অ্যাকাউন্টের ব্যালেন্স পূর্বাবস্থায় ফিরে আসবে।'}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDeleteTransaction}
                    disabled={isDeleting}
                    className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>
                      {isDeleting
                        ? isEn
                          ? 'Deleting...'
                          : 'মুছে ফেলা হচ্ছে...'
                        : isEn
                        ? 'Confirm Delete'
                        : 'হ্যাঁ, মুছে ফেলুন'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
                  >
                    {isEn ? 'Cancel' : 'বাতিল'}
                  </button>
                </div>
              </div>
            )}

            {/* Edit Form */}
            {isEditing && (
              <form onSubmit={handleSaveEdit} className="space-y-3 pt-3 text-xs">
                {editError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-[11px]">
                    {editError}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-700 font-semibold">
                      {isEn ? 'New Amount (BDT)' : 'নতুন টাকার অঙ্ক (BDT)'}
                    </label>
                    <span className="text-[10px] text-slate-400">
                      {isEn ? 'Auto Bengali-to-English' : 'বাংলা লিখলেও সংখ্যায় রূপান্তর'}
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-base">
                      ৳
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editAmountStr}
                      onChange={(e) => setEditAmountStr(normalizeNumericAmountInput(e.target.value))}
                      className="w-full pl-7 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 tabular-nums"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    {isEn ? 'Account' : 'অ্যাকাউন্ট'}
                  </label>
                  <select
                    value={editAccountId}
                    onChange={(e) => setEditAccountId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    {isEn ? 'Category' : 'ক্যাটাগরি'}
                  </label>
                  <select
                    value={editCategoryId}
                    onChange={(e) => setEditCategoryId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {isEn && c.nameEn ? c.nameEn : c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Edit Associated Person / Party for Business Ledgers */}
                {isBusiness && (
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      {isEn ? 'Associated Person / Party' : 'সংশ্লিষ্ট ব্যক্তি / সদস্য'}
                    </label>
                    <select
                      value={editPartyId}
                      onChange={(e) => setEditPartyId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value="">{isEn ? '-- None (General) --' : '-- কোনো ব্যক্তি নয় (সাধারণ) --'}</option>
                      {parties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({getRoleLabel(p.role)})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    {isEn ? 'Date' : 'তারিখ'}
                  </label>
                  <input
                    type="date"
                    value={editEffectiveDate}
                    onChange={(e) => setEditEffectiveDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    {isEn ? 'Note / Description' : 'বিবরণ / নোট'}
                  </label>
                  <input
                    type="text"
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold"
                  >
                    {isEn ? 'Save Changes' : 'পরিবর্তন সংরক্ষণ করুন'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
                  >
                    {isEn ? 'Back' : 'ফিরে যান'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
