import React, { useState } from 'react';
import { useApp, SIMULATED_DEVICES } from '../context/AppContext';
import { formatAccountTitle } from '../domain/money';
import {
  Wallet,
  ChevronDown,
  Cloud,
  CloudOff,
  RefreshCw,
  AlertTriangle,
  Smartphone,
  Laptop,
  CheckCircle2,
  Settings,
  Plus,
  ShieldCheck,
  Database,
  Globe
} from 'lucide-react';

interface NavbarProps {
  onOpenSyncModal: () => void;
  onOpenSettingsModal: () => void;
  onOpenSnapshotModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenSyncModal,
  onOpenSettingsModal,
  onOpenSnapshotModal,
}) => {
  const {
    currentWorkspace,
    workspaces,
    setCurrentWorkspaceId,
    currentDevice,
    switchDevice,
    syncStatus,
    isOnline,
    setIsOnline,
    triggerManualSync,
    createWorkspace,
    language,
    setLanguage,
    conflicts,
  } = useApp();

  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showDeviceMenu, setShowDeviceMenu] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [newWsKind, setNewWsKind] = useState<'personal' | 'business'>('business');
  const [isSyncing, setIsSyncing] = useState(false);

  const handleManualSyncClick = async () => {
    setIsSyncing(true);
    await triggerManualSync();
    setIsSyncing(false);
  };

  const handleCreateWorkspaceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    const ws = createWorkspace(newWsName.trim(), newWsKind);
    setCurrentWorkspaceId(ws.id);
    setNewWsName('');
    setIsCreatingWorkspace(false);
    setShowWorkspaceMenu(false);
  };

  // Honest sync status badge configuration
  const getSyncBadge = () => {
    if (!isOnline) {
      return {
        icon: CloudOff,
        text: language === 'bn' ? 'অফলাইন মোড' : 'Offline Mode',
        bgColor: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300',
        dotColor: 'bg-slate-400',
      };
    }
    if (conflicts.some((c) => c.status === 'needs_review')) {
      return {
        icon: AlertTriangle,
        text: language === 'bn' ? 'সংঘাত পর্যালোচনা' : 'Conflict Review',
        bgColor: 'bg-amber-50 text-amber-800 border-amber-300',
        dotColor: 'bg-amber-500 animate-pulse',
      };
    }
    if (syncStatus.state === 'syncing' || isSyncing) {
      return {
        icon: RefreshCw,
        text: language === 'bn' ? 'সিঙ্ক হচ্ছে...' : 'Syncing...',
        bgColor: 'bg-blue-50 text-blue-800 border-blue-300',
        dotColor: 'bg-blue-600 animate-spin',
      };
    }
    if (syncStatus.pendingOutboxCount > 0) {
      return {
        icon: Cloud,
        text:
          language === 'bn'
            ? `${syncStatus.pendingOutboxCount}টি সিঙ্ক অপেক্ষারত`
            : `${syncStatus.pendingOutboxCount} Pending Sync`,
        bgColor: 'bg-amber-50 text-amber-800 border-amber-300',
        dotColor: 'bg-amber-500',
      };
    }
    return {
      icon: CheckCircle2,
      text: language === 'bn' ? 'ড্রাইভে সিঙ্কড' : 'Synced to Drive',
      bgColor: 'bg-emerald-50 text-emerald-800 border-emerald-300',
      dotColor: 'bg-emerald-500',
    };
  };

  const badge = getSyncBadge();
  const BadgeIcon = badge.icon;

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-4xl mx-auto px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          {/* Brand & Workspace Switcher */}
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-blue-700 text-white flex items-center justify-center shadow-sm shadow-blue-500/20">
              <Wallet className="w-5 h-5" strokeWidth={2} />
            </div>

            {/* Workspace Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors text-left"
              >
                <div>
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-slate-900 text-sm tracking-tight leading-none">
                      {formatAccountTitle(currentWorkspace?.name || '', language) || (language === 'bn' ? 'হিসাব দেখতে চাই' : 'Hisab DekhteChai')}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  </div>
                  <span className="text-[11px] text-blue-700 font-medium">
                    {currentWorkspace?.kind === 'personal'
                      ? (language === 'bn' ? 'ব্যক্তিগত খাতা' : 'Personal Ledger')
                      : (language === 'bn' ? 'ব্যবসার খাতা' : 'Business Ledger')}
                  </span>
                </div>
              </button>

              {/* Workspace Dropdown */}
              {showWorkspaceMenu && (
                <div className="absolute left-0 mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in slide-from-top-1">
                  <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    {language === 'bn' ? 'হিসাব খাতা / ওয়ার্কস্পেস' : 'Workspaces'}
                  </div>
                  {workspaces.map((ws) => (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => {
                        setCurrentWorkspaceId(ws.id);
                        setShowWorkspaceMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-blue-50 transition-colors ${
                        ws.id === currentWorkspace?.id
                          ? 'text-blue-700 font-semibold bg-blue-50/50'
                          : 'text-slate-700'
                      }`}
                    >
                      <span>{formatAccountTitle(ws.name, language)}</span>
                      <span className="text-xs text-slate-400 capitalize">
                        {ws.kind === 'personal'
                          ? (language === 'bn' ? 'ব্যক্তিগত' : 'Personal')
                          : (language === 'bn' ? 'ব্যবসা' : 'Business')}
                      </span>
                    </button>
                  ))}

                  <div className="border-t border-slate-100 pt-1 mt-1">
                    {!isCreatingWorkspace ? (
                      <button
                        type="button"
                        onClick={() => setIsCreatingWorkspace(true)}
                        className="w-full text-left px-3 py-2 text-sm text-blue-700 font-medium flex items-center gap-2 hover:bg-blue-50"
                      >
                        <Plus className="w-4 h-4" />
                        <span>{language === 'bn' ? 'নতুন খাতা যোগ করুন' : 'Add New Workspace'}</span>
                      </button>
                    ) : (
                      <form onSubmit={handleCreateWorkspaceSubmit} className="p-2.5 bg-slate-50">
                        <input
                          type="text"
                          placeholder={language === 'bn' ? 'খাতার নাম (যেমন: বাড়ি নির্মাণ)' : 'Workspace name (e.g., Home)'}
                          value={newWsName}
                          onChange={(e) => setNewWsName(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg mb-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          autoFocus
                        />
                        <div className="flex gap-2 mb-2 text-xs">
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="radio"
                              name="wsKind"
                              checked={newWsKind === 'personal'}
                              onChange={() => setNewWsKind('personal')}
                            />
                            <span>{language === 'bn' ? 'ব্যক্তিগত' : 'Personal'}</span>
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="radio"
                              name="wsKind"
                              checked={newWsKind === 'business'}
                              onChange={() => setNewWsKind('business')}
                            />
                            <span>{language === 'bn' ? 'ব্যবসা' : 'Business'}</span>
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            className="flex-1 px-2 py-1 bg-blue-700 text-white rounded text-xs font-semibold"
                          >
                            {language === 'bn' ? 'তৈরি করুন' : 'Create'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsCreatingWorkspace(false)}
                            className="px-2 py-1 text-slate-600 rounded text-xs hover:bg-slate-200"
                          >
                            {language === 'bn' ? 'বাতিল' : 'Cancel'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right controls: Multi-Device Switcher, Sync Badge & Settings */}
          <div className="flex items-center gap-1.5">
            {/* Multi-Device Testing Simulator Switcher */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowDeviceMenu(!showDeviceMenu)}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors border border-slate-200"
                title="Cross-Device Testing Simulator"
              >
                {currentDevice.platform === 'android' ? (
                  <Smartphone className="w-3.5 h-3.5 text-blue-700" />
                ) : (
                  <Laptop className="w-3.5 h-3.5 text-blue-700" />
                )}
                <span className="truncate max-w-[110px]">{currentDevice.name.split(' ')[0]}</span>
                <ChevronDown className="w-3 h-3 text-slate-500" />
              </button>

              {showDeviceMenu && (
                <div className="absolute right-0 mt-1.5 w-60 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50">
                  <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    {language === 'bn' ? 'মাল্টি-ডিভাইস সিমুলেটর' : 'Multi-Device Simulator'}
                  </div>
                  <p className="px-3 py-1 text-[11px] text-slate-500">
                    {language === 'bn'
                      ? 'ভিন্ন ফোনে অফলাইন এন্ট্রি ও গুগল ড্রাইভ টু-ওয়ে সিঙ্ক পরীক্ষা করুন:'
                      : 'Test offline entry & Google Drive two-way sync across devices:'}
                  </p>
                  {SIMULATED_DEVICES.map((dev) => (
                    <button
                      key={dev.id}
                      type="button"
                      onClick={() => {
                        switchDevice(dev);
                        setShowDeviceMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-blue-50 transition-colors ${
                        dev.id === currentDevice.id
                          ? 'text-blue-700 font-semibold bg-blue-50/50'
                          : 'text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {dev.platform === 'android' ? (
                          <Smartphone className="w-3.5 h-3.5" />
                        ) : (
                          <Laptop className="w-3.5 h-3.5" />
                        )}
                        <span>{dev.name}</span>
                      </div>
                      {dev.id === currentDevice.id && (
                        <span className="text-[10px] bg-blue-700 text-white px-1.5 py-0.5 rounded">
                          {language === 'bn' ? 'চলমান' : 'Active'}
                        </span>
                      )}
                    </button>
                  ))}
                  <div className="border-t border-slate-100 px-3 py-1.5 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between">
                    <span>{language === 'bn' ? 'নেটওয়ার্ক স্টেট:' : 'Network State:'}</span>
                    <button
                      type="button"
                      onClick={() => setIsOnline(!isOnline)}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                        isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {isOnline
                        ? (language === 'bn' ? 'অনলাইন (Online)' : 'Online')
                        : (language === 'bn' ? 'অফলাইন (Airplane)' : 'Offline')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Honest Google Drive Sync Badge */}
            <button
              type="button"
              onClick={onOpenSyncModal}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-all ${badge.bgColor}`}
              title="গুগল ড্রাইভ সিঙ্ক ড্যাশবোর্ড"
            >
              <span className={`w-2 h-2 rounded-full ${badge.dotColor}`} />
              <BadgeIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{badge.text}</span>
            </button>

            {/* Quick Manual Sync Trigger */}
            <button
              type="button"
              onClick={handleManualSyncClick}
              disabled={!isOnline || isSyncing}
              className="p-1.5 rounded-lg text-slate-600 hover:text-blue-700 hover:bg-slate-100 transition-colors disabled:opacity-40"
              title="এখনই সিঙ্ক করুন (Sync Now)"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-blue-700' : ''}`} />
            </button>

            {/* Local Snapshots & Disaster Recovery */}
            <button
              type="button"
              onClick={onOpenSnapshotModal}
              className="p-1.5 rounded-lg text-slate-600 hover:text-blue-700 hover:bg-slate-100 transition-colors"
              title={language === 'en' ? 'Database Snapshots & Recovery' : 'ডাটাবেজ ব্যাকআপ ও রিকভারি স্ন্যাপশট'}
            >
              <Database className="w-4 h-4" />
            </button>

            {/* Segmented Language Switcher: US English <-> বাংলা */}
            <div className="flex items-center rounded-lg border border-slate-300 bg-slate-100 p-0.5 text-[11px] font-bold shadow-2xs">
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-1.5 py-0.5 rounded-md transition-all ${
                  language === 'en'
                    ? 'bg-blue-700 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="US English"
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLanguage('bn')}
                className={`px-1.5 py-0.5 rounded-md transition-all ${
                  language === 'bn'
                    ? 'bg-blue-700 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="বাংলা"
              >
                বাং
              </button>
            </div>

            {/* Settings & Profile */}
            <button
              type="button"
              onClick={onOpenSettingsModal}
              className="p-1.5 rounded-lg text-slate-600 hover:text-blue-700 hover:bg-slate-100 transition-colors"
              title={language === 'en' ? 'Settings & Security' : 'সেটিংস ও নিরাপত্তা'}
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
