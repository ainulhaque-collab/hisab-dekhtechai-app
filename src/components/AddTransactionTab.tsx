import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  toPaisa,
  parsePaisaString,
  formatBDT,
  paisaToDecimalString
} from '../domain/money';
import {
  buildIncomeJournal,
  buildExpenseJournal,
  buildTransferJournal,
  generateUUID
} from '../domain/journal';
import { SyncOperation } from '../contracts/types';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import {
  TrendingDown,
  TrendingUp,
  ArrowRightLeft,
  Calendar,
  FileText,
  Camera,
  Check,
  AlertCircle,
  X
} from 'lucide-react';

interface AddTransactionTabProps {
  onSuccess: () => void;
}

export const AddTransactionTab: React.FC<AddTransactionTabProps> = ({ onSuccess }) => {
  const { db, currentWorkspace, accounts, categories, language, refreshState, triggerManualSync, isOnline } =
    useApp();

  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id || accounts[0]?.id || '');
  const [categoryId, setCategoryId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  });
  const [note, setNote] = useState('');
  const [feeStr, setFeeStr] = useState('');
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [receiptBase64, setReceiptBase64] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState(false);

  // Filter categories by type
  const availableCategories = categories.filter((c) =>
    type === 'income' ? c.kind === 'income' : c.kind === 'expense'
  );

  // Set default category when type changes if not selected
  React.useEffect(() => {
    if (availableCategories.length > 0 && (!categoryId || !availableCategories.find((c) => c.id === categoryId))) {
      setCategoryId(availableCategories[0].id);
    }
  }, [type, availableCategories, categoryId]);

  const quickAmounts = ['100', '500', '1000', '2000', '5000'];

  const handleQuickAmount = (val: string) => {
    setAmountStr(val);
  };

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg('রসিদের আকার ২ মেগাবাইটের কম হতে হবে');
      return;
    }

    setReceiptName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setReceiptBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!currentWorkspace) {
      setErrorMsg('কোনো সক্রিয় খাতা পাওয়া যায়নি');
      return;
    }

    let parsedPaisa = 0n;
    try {
      parsedPaisa = parsePaisaString(amountStr);
      if (parsedPaisa <= 0n) {
        setErrorMsg('টাকার পরিমাণ অবশ্যই শূন্যের চেয়ে বেশি হতে হবে');
        return;
      }
    } catch {
      setErrorMsg('সঠিক টাকার অঙ্ক লিখুন');
      return;
    }

    if (!accountId) {
      setErrorMsg('অনুগ্রহ করে একটি অ্যাকাউন্ট নির্বাচন করুন');
      return;
    }

    if (type === 'transfer' && accountId === toAccountId) {
      setErrorMsg('উৎস এবং গন্তব্য অ্যাকাউন্ট ভিন্ন হতে হবে');
      return;
    }

    setIsSubmitting(true);

    try {
      const opId = generateUUID();
      let balancedJournal;
      const amountMinor = parsedPaisa.toString();

      // Process receipt blob if present
      let receiptSha: string | null = null;
      if (receiptBase64 && receiptName) {
        receiptSha = await computeSha256(receiptBase64);
        db.storeReceiptBlob({
          sha256: receiptSha,
          fileName: receiptName,
          contentType: 'image/jpeg',
          byteLength: receiptBase64.length,
          dataBase64: receiptBase64,
          uploadStatus: 'local_only',
          createdAt: new Date().toISOString(),
        });
      }

      if (type === 'expense') {
        balancedJournal = buildExpenseJournal({
          workspaceId: currentWorkspace.id,
          assetAccountId: accountId,
          expenseCategoryId: categoryId || 'cat-food',
          amountMinor,
          effectiveDate,
          note: note.trim(),
          receiptBlobSha256: receiptSha,
          receiptName,
          opId,
        });
      } else if (type === 'income') {
        balancedJournal = buildIncomeJournal({
          workspaceId: currentWorkspace.id,
          assetAccountId: accountId,
          revenueCategoryId: categoryId || 'cat-salary',
          amountMinor,
          effectiveDate,
          note: note.trim(),
          receiptBlobSha256: receiptSha,
          receiptName,
          opId,
        });
      } else {
        // Transfer
        const feePaisa = feeStr ? parsePaisaString(feeStr) : 0n;
        const feeMinor = feePaisa > 0n ? feePaisa.toString() : undefined;
        balancedJournal = buildTransferJournal({
          workspaceId: currentWorkspace.id,
          fromAssetAccountId: accountId,
          toAssetAccountId: toAccountId,
          amountMinor,
          feeMinor,
          feeExpenseCategoryId: 'cat-transfer-fee',
          effectiveDate,
          note: note.trim(),
          receiptBlobSha256: receiptSha,
          receiptName,
          opId,
        });
      }

      // Build immutable sync operation
      const opPayload = { balancedJournal };
      const opCanonical = canonicalJson(opPayload);
      const contentSha256 = await computeSha256(opCanonical);

      const op: SyncOperation = {
        protocolVersion: 1,
        ownerHash: db.getIdentity()?.ownerSubjectHash || 'owner',
        deviceId: db.getDeviceId(),
        seq: db.getNextDeviceSeq(),
        operationId: opId,
        entityId: balancedJournal.transaction.id,
        type: 'journal.post',
        createdAtUtc: new Date().toISOString(),
        payload: opPayload,
        contentSha256,
      };

      // Commit to local DB + durable outbox in atomic transaction
      await db.commitJournalWithOutbox(balancedJournal, op);

      refreshState();
      setSuccessToast(true);

      // Trigger background sync if online
      if (isOnline) {
        triggerManualSync().catch(console.error);
      }

      // Reset form
      setAmountStr('');
      setNote('');
      setFeeStr('');
      setReceiptName(null);
      setReceiptBase64(null);

      setTimeout(() => {
        setSuccessToast(false);
        onSuccess();
      }, 900);
    } catch (err: any) {
      setErrorMsg(err.message || 'লেনদেন সংরক্ষণ ব্যর্থ হয়েছে');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-24 animate-in fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
        <h1 className="text-base font-bold text-slate-800 mb-4 tracking-tight">
          নতুন লেনদেন যোগ করুন (Add Entry)
        </h1>

        {/* Transaction Type Segmented Switcher */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl mb-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setType('expense')}
            className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              type === 'expense'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5" />
            <span>খরচ (Expense)</span>
          </button>

          <button
            type="button"
            onClick={() => setType('income')}
            className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              type === 'income'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>আয় (Income)</span>
          </button>

          <button
            type="button"
            onClick={() => setType('transfer')}
            className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              type === 'transfer'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>স্থানান্তর (Transfer)</span>
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
              ডিভাইসে সংরক্ষিত হয়েছে! (Saved locally & queued for sync)
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Amount Input with Currency Symbol */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1">
              টাকার পরিমাণ (Amount in BDT)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-400">
                ৳
              </span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
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

          {/* Account Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                {type === 'transfer' ? 'উৎস অ্যাকাউন্ট (From)' : 'অ্যাকাউন্ট / ওয়ালেট'}
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({formatBDT(a.openingBalanceMinor, { locale: language, showDecimals: false })})
                  </option>
                ))}
              </select>
            </div>

            {type === 'transfer' ? (
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  গন্তব্য অ্যাকাউন্ট (To)
                </label>
                <select
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  ক্যাটাগরি / খাত (Category)
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {availableCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Transfer Fee if Transfer type */}
          {type === 'transfer' && (
            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                ক্যাশআউট চার্জ / ফি (ঐচ্ছিক Fee)
              </label>
              <input
                type="text"
                placeholder="যেমন: ১৫.০০"
                value={feeStr}
                onChange={(e) => setFeeStr(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 tabular-nums"
              />
            </div>
          )}

          {/* Date & Note */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                তারিখ (Effective Date)
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                বিবরণ / নোট (ঐচ্ছিক Note)
              </label>
              <input
                type="text"
                placeholder="যেমন: দুপুরের খাবার, বিদ্যুৎ বিল..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {/* Receipt Attachment */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1">
              রসিদ বা ভাউচার ছবি (Receipt Photo)
            </label>
            {!receiptName ? (
              <label className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-xl hover:border-blue-400 cursor-pointer bg-slate-50 transition-colors">
                <Camera className="w-4 h-4 text-slate-500" />
                <span className="text-slate-600 font-medium">রসিদের ছবি তুলুন বা আপলোড করুন</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleReceiptUpload}
                  className="hidden"
                />
              </label>
            ) : (
              <div className="flex items-center justify-between p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
                <span className="truncate max-w-[200px]">{receiptName}</span>
                <button
                  type="button"
                  onClick={() => {
                    setReceiptName(null);
                    setReceiptBase64(null);
                  }}
                  className="p-1 hover:bg-blue-100 rounded text-blue-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white rounded-xl text-sm font-bold shadow-md shadow-blue-700/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            <span>সংরক্ষণ করুন (Save Transaction)</span>
          </button>
        </form>
      </div>
    </div>
  );
};
