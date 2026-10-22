import React, { useState } from 'react';
import { useApp, SIMULATED_DEVICES } from '../context/AppContext';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import {
  Cloud,
  RefreshCw,
  Pause,
  Play,
  AlertTriangle,
  CheckCircle2,
  Clock,
  HardDrive,
  X,
  Smartphone,
  Laptop,
  Flame,
  ShieldAlert
} from 'lucide-react';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenConflictModal: () => void;
  onOpenAuthModal?: () => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  onOpenConflictModal,
  onOpenAuthModal,
}) => {
  const {
    sync,
    syncStatus,
    db,
    isOnline,
    setIsOnline,
    currentDevice,
    switchDevice,
    triggerManualSync,
    conflicts,
    userProfile,
  } = useApp();

  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedFault, setSelectedFault] = useState<string>('none');

  if (!isOpen) return null;

  const handleManualSync = async () => {
    setIsSyncing(true);
    await triggerManualSync();
    setIsSyncing(false);
  };

  const handleFaultChange = (fault: any) => {
    setSelectedFault(fault);
    const transport = (sync as any).transport as SimulatedGoogleDriveTransport;
    if (transport && transport.simulateFault !== undefined) {
      transport.simulateFault = fault;
    }
    if (fault === 'none') {
      sync.setAuthorized(true);
    }
    handleManualSync();
  };

  const pendingOps = db.getPendingOutbox();
  const unresolvedConflicts = conflicts.filter((c) => c.status === 'needs_review');

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200 text-xs animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-blue-700" />
            <div>
              <h2 className="text-sm font-bold text-slate-800">গুগল ড্রাইভ সিঙ্ক ড্যাশবোর্ড</h2>
              <div className="text-[10px] text-slate-500 font-medium">
                {userProfile?.accessToken && userProfile.accessToken.startsWith('ya29.') ? (
                  <span className="text-emerald-700 font-semibold">● লাইভ গুগল ড্রাইভ REST API সক্রিয়</span>
                ) : (
                  <span className="text-blue-700 font-semibold">● মাল্টি-ডিভাইস টেস্ট মোড সক্রিয়</span>
                )}
              </div>
            </div>
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
          {/* Honest Status Overview */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">বর্তমান অবস্থা:</span>
              <span
                className={`font-bold px-2 py-0.5 rounded-full ${
                  !isOnline
                    ? 'bg-slate-200 text-slate-700'
                    : syncStatus.state === 'synced_verified'
                    ? 'bg-emerald-100 text-emerald-800'
                    : syncStatus.state === 'conflict'
                    ? 'bg-amber-100 text-amber-800'
                    : syncStatus.state === 'quota_full'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {!isOnline
                  ? 'অফলাইন (লোকাল সংরক্ষিত)'
                  : syncStatus.state === 'synced_verified'
                  ? 'ড্রাইভে সম্পূর্ণ সিঙ্কড'
                  : syncStatus.state === 'conflict'
                  ? 'সংঘাত পর্যালোচনা প্রয়োজন'
                  : syncStatus.state === 'quota_full'
                  ? 'গুগল ড্রাইভ কোটা পূর্ণ'
                  : syncStatus.state === 'auth_required'
                  ? 'পুনরায় লগইন প্রয়োজন'
                  : 'সিঙ্ক অপেক্ষারত'}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>সর্বশেষ সফল সিঙ্ক:</span>
              <span className="font-mono text-slate-700">
                {syncStatus.lastSuccessfulSyncAt
                  ? new Date(syncStatus.lastSuccessfulSyncAt).toLocaleTimeString()
                  : 'এখনও সিঙ্ক হয়নি'}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>ডিভাইস আউটবক্সে পেন্ডিং:</span>
              <span className="font-bold text-blue-700">{pendingOps.length}টি অপারেশন</span>
            </div>

            {syncStatus.lastError && (
              <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[11px]">
                ত্রুটি: {syncStatus.lastError}
              </div>
            )}

            {syncStatus.state === 'auth_required' && onOpenAuthModal && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuthModal();
                }}
                className="w-full mt-2 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-colors shadow-xs"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>গুগল ড্রাইভ পুনরায় অথোরাইজ করুন</span>
              </button>
            )}
          </div>

          {/* Conflict Alert if any */}
          {unresolvedConflicts.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-amber-900">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <strong>{unresolvedConflicts.length}টি সংঘাত</strong> পাওয়া গেছে (সমসাময়িক সংশোধন)
                </span>
              </div>
              <button
                type="button"
                onClick={onOpenConflictModal}
                className="px-2.5 py-1 bg-amber-700 text-white rounded-lg font-bold"
              >
                পর্যালোচনা
              </button>
            </div>
          )}

          {/* Action Buttons: Sync Now & Pause */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleManualSync}
              disabled={!isOnline || isSyncing}
              className="flex-1 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-sm transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>এখনই সিঙ্ক করুন (Sync Now)</span>
            </button>

            <button
              type="button"
              onClick={() => sync.setPaused(!syncStatus.isPaused)}
              className={`px-3 py-2.5 rounded-xl border font-semibold flex items-center gap-1.5 transition-colors ${
                syncStatus.isPaused
                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                  : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
              }`}
            >
              {syncStatus.isPaused ? (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>চালু করুন</span>
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>বিরতি</span>
                </>
              )}
            </button>
          </div>

          {/* Multi-Device Testing Simulator Controls */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
            <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-blue-700" />
              <span>মাল্টি-ডিভাইস টু-ওয়ে সিঙ্ক টেস্ট রুম</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              ডিভাইস পরিবর্তন করে অফলাইনে হিসাব যুক্ত করুন। একই গুগল একাউন্টের ক্লাউড ড্রাইভের মাধ্যমে অন্য
              ডিভাইস স্বয়ংক্রিয়ভাবে তা গ্রহণ করবে:
            </p>

            <div className="grid grid-cols-3 gap-1.5">
              {SIMULATED_DEVICES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => switchDevice(d)}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    currentDevice.id === d.id
                      ? 'bg-blue-700 text-white border-blue-700 font-bold shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <div className="truncate font-semibold">{d.name.split(' ')[0]}</div>
                  <div
                    className={`text-[10px] ${
                      currentDevice.id === d.id ? 'text-blue-100' : 'text-slate-400'
                    }`}
                  >
                    {d.platform}
                  </div>
                </button>
              ))}
            </div>

            {/* Offline toggle */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-600">ডিভাইস ইন্টারনেট সংযোগ:</span>
              <button
                type="button"
                onClick={() => setIsOnline(!isOnline)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                  isOnline
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-600 text-white'
                }`}
              >
                {isOnline ? 'অনলাইন (Connected)' : 'অফলাইন (Airplane Mode)'}
              </button>
            </div>
          </div>

          {/* Fault Injection Simulator for QA Testing */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <h3 className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
              <Flame className="w-3.5 h-3.5 text-rose-600" />
              <span>ক্লাউড ফল্ট ইনজেকশন পরীক্ষা (QA Suite)</span>
            </h3>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => handleFaultChange('none')}
                className={`p-1.5 rounded-lg border text-center ${
                  selectedFault === 'none'
                    ? 'bg-emerald-600 text-white border-emerald-600 font-bold'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                স্বাভাবিক (Normal)
              </button>
              <button
                type="button"
                onClick={() => handleFaultChange('403_quota')}
                className={`p-1.5 rounded-lg border text-center ${
                  selectedFault === '403_quota'
                    ? 'bg-rose-600 text-white border-rose-600 font-bold'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                403 কোটা পূর্ণ (Quota Full)
              </button>
              <button
                type="button"
                onClick={() => handleFaultChange('401_expired')}
                className={`p-1.5 rounded-lg border text-center ${
                  selectedFault === '401_expired'
                    ? 'bg-amber-600 text-white border-amber-600 font-bold'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                401 টোকেন মেয়াদোত্তীর্ণ
              </button>
              <button
                type="button"
                onClick={() => handleFaultChange('429_rate_limit')}
                className={`p-1.5 rounded-lg border text-center ${
                  selectedFault === '429_rate_limit'
                    ? 'bg-purple-600 text-white border-purple-600 font-bold'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                429 রেইট লিমিট
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
