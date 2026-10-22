import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Database, ShieldCheck, RotateCcw, Plus, X, Check, AlertCircle } from 'lucide-react';
import { LocalSnapshot } from '../contracts/types';

interface SnapshotModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SnapshotModal: React.FC<SnapshotModalProps> = ({ isOpen, onClose }) => {
  const { db, refreshState } = useApp();
  const [snapshots, setSnapshots] = useState<LocalSnapshot[]>(() => db.getSnapshots());
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [isCapturing, setIsCapturing] = useState(false);

  if (!isOpen) return null;

  const handleCaptureSnapshot = async () => {
    setIsCapturing(true);
    try {
      const snap = await db.captureRecoverySnapshot();
      setSnapshots(db.getSnapshots());
      setStatusMsg({
        type: 'success',
        text: `নতুন স্ন্যাপশট সংগৃহীত হয়েছে (SHA-256: ${snap.hash.slice(0, 8)}...)`,
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setIsCapturing(false);
    }
  };

  const handleRestore = async (snapId: string) => {
    if (
      !confirm(
        'আপনি কি নিশ্চিত যে এই স্ন্যাপশট থেকে ডাটাবেজ পুনরুদ্ধার করতে চান? বর্তমান আনসেভড পরিবর্তনগুলো রিস্টোর পয়েন্টে ফিরে যাবে।'
      )
    ) {
      return;
    }

    try {
      const ok = await db.restoreFromSnapshot(snapId);
      if (ok) {
        refreshState();
        setStatusMsg({ type: 'success', text: 'ডাটাবেজ সফলভাবে রিস্টোর হয়েছে!' });
        setTimeout(() => onClose(), 1200);
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `রিস্টোর ব্যর্থ: ${err.message}` });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200 text-xs animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-700" />
            <h2 className="text-sm font-bold text-slate-800">
              ডাটাবেজ ব্যাকআপ ও রিকভারি স্ন্যাপশট
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 pt-3">
          <p className="text-slate-500 text-[11px]">
            অ্যাপ আপডেট বা স্কিমা পরিবর্তনের সময় Hisab DekhteChai একটি অপরিবর্তনীয় স্থানীয় ব্যাকআপ
            সংরক্ষণ করে। এটি SHA-256 ক্রিপ্টোগ্রাফিক হ্যাশ দ্বারা সুরক্ষিত।
          </p>

          {statusMsg && (
            <div
              className={`p-3 rounded-xl border flex items-center gap-2 ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {statusMsg.type === 'success' ? (
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{statusMsg.text}</span>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="font-bold text-slate-800">সংরক্ষিত স্ন্যাপশট ({snapshots.length})</span>
            <button
              type="button"
              onClick={handleCaptureSnapshot}
              disabled={isCapturing}
              className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-xs disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isCapturing ? 'তৈরি হচ্ছে...' : 'এখনই স্ন্যাপশট নিন'}</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {snapshots.map((snap) => (
              <div
                key={snap.id}
                className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span className="font-bold text-slate-800">
                      স্কিমা v{snap.dbSchemaVersion} স্ন্যাপশট
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {new Date(snap.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 bg-white p-2 rounded-lg border border-slate-100">
                  <div>মোট লেনদেন: {snap.totalTransactions}টি</div>
                  <div>পেন্ডিং আউটবক্স: {snap.pendingOutboxCount}টি</div>
                  <div className="col-span-2 font-mono truncate text-[10px] text-slate-400">
                    SHA-256: {snap.hash}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleRestore(snap.id)}
                  className="w-full py-1.5 bg-white hover:bg-slate-100 text-blue-700 border border-blue-200 rounded-lg font-bold flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>এই স্ন্যাপশটে রিস্টোর করুন</span>
                </button>
              </div>
            ))}

            {snapshots.length === 0 && (
              <div className="p-8 text-center text-slate-400">কোনো স্ন্যাপশট সংরক্ষিত নেই।</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
