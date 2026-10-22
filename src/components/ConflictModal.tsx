import React from 'react';
import { useApp } from '../context/AppContext';
import { AlertTriangle, Check, X, ShieldAlert } from 'lucide-react';
import { generateUUID } from '../domain/journal';

interface ConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({ isOpen, onClose }) => {
  const { conflicts, db, refreshState, triggerManualSync } = useApp();

  if (!isOpen) return null;

  const unresolved = conflicts.filter((c) => c.status === 'needs_review');

  const handleResolve = (conflictId: string, chosenOpId: string) => {
    const resolutionOpId = generateUUID();
    db.resolveConflict(conflictId, resolutionOpId);
    refreshState();
    triggerManualSync().catch(console.error);
    if (unresolved.length <= 1) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200 text-xs animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h2 className="text-sm font-bold text-slate-800">
              সংঘাত পর্যালোচনা (Conflict Resolution)
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
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl">
            <span className="font-bold block mb-1">নিরাপদ হিসাব নীতি:</span>
            হিসাব দেখতে চাই কোনো সমসাময়িক সংশোধনকে অগোচরে ওভাররাইট (Last-Writer-Wins) করে না।
            দুটি ভিন্ন ডিভাইস থেকে আসা সংশোধন নিচে প্রদর্শিত হচ্ছে, যে কোনো একটি বেছে নিন:
          </div>

          {unresolved.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              কোনো অমীমাংসিত সংঘাত নেই। সকল হিসাব ড্রাইভে সুসংগত রয়েছে।
            </div>
          ) : (
            unresolved.map((conflict) => (
              <div
                key={conflict.id}
                className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 text-xs">{conflict.details.title}</h3>
                  <span className="text-[10px] bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded-full">
                    পর্যালোচনা প্রয়োজন
                  </span>
                </div>
                <p className="text-[11px] text-slate-600">{conflict.details.description}</p>

                {/* Contenders comparison */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {conflict.details.contenders.map((contender, idx) => (
                    <div
                      key={contender.opId}
                      className="bg-white p-3 rounded-xl border border-slate-200 space-y-2 shadow-xs"
                    >
                      <div className="font-bold text-blue-700 text-xs">
                        প্রস্তাব {idx + 1}
                      </div>
                      <div className="text-[11px] text-slate-700 font-medium">
                        {contender.summary}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        সময়: {new Date(contender.timestamp).toLocaleTimeString()}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleResolve(conflict.id, contender.opId)}
                        className="w-full py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-bold text-xs shadow-xs"
                      >
                        এই প্রস্তাবটি গ্রহণ করুন
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
