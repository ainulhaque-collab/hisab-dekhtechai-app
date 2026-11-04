import { WorkspaceManager } from './WorkspaceManager';
import { WorkspaceAvatar } from './WorkspaceAvatar';
import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { formatAccountTitle } from '../domain/money';
import {
  Menu,
  ChevronDown,
  Cloud,
  CloudOff,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Settings,
  Plus,
  Users,
  Info,
} from 'lucide-react';

interface NavbarProps {
  onOpenSyncModal: () => void;
  onOpenSettingsModal: () => void;
  onOpenTeamSharingModal: () => void;
  onOpenAboutModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenSyncModal,
  onOpenSettingsModal,
  onOpenTeamSharingModal,
  onOpenAboutModal,
}) => {
  const {
    currentWorkspace,
    workspaces,
    setCurrentWorkspaceId,
    syncStatus,
    isOnline,
    createWorkspace,
    language,
    conflicts,
    userProfile,
    isLiveGoogleAuth,
  } = useApp();

  const isEn = language === 'en';

  const [showWorkspaceManager, setShowWorkspaceManager] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWsDescription, setNewWsDescription] = useState('');
  const [newWsName, setNewWsName] = useState('');
  const [newWsKind, setNewWsKind] = useState<'personal' | 'business'>('business');

  const hamburgerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const openCreate = () => { setShowWorkspaceMenu(true); setIsCreatingWorkspace(true); };
    const openManage = () => setShowWorkspaceManager(true);
    window.addEventListener('hisab-create-workspace', openCreate);
    window.addEventListener('hisab-manage-workspaces', openManage);
    return () => { window.removeEventListener('hisab-create-workspace', openCreate); window.removeEventListener('hisab-manage-workspaces', openManage); };
  }, []);

  // Close menus on outside click or escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (hamburgerRef.current && !hamburgerRef.current.contains(event.target as Node)) {
        setShowHamburgerMenu(false);
      }
      if (workspaceRef.current && !workspaceRef.current.contains(event.target as Node)) {
        setShowWorkspaceMenu(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowHamburgerMenu(false);
        setShowWorkspaceMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleCreateWorkspaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    let ws;
    try { ws = await createWorkspace(newWsName.trim(), newWsKind, newWsDescription); }
    catch { alert(isEn ? 'Workspace could not be saved. Please retry.' : 'খাতা সংরক্ষণ হয়নি। আবার চেষ্টা করুন।'); return; }
    setCurrentWorkspaceId(ws.id);
    setNewWsName('');
    setNewWsDescription('');
    setIsCreatingWorkspace(false);
    setShowWorkspaceMenu(false);
  };

  /**
   * BUG-006: Honest, comprehensive sync state representation
   * Distinguishes offline local saves, unauthenticated states, expired tokens,
   * actual sync failures, pending changes, and confirmed durable persistence.
   */
  const getHonestSyncBadge = () => {
    if (import.meta.env.VITE_SUPABASE_AUTH_ENABLED === 'true') {
      return {
        icon: ShieldCheck,
        text: isEn ? 'Saved on device' : 'ডিভাইসে সংরক্ষিত',
        bgColor: 'bg-slate-50 text-slate-700 border-slate-200',
        dotColor: 'bg-slate-400',
        title: isEn ? 'Local records · open account settings' : 'স্থানীয় হিসাব · অ্যাকাউন্ট সেটিংস খুলুন',
      };
    }
    if (!isOnline) {
      return {
        icon: CloudOff,
        text: isEn ? 'Offline / Saved Locally' : 'অফলাইন / ডিভাইসে সংরক্ষিত',
        bgColor: 'bg-slate-100 text-slate-700 border-slate-300',
        dotColor: 'bg-slate-400',
        title: isEn ? 'Offline mode: changes saved locally in SQLite' : 'অফলাইন মোড: সমস্ত হিসাব ডিভাইসে সুরক্ষিত',
      };
    }
    if (!isLiveGoogleAuth || syncStatus.state === 'auth_required') {
      return {
        icon: CloudOff,
        text: userProfile ? (isEn ? 'Reconnect Drive' : 'ড্রাইভ পুনরায় যুক্ত করুন') : (isEn ? 'Drive Not Connected' : 'ড্রাইভ যুক্ত নয়'),
        bgColor: 'bg-amber-50 text-amber-800 border-amber-300',
        dotColor: 'bg-amber-500',
        title: isEn ? 'Connect Google Drive for cross-device sync' : 'সিঙ্ক করার জন্য গুগল ড্রাইভ যুক্ত করুন',
      };
    }
    if (conflicts.some((c) => c.status === 'needs_review')) {
      return {
        icon: AlertTriangle,
        text: isEn ? 'Conflict Review' : 'সংঘাত পর্যালোচনা',
        bgColor: 'bg-amber-50 text-amber-800 border-amber-300',
        dotColor: 'bg-amber-500 animate-pulse',
        title: isEn ? 'Cloud conflict requires your review' : 'ক্লাউড সংঘাত পর্যালোচনা প্রয়োজন',
      };
    }
    if (syncStatus.state === 'syncing') {
      return {
        icon: RefreshCw,
        text: isEn ? 'Syncing...' : 'সিঙ্ক হচ্ছে...',
        bgColor: 'bg-blue-50 text-blue-800 border-blue-300',
        dotColor: 'bg-blue-600 animate-spin',
        title: isEn ? 'Synchronizing with Google Drive' : 'গুগল ড্রাইভের সাথে সিঙ্ক হচ্ছে',
      };
    }
    if (syncStatus.state === 'quota_full') {
      return {
        icon: AlertTriangle,
        text: isEn ? 'Drive storage full' : 'ড্রাইভের স্টোরেজ পূর্ণ',
        bgColor: 'bg-amber-50 text-amber-800 border-amber-300',
        dotColor: 'bg-amber-500',
        title: isEn ? 'Drive storage is full. Open sync details.' : 'ড্রাইভের স্টোরেজ পূর্ণ। সিঙ্কের বিস্তারিত দেখুন।',
      };
    }
    if (syncStatus.state === 'error_retryable' || !!syncStatus.lastError) {
      return {
        icon: AlertTriangle,
        text: isEn ? 'Sync Failed / Retry' : 'সিঙ্ক ব্যর্থ / পুনরায় চেষ্টা',
        bgColor: 'bg-rose-50 text-rose-800 border-rose-300',
        dotColor: 'bg-rose-500',
        title: isEn ? 'Sync failed. Open details to retry.' : 'সিঙ্ক ব্যর্থ। বিস্তারিত খুলে আবার চেষ্টা করুন।',
      };
    }
    if (syncStatus.pendingOutboxCount > 0) {
      return {
        icon: Cloud,
        text: isEn
          ? `${syncStatus.pendingOutboxCount} Pending Sync`
          : `${syncStatus.pendingOutboxCount}টি সিঙ্ক অপেক্ষারত`,
        bgColor: 'bg-amber-50 text-amber-800 border-amber-300',
        dotColor: 'bg-amber-500',
        title: isEn ? 'Changes queued to sync to Google Drive' : 'পরিবর্তনগুলো ড্রাইভে প্রেরণের জন্য অপেক্ষারত',
      };
    }

    if (syncStatus.state !== 'synced_verified' || !syncStatus.lastSuccessfulSyncAt) {
      return {
        icon: Cloud,
        text: isEn ? 'Waiting to sync' : 'সিঙ্কের অপেক্ষায়',
        bgColor: 'bg-slate-50 text-slate-600 border-slate-200',
        dotColor: 'bg-slate-400',
        title: isEn ? 'Open Google Drive sync details' : 'গুগল ড্রাইভ সিঙ্কের বিস্তারিত দেখুন',
      };
    }
    const lastSyncTimeStr = syncStatus.lastSuccessfulSyncAt
      ? new Date(syncStatus.lastSuccessfulSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    return {
      icon: CheckCircle2,
      text: isEn ? 'Synced' : 'সিঙ্কড',
      bgColor: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
      dotColor: 'bg-emerald-500',
      title: lastSyncTimeStr
        ? (isEn ? `Successfully Synced (${lastSyncTimeStr})` : `সিঙ্ক সম্পন্ন (${lastSyncTimeStr})`)
        : (isEn ? 'Successfully Synced' : 'সিঙ্ক সম্পন্ন'),
    };
  };

  const badge = getHonestSyncBadge();
  const BadgeIcon = badge.icon;

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 pt-safe header-safe">
      <div className="max-w-xl mx-auto px-3 sm:px-4 py-2">
        <div className="flex items-center justify-between gap-2">
          {/* Brand & Workspace Switcher */}
          <div className="flex items-center gap-2 min-w-0" ref={workspaceRef}>
            <WorkspaceAvatar workspace={currentWorkspace} />
            {/* Workspace Selector Button */}
            <div className="relative min-w-0">
              <button
                type="button"
                onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
                className="flex items-center gap-1 px-1.5 py-1 rounded-lg hover:bg-slate-100/80 transition-colors text-left group min-h-[44px]"
                aria-haspopup="true"
                aria-expanded={showWorkspaceMenu}
              >
                <div className="min-w-0 max-w-[120px] xs:max-w-[150px] sm:max-w-[220px]">
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-slate-900 text-xs sm:text-sm tracking-tight truncate">
                      {formatAccountTitle(currentWorkspace?.name || '', language) ||
                        (isEn ? 'Hisab DekhteChai' : 'হিসাব দেখতে চাই')}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 shrink-0" />
                  </div>
                  <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium block -mt-0.5 truncate">
                    {currentWorkspace?.kind === 'personal'
                      ? (isEn ? 'Personal' : 'ব্যক্তিগত খাতা')
                      : (isEn ? 'Business' : 'ব্যবসার খাতা')}
                  </span>
                </div>
              </button>

              {showWorkspaceManager && <WorkspaceManager onClose={() => setShowWorkspaceManager(false)} />}
              {/* Workspace Dropdown */}
              {showWorkspaceMenu && (
                <div className="absolute left-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-slate-200/80 py-1.5 z-50 animate-in fade-in slide-from-top-1">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    {isEn ? 'Workspaces' : 'হিসাব খাতা'}
                  </div>
                  {workspaces.map((ws) => (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => {
                        setCurrentWorkspaceId(ws.id);
                        setShowWorkspaceMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors min-h-[44px] ${
                        ws.id === currentWorkspace?.id
                          ? 'text-blue-700 font-bold bg-blue-50/70'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <WorkspaceAvatar workspace={ws} /><span className="truncate flex-1 ml-2">{formatAccountTitle(ws.name, language)}</span>
                      <span className="text-[10px] text-slate-400 uppercase font-medium ml-2 shrink-0">
                        {ws.kind === 'personal'
                          ? (isEn ? 'Personal' : 'ব্যক্তিগত')
                          : (isEn ? 'Business' : 'ব্যবসা')}
                      </span>
                    </button>
                  ))}

                  <div className="border-t border-slate-100 pt-1.5 mt-1">
                    <button type="button" className="w-full text-left p-3 text-xs font-semibold text-blue-700" onClick={() => { setShowWorkspaceMenu(false); setShowWorkspaceManager(true); }}>{isEn ? 'Manage workspaces' : 'খাতা পরিচালনা'}</button>
                    {!isCreatingWorkspace ? (
                      <button
                        type="button"
                        onClick={() => setIsCreatingWorkspace(true)}
                        className="w-full text-left px-3 py-2 text-xs text-blue-700 font-semibold flex items-center gap-1.5 hover:bg-blue-50 transition-colors min-h-[44px]"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{isEn ? 'New Workspace' : 'নতুন খাতা যোগ করুন'}</span>
                      </button>
                    ) : (
                      <form onSubmit={handleCreateWorkspaceSubmit} className="p-3 bg-slate-50/80 rounded-b-lg">
                        <input
                          type="text"
                          placeholder={isEn ? 'Workspace name' : 'খাতার নাম (যেমন: বাড়ি নির্মাণ)'}
                          value={newWsName}
                          onChange={(e) => setNewWsName(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg mb-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          autoFocus
                        />
                        <label className="block mb-2 text-[11px] text-slate-500">{isEn ? 'Description (optional)' : 'বিবরণ (ঐচ্ছিক)'}<textarea value={newWsDescription} maxLength={500} onChange={e => setNewWsDescription(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-slate-700" /></label>
                        <div className="flex gap-3 mb-2.5 text-xs">
                          <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                            <input
                              type="radio"
                              name="wsKind"
                              checked={newWsKind === 'personal'}
                              onChange={() => setNewWsKind('personal')}
                            />
                            <span>{isEn ? 'Personal' : 'ব্যক্তিগত'}</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                            <input
                              type="radio"
                              name="wsKind"
                              checked={newWsKind === 'business'}
                              onChange={() => setNewWsKind('business')}
                            />
                            <span>{isEn ? 'Business' : 'ব্যবসা'}</span>
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            className="flex-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 min-h-[40px]"
                          >
                            {isEn ? 'Create' : 'তৈরি করুন'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsCreatingWorkspace(false)}
                            className="px-2.5 py-1.5 text-slate-600 rounded-lg text-xs hover:bg-slate-200 min-h-[40px]"
                          >
                            {isEn ? 'Cancel' : 'বাতিল'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* Sync Status Badge (BUG-006) */}
            <button
              type="button"
              onClick={onOpenSyncModal}
              className={`flex items-center justify-center gap-1.5 px-2 py-1 text-xs font-medium rounded-lg transition-colors border ${badge.bgColor} min-h-[44px] min-w-[44px]`}
              title={badge.title}
              aria-label={`${badge.text}. ${import.meta.env.VITE_SUPABASE_AUTH_ENABLED === 'true' ? (isEn ? 'Open account settings' : 'অ্যাকাউন্ট সেটিংস খুলুন') : (isEn ? 'Open sync details' : 'সিঙ্কের বিস্তারিত খুলুন')}`}
              aria-haspopup="dialog"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${badge.dotColor}`} />
              <span className="hidden xs:inline text-[11px] font-medium max-w-[110px] truncate">{badge.text}</span>
              <BadgeIcon className={`w-3.5 h-3.5 shrink-0 xs:hidden ${syncStatus.state === 'syncing' ? 'motion-safe:animate-spin' : ''}`} />
            </button>

            {/* FEAT-007: Top-Right ☰ Hamburger Menu */}
            <div className="relative" ref={hamburgerRef}>
              <button
                type="button"
                onClick={() => setShowHamburgerMenu(!showHamburgerMenu)}
                className={`p-2 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
                  showHamburgerMenu
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                }`}
                title={isEn ? 'Main Menu' : 'প্রধান মেন্যু'}
                aria-label="Menu"
                aria-haspopup="true"
                aria-expanded={showHamburgerMenu}
              >
                {/* ☰ Hamburger Icon (Three horizontal lines) */}
                <Menu className="w-5 h-5" strokeWidth={2.2} />
              </button>

              {/* Right-Aligned Downward Compact Dropdown Menu */}
              {showHamburgerMenu && (
                <div
                  className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200/90 py-2 z-50 animate-in fade-in slide-from-top-1 text-xs divide-y divide-slate-100"
                  role="menu"
                  aria-orientation="vertical"
                >
                  {/* User Profile Teaser */}
                  <div className="px-3 py-2 flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden">
                      {userProfile?.photoUrl ? (
                        <img src={userProfile.photoUrl} alt="User" className="w-full h-full object-cover" />
                      ) : (
                        (userProfile?.displayName || 'H').slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 truncate">
                        {userProfile?.displayName || (isEn ? 'Hisab User' : 'হিসাব ব্যবহারকারী')}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {userProfile?.email || (isEn ? 'Local Device Mode' : 'লোকাল মোড')}
                      </div>
                    </div>
                  </div>

                  <div className="py-1">
                    <button type="button" role="menuitem" onClick={() => { setShowHamburgerMenu(false); onOpenSettingsModal(); }} className="flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"><Settings className="h-4 w-4 text-slate-500" /><span className="font-medium">{isEn ? 'Settings' : 'সেটিংস'}</span></button>
                    {/* Team & Sharing (Business Workspace) */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowHamburgerMenu(false);
                        onOpenTeamSharingModal();
                      }}
                      className="w-full px-3 py-2 text-left flex items-center gap-2.5 text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors min-h-[44px]"
                      role="menuitem"
                    >
                      <Users className="w-4 h-4 text-emerald-600" />
                      <div className="flex-1 flex items-center justify-between">
                        <span className="font-medium">{isEn ? 'Team & Sharing' : 'টিম ও কর্মী শেয়ারিং'}</span>
                        {currentWorkspace?.kind === 'business' && (
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                            {isEn ? 'Business' : 'ব্যবসা'}
                          </span>
                        )}
                      </div>
                    </button>
                  </div>

                  {/* Secondary info and sign out */}
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowHamburgerMenu(false);
                        onOpenAboutModal();
                      }}
                      className="w-full px-3 py-2 text-left flex items-center gap-2.5 text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors min-h-[44px]"
                      role="menuitem"
                    >
                      <Info className="w-4 h-4 text-slate-500" />
                      <span className="font-medium">{isEn ? 'About' : 'অ্যাপ পরিচিতি'}</span>
                    </button>


                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
