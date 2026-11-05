/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { BottomNav, TabType } from './components/BottomNav';
import { DashboardTab } from './components/DashboardTab';
import { AccountsTab } from './components/AccountsTab';
import { AddTransactionTab } from './components/AddTransactionTab';
import { HistoryTab } from './components/HistoryTab';
import { ReportsTab } from './components/ReportsTab';
import { SyncModal } from './components/SyncModal';
import { ConflictModal } from './components/ConflictModal';
import { SnapshotModal } from './components/SnapshotModal';
import { SettingsModal } from './components/SettingsModal';
import { AuthModal } from './components/AuthModal';
import { PartiesModal } from './components/PartiesModal';
import { ProfileModal } from './components/ProfileModal';
import { TeamSharingModal } from './components/TeamSharingModal';
import { AboutModal } from './components/AboutModal';
import { SavingsGoalsModal } from './components/SavingsGoalsModal';
import { SavingsLoansModal } from './components/SavingsLoansModal';
import { PinLockScreen } from './components/PinLockScreen';
import { pinLock } from './security/pinLock';
import { JournalTransaction } from './contracts/types';
import { hasAccountCallback } from './auth/cloud/callbackLocation';
const accountAuthEnabled=import.meta.env.VITE_SUPABASE_AUTH_ENABLED==='true';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Captured by App ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-center max-w-sm mx-auto my-12 bg-white rounded-2xl border border-rose-200 shadow-md space-y-3">
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
            !
          </div>
          <h2 className="text-sm font-bold text-slate-800">সাময়িক ত্রুটি দেখা দিয়েছে</h2>
          <p className="text-xs text-slate-500">
            A temporary issue occurred while rendering this view.
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false });
              window.location.reload();
            }}
            className="px-4 py-2 bg-blue-700 text-white rounded-xl text-xs font-bold hover:bg-blue-800 shadow-xs"
          >
            পুনরায় লোড করুন (Reload Page)
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function MainApp() {
  const { currentWorkspace, language, auth, signOut } = useApp();
  const legacySignOut=useRef(signOut);
  legacySignOut.current=signOut;
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [selectedTx, setSelectedTx] = useState<JournalTransaction | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(() => !pinLock.isEnabled());

  useEffect(() => {
    const lock = () => { if (pinLock.isEnabled()) setIsUnlocked(false); };
    const visibility = () => { if (document.visibilityState === 'hidden') lock(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('hisab-background', lock);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('hisab-background', lock); };
  }, []);

  // Modals state
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(hasAccountCallback);
  const [settingsSection,setSettingsSection]=useState<'home'|'account'>(()=>hasAccountCallback()?'account':'home');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isPartiesModalOpen, setIsPartiesModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isTeamSharingModalOpen, setIsTeamSharingModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isSavingsGoalsOpen, setIsSavingsGoalsOpen] = useState(false);
  const [savingsLoanGoalId, setSavingsLoanGoalId] = useState<string | undefined>();
  const [isSavingsLoansOpen, setIsSavingsLoansOpen] = useState(false);
  const openConnectionSettings=()=>{
    if(accountAuthEnabled){setSettingsSection('account');setIsSettingsModalOpen(true);}
    else setIsSyncModalOpen(true);
  };

  useEffect(()=>{
    if(!accountAuthEnabled)return;
    let stopped=false;
    const show=()=>{if(!stopped){setSettingsSection('account');setIsSettingsModalOpen(true);}};
    let refresh=()=>{};
    let unregister=()=>{};
    const visible=()=>{if(!document.hidden)refresh();};
    window.addEventListener('hisab-account-callback',show);
    window.addEventListener('online',visible);window.addEventListener('offline',visible);
    document.addEventListener('visibilitychange',visible);
    void Promise.all([import('./auth/cloud/accountSettingsRuntime'),import('./auth/cloud/accountSignOut')]).then(([{accountSettingsSession:session},{registerAccountSignOutCleanup}])=>{
      if(stopped)return;
      unregister=registerAccountSignOutCleanup(async()=>{
        const profile=auth.getProfile();
        // A device-only editable profile is not a Google login credential.
        if(profile&&profile.subjectId!=='local_user')await legacySignOut.current();
      });
      refresh=()=>{void session.refresh();};void session.start();
    });
    return()=>{stopped=true;unregister();window.removeEventListener('hisab-account-callback',show);window.removeEventListener('online',visible);window.removeEventListener('offline',visible);document.removeEventListener('visibilitychange',visible);};
  },[auth]);

  if (!isUnlocked) {
    return <PinLockScreen onUnlocked={() => setIsUnlocked(true)} />;
  }

  const handleSelectTransactionFromDashboard = (tx: JournalTransaction) => {
    setSelectedTx(tx);
    setActiveTab('history');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-blue-100">
      {/* Top Header Navbar */}
      <Navbar
        onOpenSyncModal={openConnectionSettings}
        onOpenSettingsModal={() => {setSettingsSection('home');setIsSettingsModalOpen(true);}}
        onOpenTeamSharingModal={() => setIsTeamSharingModalOpen(true)}
        onOpenAboutModal={() => setIsAboutModalOpen(true)}
      />

      {/* Main Content Area */}
      <ErrorBoundary>
        <main className="flex-1 max-w-lg w-full mx-auto px-4 pt-4">
          {!currentWorkspace && <div className="my-10 rounded-2xl border border-dashed border-slate-200 bg-white p-7 text-center"><h1 className="text-base font-bold">{language === 'en' ? 'Start with a workspace' : 'একটি নতুন হিসাব খাতা তৈরি করুন'}</h1><p className="my-3 text-xs leading-relaxed text-slate-500">{language === 'en' ? 'Your archived records are safe. Create a new workspace or restore one from workspace management.' : 'আর্কাইভ করা হিসাব সুরক্ষিত আছে। নতুন খাতা তৈরি করুন অথবা খাতা পরিচালনা থেকে আগের খাতা ফিরিয়ে আনুন।'}</p><button className="rounded-xl bg-blue-700 px-4 py-3 text-xs font-semibold text-white" onClick={() => window.dispatchEvent(new Event('hisab-create-workspace'))}>{language === 'en' ? 'Create workspace' : 'নতুন খাতা তৈরি করুন'}</button></div>}
          {currentWorkspace && <>
          {activeTab === 'home' && (
            <DashboardTab
              onNavigateToAdd={() => setActiveTab('add')}
              onNavigateToHistory={() => setActiveTab('history')}
              onSelectTransaction={handleSelectTransactionFromDashboard}
              onOpenSyncModal={openConnectionSettings}
              onOpenPartiesModal={() => setIsPartiesModalOpen(true)}
              onOpenSavingsGoals={() => setIsSavingsGoalsOpen(true)}
            />
          )}

          {activeTab === 'accounts' && <AccountsTab />}

          {activeTab === 'add' && (
            <AddTransactionTab key={currentWorkspace.id} onSuccess={() => setActiveTab('home')} />
          )}

          {activeTab === 'history' && (
            <HistoryTab
              selectedTransaction={selectedTx}
              onClearSelected={() => setSelectedTx(null)}
            />
          )}

          {activeTab === 'reports' && <ReportsTab onSelectTransaction={handleSelectTransactionFromDashboard} />}
          </>}
        </main>
      </ErrorBoundary>

      {/* 5-Tab Mobile Navigation Bar */}
      <BottomNav activeTab={activeTab} onChangeTab={setActiveTab} />

      {/* Interactive Modals */}
      <SyncModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        onOpenConflictModal={() => {
          setIsSyncModalOpen(false);
          setIsConflictModalOpen(true);
        }}
        onOpenAuthModal={() => {
          setIsSyncModalOpen(false);
          setIsAuthModalOpen(true);
        }}
      />

      <ConflictModal
        isOpen={isConflictModalOpen}
        onClose={() => setIsConflictModalOpen(false)}
      />

      <SnapshotModal
        isOpen={isSnapshotModalOpen}
        onClose={() => setIsSnapshotModalOpen(false)}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        initialSection={settingsSection}
        onClose={() => setIsSettingsModalOpen(false)}
        onOpenProfileModal={() => setIsProfileModalOpen(true)}
        onOpenSyncModal={openConnectionSettings}
        onOpenSnapshotModal={() => setIsSnapshotModalOpen(true)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      <PartiesModal
        isOpen={isPartiesModalOpen}
        onClose={() => setIsPartiesModalOpen(false)}
      />

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      <TeamSharingModal
        isOpen={isTeamSharingModalOpen}
        onClose={() => setIsTeamSharingModalOpen(false)}
      />

      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />
      {isSavingsGoalsOpen && <SavingsGoalsModal onClose={() => setIsSavingsGoalsOpen(false)} onOpenLoans={goalId => { setSavingsLoanGoalId(goalId); setIsSavingsGoalsOpen(false); setIsSavingsLoansOpen(true); }} />}
      {isSavingsLoansOpen && <SavingsLoansModal initialGoalId={savingsLoanGoalId} onClose={() => { setIsSavingsLoansOpen(false); setIsSavingsGoalsOpen(true); }} />}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
  );
}
