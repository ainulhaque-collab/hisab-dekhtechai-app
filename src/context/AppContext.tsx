/**
 * App State and Services Context
 * Provides reactive access to LocalDatabase, SyncOrchestrator, GoogleAuth,
 * and multi-device simulation.
 */

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { LocalDatabase } from '../storage/db';
import { SyncOrchestrator, SyncStatusInfo } from '../sync/orchestrator';
import { SimulatedGoogleDriveTransport, RealGoogleDriveTransport } from '../drive/transport';
import { GoogleAuthManager, GoogleUserProfile } from '../auth/googleAuth';
import {
  Workspace,
  Account,
  Category,
  JournalTransaction,
  ConflictRecord,
  Budget,
  RecurringRule,
  DashboardData,
  UUID,
  BusinessParty,
  PartyRole
} from '../contracts/types';

export interface DeviceProfile {
  id: string;
  name: string;
  platform: 'android' | 'web';
}

export const SIMULATED_DEVICES: DeviceProfile[] = [
  { id: 'device-android-A', name: 'Android ফোন ১ (Redmi Note 12)', platform: 'android' },
  { id: 'device-android-B', name: 'Android ফোন ২ (Galaxy A54)', platform: 'android' },
  { id: 'device-web-client', name: 'ওয়েব ব্রাউজার (Chrome Web)', platform: 'web' },
];

interface AppContextType {
  db: LocalDatabase;
  sync: SyncOrchestrator;
  auth: GoogleAuthManager;
  currentDevice: DeviceProfile;
  switchDevice: (dev: DeviceProfile) => Promise<void>;
  currentWorkspace: Workspace | null;
  setCurrentWorkspaceId: (id: UUID) => void;
  workspaces: Workspace[];
  accounts: Account[];
  categories: Category[];
  parties: BusinessParty[];
  transactions: JournalTransaction[];
  dashboardData: DashboardData | null;
  conflicts: ConflictRecord[];
  budgets: Budget[];
  recurringRules: RecurringRule[];
  syncStatus: SyncStatusInfo;
  userProfile: GoogleUserProfile | null;
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;
  language: 'bn' | 'en';
  setLanguage: (lang: 'bn' | 'en') => void;
  refreshState: () => void;
  triggerManualSync: () => Promise<void>;
  createWorkspace: (name: string, kind: 'personal' | 'business') => Workspace;
  createCategory: (name: string, kind: Category['kind'], parentId?: UUID | null, nameEn?: string) => Category;
  deleteCategory: (id: UUID) => void;
  createParty: (name: string, role: PartyRole, phone?: string, notes?: string) => BusinessParty;
  deleteParty: (id: UUID) => void;
  editParty: (id: UUID, updates: Partial<Pick<BusinessParty, 'name' | 'phone' | 'role' | 'notes'>>) => void;
  deleteTransaction: (id: UUID, reason?: string) => Promise<void>;
  editTransaction: (id: UUID, cmd: any) => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

// Device database pool to simulate separate local SQLite databases on different phones
const deviceDatabases: Map<string, LocalDatabase> = new Map();

function getOrCreateDeviceDb(deviceId: string, deviceName: string): LocalDatabase {
  let db = deviceDatabases.get(deviceId);
  if (!db) {
    db = new LocalDatabase(`hisab_db_${deviceId}`);
    db.seedDefaultEntities();
    db.setDeviceIdentity(deviceId, deviceName);
    deviceDatabases.set(deviceId, db);
  }
  return db;
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentDevice, setCurrentDevice] = useState<DeviceProfile>(SIMULATED_DEVICES[0]);
  const [db, setDb] = useState<LocalDatabase>(() =>
    getOrCreateDeviceDb(SIMULATED_DEVICES[0].id, SIMULATED_DEVICES[0].name)
  );

  const sharedTransport = useMemo(() => new SimulatedGoogleDriveTransport(), []);
  const [sync, setSync] = useState<SyncOrchestrator>(() => new SyncOrchestrator(db, sharedTransport));
  const auth = useMemo(() => new GoogleAuthManager(), []);

  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<UUID>('ws-personal-default');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [parties, setParties] = useState<BusinessParty[]>([]);
  const [transactions, setTransactions] = useState<JournalTransaction[]>([]);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatusInfo>(() => sync.getStatus());
  const [userProfile, setUserProfile] = useState<GoogleUserProfile | null>(() => auth.getProfile());
  const [isOnline, setIsOnlineState] = useState<boolean>(true);
  const [language, setLanguageState] = useState<'bn' | 'en'>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('hisab_language');
      if (saved === 'bn' || saved === 'en') return saved;
    }
    return 'en'; // Default US English
  });

  const setLanguage = (lang: 'bn' | 'en') => {
    setLanguageState(lang);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('hisab_language', lang);
    }
  };

  // Initialize and refresh state from current device DB
  const refreshState = () => {
    const wsList = db.getWorkspaces();
    setWorkspaces(wsList);

    const activeWs = wsList.find((w) => w.id === currentWorkspaceId) || wsList[0];
    if (activeWs) {
      if (activeWs.id !== currentWorkspaceId) {
        setCurrentWorkspaceId(activeWs.id);
      }
      setAccounts(db.getAccounts(activeWs.id));
      setCategories(db.getCategories(activeWs.id));
      setParties(db.getParties(activeWs.id));
      setTransactions(db.getTransactions(activeWs.id));
      setDashboardData(db.getDashboardData(activeWs.id));
      setBudgets(db.getBudgets(activeWs.id));
      setRecurringRules(db.getRecurringRules(activeWs.id));
    }
    setConflicts(db.getConflicts());
    setSyncStatus(sync.getStatus());
    setUserProfile(auth.getProfile());
  };

  useEffect(() => {
    refreshState();
    const currentProf = auth.getProfile();
    const isRealGoogle = !!(currentProf?.accessToken && currentProf.accessToken.startsWith('ya29.'));
    if (isRealGoogle && currentProf?.accessToken) {
      sync.setTransport(new RealGoogleDriveTransport(currentProf.accessToken));
    } else {
      sync.setTransport(sharedTransport);
    }
    const unsub = sync.subscribe((status) => {
      setSyncStatus(status);
      refreshState();
    });
    return unsub;
  }, [db, sync, currentWorkspaceId, userProfile?.accessToken]);

  const switchDevice = async (dev: DeviceProfile) => {
    const targetDb = getOrCreateDeviceDb(dev.id, dev.name);
    const isRealGoogle = !!(userProfile?.accessToken && userProfile.accessToken.startsWith('ya29.'));
    const targetTransport = isRealGoogle && userProfile?.accessToken
      ? new RealGoogleDriveTransport(userProfile.accessToken)
      : sharedTransport;
    const targetSync = new SyncOrchestrator(targetDb, targetTransport);
    targetSync.setOnline(isOnline);
    setDb(targetDb);
    setSync(targetSync);
    setCurrentDevice(dev);
    // Trigger sync on device switch
    if (isOnline) {
      setTimeout(() => targetSync.triggerSync(), 200);
    }
  };

  const setIsOnline = (online: boolean) => {
    setIsOnlineState(online);
    sync.setOnline(online);
  };

  const triggerManualSync = async () => {
    await sync.triggerSync();
    refreshState();
  };

  const createWorkspace = (name: string, kind: 'personal' | 'business') => {
    const ws = db.createWorkspace(name, kind);
    refreshState();
    return ws;
  };

  const createCategory = (
    name: string,
    kind: Category['kind'],
    parentId?: UUID | null,
    nameEn?: string
  ) => {
    const cat = db.createCategory(currentWorkspaceId, name, kind, parentId, nameEn);
    refreshState();
    return cat;
  };

  const deleteCategory = (id: UUID) => {
    db.deleteCategory(id);
    refreshState();
  };

  const createParty = (name: string, role: PartyRole, phone?: string, notes?: string) => {
    const p = db.createParty(currentWorkspaceId, name, role, phone, notes);
    refreshState();
    return p;
  };

  const deleteParty = (id: UUID) => {
    db.deleteParty(id);
    refreshState();
  };

  const editParty = (id: UUID, updates: Partial<Pick<BusinessParty, 'name' | 'phone' | 'role' | 'notes'>>) => {
    db.editParty(id, updates);
    refreshState();
  };

  const deleteTransaction = async (id: UUID, reason?: string) => {
    await db.deleteTransaction(id, reason);
    refreshState();
    if (isOnline) {
      triggerManualSync().catch(console.error);
    }
  };

  const editTransaction = async (id: UUID, cmd: any) => {
    await db.editTransaction(id, cmd);
    refreshState();
    if (isOnline) {
      triggerManualSync().catch(console.error);
    }
  };

  const currentWorkspace = useMemo(() => {
    return workspaces.find((w) => w.id === currentWorkspaceId) || workspaces[0] || null;
  }, [workspaces, currentWorkspaceId]);

  return (
    <AppContext.Provider
      value={{
        db,
        sync,
        auth,
        currentDevice,
        switchDevice,
        currentWorkspace,
        setCurrentWorkspaceId,
        workspaces,
        accounts,
        categories,
        parties,
        transactions,
        dashboardData,
        conflicts,
        budgets,
        recurringRules,
        syncStatus,
        userProfile,
        isOnline,
        setIsOnline,
        language,
        setLanguage,
        refreshState,
        triggerManualSync,
        createWorkspace,
        createCategory,
        deleteCategory,
        createParty,
        deleteParty,
        editParty,
        deleteTransaction,
        editTransaction,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
