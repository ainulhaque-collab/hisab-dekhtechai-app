import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { formatBDT, parsePaisaString } from '../domain/money';
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
  Layers
} from 'lucide-react';
import { JournalTransaction, SyncOperation } from '../contracts/types';
import {
  buildReversalJournal,
  buildExpenseJournal,
  buildIncomeJournal,
  generateUUID
} from '../domain/journal';
import { canonicalJson, computeSha256 } from '../sync/canonical';

interface HistoryTabProps {
  selectedTransaction?: JournalTransaction | null;
  onClearSelected: () => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({
  selectedTransaction: propSelectedTx,
  onClearSelected,
}) => {
  const { transactions, accounts, categories, language, db, refreshState, triggerManualSync, isOnline } =
    useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense' | 'transfer' | 'correction'>(
    'all'
  );

  const [activeModalTx, setActiveModalTx] = useState<JournalTransaction | null>(null);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionNote, setCorrectionNote] = useState('');
  const [newAmountStr, setNewAmountStr] = useState('');
  const [newNote, setNewNote] = useState('');

  // Handle selected transaction from outside
  React.useEffect(() => {
    if (propSelectedTx) {
      setActiveModalTx(propSelectedTx);
    }
  }, [propSelectedTx]);

  const accountsMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoriesMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

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

      // Search term
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const noteMatch = (tx.note || '').toLowerCase().includes(term);
        const catMatch = tx.lines.some((l) => {
          if (!l.categoryId) return false;
          const cat = categoriesMap.get(l.categoryId);
          return (cat?.name || '').toLowerCase().includes(term);
        });
        const accMatch = tx.lines.some((l) => {
          const acc = accountsMap.get(l.accountId);
          return (acc?.name || '').toLowerCase().includes(term);
        });
        if (!noteMatch && !catMatch && !accMatch) return false;
      }

      return true;
    });
  }, [transactions, periodFilter, typeFilter, searchTerm, categoriesMap, accountsMap]);

  const handleOpenDetail = (tx: JournalTransaction) => {
    setActiveModalTx(tx);
    setIsCorrecting(false);
  };

  const handleCloseModal = () => {
    setActiveModalTx(null);
    setIsCorrecting(false);
    onClearSelected();
  };

  // Safe Reversible Correction Execution
  const handleApplyCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeModalTx) return;

    try {
      const parsedNewPaisa = parsePaisaString(newAmountStr);
      if (parsedNewPaisa <= 0n) {
        alert('সঠিক নতুন টাকার অঙ্ক লিখুন');
        return;
      }

      const opId = generateUUID();
      // 1. Build reversal journal of original transaction
      const reversalBalanced = buildReversalJournal(
        activeModalTx,
        opId,
        correctionNote.trim() || 'ব্যবহারকারীর সংশোধন'
      );

      // 2. Build replacement transaction
      const origLine = activeModalTx.lines.find((l) => l.debitMinor !== '0' || l.creditMinor !== '0');
      const assetAccountId = activeModalTx.lines[0].accountId;
      const categoryId = activeModalTx.lines.find((l) => l.categoryId)?.categoryId || 'cat-food';

      let replacementBalanced;
      if (activeModalTx.transactionType === 'income') {
        replacementBalanced = buildIncomeJournal({
          workspaceId: activeModalTx.workspaceId,
          assetAccountId,
          revenueCategoryId: categoryId,
          amountMinor: parsedNewPaisa.toString(),
          effectiveDate: activeModalTx.effectiveDate,
          note: newNote.trim() || activeModalTx.note,
          opId,
        });
      } else {
        replacementBalanced = buildExpenseJournal({
          workspaceId: activeModalTx.workspaceId,
          assetAccountId,
          expenseCategoryId: categoryId,
          amountMinor: parsedNewPaisa.toString(),
          effectiveDate: activeModalTx.effectiveDate,
          note: newNote.trim() || activeModalTx.note,
          opId,
        });
      }

      const payload = {
        originalTransactionId: activeModalTx.id,
        reversalBalanced,
        replacementBalanced,
        baseRevision: 'v1',
        note: correctionNote.trim(),
      };

      const opCanonical = canonicalJson(payload);
      const contentSha256 = await computeSha256(opCanonical);

      const op: SyncOperation = {
        protocolVersion: 1,
        ownerHash: db.getIdentity()?.ownerSubjectHash || 'owner',
        deviceId: db.getDeviceId(),
        seq: db.getNextDeviceSeq(),
        operationId: opId,
        entityId: activeModalTx.id,
        type: 'journal.correct',
        baseRevision: 'v1',
        createdAtUtc: new Date().toISOString(),
        payload,
        contentSha256,
      };

      // Apply reversal & replacement atomically
      const state = db.getRawState();
      state.journalTransactions.set(reversalBalanced.transaction.id, {
        ...reversalBalanced.transaction,
        createdOpId: opId,
        lines: reversalBalanced.lines,
      });
      for (const line of reversalBalanced.lines) {
        state.journalLines.set(line.id, line);
      }

      state.journalTransactions.set(replacementBalanced.transaction.id, {
        ...replacementBalanced.transaction,
        createdOpId: opId,
        lines: replacementBalanced.lines,
      });
      for (const line of replacementBalanced.lines) {
        state.journalLines.set(line.id, line);
      }

      // Add to outbox & applied
      state.syncOperations.set(opId, op);
      state.syncOutbox.set(opId, {
        opId,
        uploadedStatus: 'pending',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      });
      state.appliedOperations.add(opId);

      await db.persist();
      refreshState();

      if (isOnline) {
        triggerManualSync().catch(console.error);
      }

      handleCloseModal();
    } catch (err: any) {
      alert(`রদবদল ব্যর্থ: ${err.message}`);
    }
  };

  return (
    <div className="space-y-4 pb-24 animate-in fade-in">
      <div>
        <h1 className="text-base font-bold text-slate-800 tracking-tight">লেনদেনের ইতিহাস ও অনুসন্ধান</h1>
        <p className="text-xs text-slate-500">অডিট ট্রেইল এবং রদবদল রেকর্ডসহ পূর্ণ বিবরণ</p>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="বিবরণ, খাত বা অ্যাকাউন্ট দিয়ে খুঁজুন..."
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

      {/* Filters: Period & Type */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Period Chips */}
        <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg font-medium">
          {(['all', 'today', 'month'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriodFilter(p)}
              className={`px-2.5 py-1 rounded-md transition-all ${
                periodFilter === p
                  ? 'bg-white text-blue-700 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {p === 'all' ? 'সব' : p === 'today' ? 'আজ' : 'এই মাস'}
            </button>
          ))}
        </div>

        {/* Type Select */}
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-slate-500" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">সকল ধরণ</option>
            <option value="expense">খরচ</option>
            <option value="income">আয়</option>
            <option value="transfer">স্থানান্তর</option>
            <option value="correction">সংশোধন / রিভার্সাল</option>
          </select>
        </div>
      </div>

      {/* Transactions List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs divide-y divide-slate-100 overflow-hidden">
        {filteredTransactions.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            কোনো লেনদেন পাওয়া যায়নি।
          </div>
        ) : (
          filteredTransactions.map((tx) => {
            const isIncome = tx.transactionType === 'income';
            const isExpense = tx.transactionType === 'expense';
            const isTransfer = tx.transactionType === 'transfer';
            const isReversal = tx.transactionType === 'reversal';

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
            } else if (isReversal) {
              const line = tx.lines.find((l) => l.creditMinor !== '0' || l.debitMinor !== '0');
              displayAmount = line ? (line.debitMinor !== '0' ? line.debitMinor : line.creditMinor) : '0';
            }

            return (
              <div
                key={tx.id}
                onClick={() => handleOpenDetail(tx)}
                className="p-3.5 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
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
                      <RotateCcw className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800 line-clamp-1">
                      {tx.note || (isIncome ? 'আয়' : isExpense ? 'খরচ' : isTransfer ? 'স্থানান্তর' : 'রিভার্সাল')}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                      <span>{tx.effectiveDate}</span>
                      {tx.reversalOf && (
                        <span className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded font-semibold">
                          রদবদল
                        </span>
                      )}
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
                        : isTransfer
                        ? 'text-blue-700'
                        : 'text-purple-700'
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
          })
        )}
      </div>

      {/* Transaction Details & Reversible Correction Modal */}
      {activeModalTx && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">লেনদেনের বিস্তারিত ও জার্নাল</h3>
              <button
                type="button"
                onClick={handleCloseModal}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!isCorrecting ? (
              <div className="space-y-4 pt-3 text-xs">
                {/* Meta details */}
                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-slate-400 text-[10px]">তারিখ (Effective Date)</span>
                    <div className="font-semibold text-slate-800">{activeModalTx.effectiveDate}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px]">ধরণ (Type)</span>
                    <div className="font-semibold text-slate-800 uppercase">
                      {activeModalTx.transactionType}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 text-[10px]">বিবরণ / নোট</span>
                    <div className="font-semibold text-slate-800">
                      {activeModalTx.note || 'কোনো বিবরণ দেওয়া হয়নি'}
                    </div>
                  </div>
                </div>

                {/* Double-Entry Journal Lines Breakdown */}
                <div>
                  <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-700" />
                    <span>জার্নাল এন্ট্রি লাইন (Balanced Debits & Credits)</span>
                  </h4>
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                    <div className="grid grid-cols-3 p-2 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase">
                      <span>খাত / অ্যাকাউন্ট</span>
                      <span className="text-right">ডেবিট ৳</span>
                      <span className="text-right">ক্রেডিট ৳</span>
                    </div>
                    {activeModalTx.lines.map((line) => {
                      const acc = accountsMap.get(line.accountId);
                      const cat = line.categoryId ? categoriesMap.get(line.categoryId) : null;
                      return (
                        <div key={line.id} className="grid grid-cols-3 p-2 text-xs">
                          <span className="truncate font-medium text-slate-800">
                            {cat ? cat.name : acc ? acc.name : line.accountId}
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

                {/* Audit & Operation Provenance */}
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-[11px] text-slate-500 space-y-1 font-mono">
                  <div>ট্রানজ্যাকশন আইডি: {activeModalTx.id}</div>
                  <div>সিঙ্ক অপারেশন আইডি: {activeModalTx.createdOpId}</div>
                  <div>UTC সময়: {activeModalTx.occurredAtUtc}</div>
                  {activeModalTx.reversalOf && (
                    <div className="text-purple-700 font-semibold">
                      পূর্ববর্তী রিভার্সাল অব: {activeModalTx.reversalOf}
                    </div>
                  )}
                </div>

                {/* Reversible Correction Button */}
                {activeModalTx.transactionType !== 'reversal' && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCorrecting(true);
                      setNewNote(activeModalTx.note || '');
                    }}
                    className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-sm transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>রদবদল / সংশোধন করুন (Reversible Correction)</span>
                  </button>
                )}
              </div>
            ) : (
              /* Correction Form */
              <form onSubmit={handleApplyCorrection} className="space-y-3 pt-3 text-xs">
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl">
                  <span className="font-bold block mb-1">অপরিবর্তনীয় অডিট ট্রেইল সতর্কতা:</span>
                  পূর্বের এন্ট্রি মুছে ফেলা হবে না; একটি স্বয়ংক্রিয় রিভার্সাল এবং সংশোধিত নতুন
                  এন্ট্রি ডাটাবেজে যুক্ত হবে।
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    নতুন টাকার পরিমাণ (New Amount ৳)
                  </label>
                  <input
                    type="text"
                    placeholder="0.00"
                    value={newAmountStr}
                    onChange={(e) => setNewAmountStr(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-base font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 tabular-nums"
                    autoFocus
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    সংশোধিত বিবরণ / নোট
                  </label>
                  <input
                    type="text"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    সংশোধনের কারণ (Audit Reason)
                  </label>
                  <input
                    type="text"
                    placeholder="যেমন: টাকার অঙ্ক টাইপো হয়েছিল"
                    value={correctionNote}
                    onChange={(e) => setCorrectionNote(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    required
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold"
                  >
                    সংশোধন নিশ্চিত করুন
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCorrecting(false)}
                    className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
                  >
                    ফিরে যান
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
