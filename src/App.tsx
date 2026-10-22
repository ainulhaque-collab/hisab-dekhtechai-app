/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
import { JournalTransaction } from './contracts/types';

function MainApp() {
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [selectedTx, setSelectedTx] = useState<JournalTransaction | null>(null);

  // Modals state
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isPartiesModalOpen, setIsPartiesModalOpen] = useState(false);

  const handleSelectTransactionFromDashboard = (tx: JournalTransaction) => {
    setSelectedTx(tx);
    setActiveTab('history');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-blue-100">
      {/* Top Header Navbar */}
      <Navbar
        onOpenSyncModal={() => setIsSyncModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        onOpenSnapshotModal={() => setIsSnapshotModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-lg w-full mx-auto px-4 pt-4">
        {activeTab === 'home' && (
          <DashboardTab
            onNavigateToAdd={() => setActiveTab('add')}
            onNavigateToHistory={() => setActiveTab('history')}
            onSelectTransaction={handleSelectTransactionFromDashboard}
            onOpenSyncModal={() => setIsSyncModalOpen(true)}
            onOpenPartiesModal={() => setIsPartiesModalOpen(true)}
          />
        )}

        {activeTab === 'accounts' && <AccountsTab />}

        {activeTab === 'add' && (
          <AddTransactionTab onSuccess={() => setActiveTab('home')} />
        )}

        {activeTab === 'history' && (
          <HistoryTab
            selectedTransaction={selectedTx}
            onClearSelected={() => setSelectedTx(null)}
          />
        )}

        {activeTab === 'reports' && <ReportsTab />}
      </main>

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
        onClose={() => setIsSettingsModalOpen(false)}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      <PartiesModal
        isOpen={isPartiesModalOpen}
        onClose={() => setIsPartiesModalOpen(false)}
      />
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
