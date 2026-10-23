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
      text: language === 'bn' ? 'সিঙ্কড' : 'Synced',
      bgColor: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
      dotColor: 'bg-emerald-500',
    };
  };

  const badge = getSyncBadge();
  const BadgeIcon = badge.icon;

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
      <div className="max-w-xl mx-auto px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          {/* Brand & Workspace Switcher */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Wallet className="w-4 h-4" strokeWidth={2} />
            </div>

            {/* Workspace Selector */}
            <div className="relative min-w-0">
              <button
                type="button"
                onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
                className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg hover:bg-slate-100/80 transition-colors text-left group"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-slate-900 text-sm tracking-tight truncate">
                      {formatAccountTitle(currentWorkspace?.name || '', language) || (language === 'bn' ? 'হিসাব দেখতে চাই' : 'Hisab DekhteChai')}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 shrink-0" />
                  </div>
                  <span className="text-[11px] text-slate-500 font-medium block -mt-0.5">
                    {currentWorkspace?.kind === 'personal'
                      ? (language === 'bn' ? 'ব্যক্তিগত খাতা' : 'Personal')
                      : (language === 'bn' ? 'ব্যবসার খাতা' : 'Business')}
                  </span>
                </div>
              </button>

              {/* Workspace Dropdown */}
              {showWorkspaceMenu && (
                <div className="absolute left-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-slate-200/80 py-1.5 z-50 animate-in fade-in slide-from-top-1">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    {language === 'bn' ? 'হিসাব খাতা' : 'Workspaces'}
                  </div>
                  {workspaces.map((ws) => (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => {
                        setCurrentWorkspaceId(ws.id);
                        setShowWorkspaceMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors ${
                        ws.id === currentWorkspace?.id
                          ? 'text-blue-700 font-bold bg-blue-50/70'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate">{formatAccountTitle(ws.name, language)}</span>
                      <span className="text-[10px] text-slate-400 uppercase font-medium">
                        {ws.kind === 'personal'
                          ? (language === 'bn' ? 'ব্যক্তিগত' : 'Personal')
                          : (language === 'bn' ? 'ব্যবসা' : 'Business')}
                      </span>
                    </button>
                  ))}

                  <div className="border-t border-slate-100 pt-1.5 mt-1">
                    {!isCreatingWorkspace ? (
                      <button
                        type="button"
                        onClick={() => setIsCreatingWorkspace(true)}
                        className="w-full text-left px-3 py-2 text-xs text-blue-700 font-semibold flex items-center gap-1.5 hover:bg-blue-50 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{language === 'bn' ? 'নতুন খাতা যোগ করুন' : 'New Workspace'}</span>
                      </button>
                    ) : (
                      <form onSubmit={handleCreateWorkspaceSubmit} className="p-3 bg-slate-50/80 rounded-b-lg">
                        <input
                          type="text"
                          placeholder={language === 'bn' ? 'খাতার নাম (যেমন: বাড়ি নির্মাণ)' : 'Workspace name'}
                          value={newWsName}
                          onChange={(e) => setNewWsName(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg mb-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          autoFocus
                        />
                        <div className="flex gap-3 mb-2.5 text-xs">
                          <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                            <input
                              type="radio"
                              name="wsKind"
                              checked={newWsKind === 'personal'}
                              onChange={() => setNewWsKind('personal')}
                            />
                            <span>{language === 'bn' ? 'ব্যক্তিগত' : 'Personal'}</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
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
                            className="flex-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
                          >
                            {language === 'bn' ? 'তৈরি করুন' : 'Create'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsCreatingWorkspace(false)}
                            className="px-2.5 py-1.5 text-slate-600 rounded-lg text-xs hover:bg-slate-200"
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

          {/* Right controls: Sync Indicator, Quick Sync, Language Switch & Settings */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Sync Status Button */}
            <button
              type="button"
              onClick={onOpenSyncModal}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-lg transition-colors ${badge.bgColor}`}
              title={language === 'bn' ? 'গুগল ড্রাইভ সিঙ্ক স্থিতি' : 'Google Drive Sync'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${badge.dotColor}`} />
              <span className="hidden sm:inline text-[11px] font-medium">{badge.text}</span>
            </button>

            {/* Quick Manual Sync */}
            <button
              type="button"
              onClick={handleManualSyncClick}
              disabled={!isOnline || isSyncing}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-40"
              title={language === 'bn' ? 'এখনই সিঙ্ক করুন' : 'Sync Now'}
              aria-label="Sync Now"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-blue-700' : ''}`} />
            </button>

            {/* Language Toggle: EN / বাং */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100/80 p-0.5 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-1.5 py-0.5 rounded-md transition-all ${
                  language === 'en'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title="English"
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLanguage('bn')}
                className={`px-1.5 py-0.5 rounded-md transition-all ${
                  language === 'bn'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title="বাংলা"
              >
                বাং
              </button>
            </div>

            {/* Settings */}
            <button
              type="button"
              onClick={onOpenSettingsModal}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              title={language === 'en' ? 'Settings & Security' : 'সেটিংস ও নিরাপত্তা'}
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
