/**
 * App State and Services Context
 * Provides reactive access to LocalDatabase, SyncOrchestrator, GoogleAuth,
 * and multi-device simulation.
 */

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalDatabase } from '../storage/db';
import { SyncOrchestrator, SyncStatusInfo } from '../sync/orchestrator';
import { SimulatedGoogleDriveTransport, RealGoogleDriveTransport } from '../drive/transport';
import { GoogleAuthManager, GoogleUserProfile } from '../auth/googleAuth';
import { generateUUID } from '../domain/journal';
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
  isLiveGoogleAuth: boolean;
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;
  language: 'bn' | 'en';
  setLanguage: (lang: 'bn' | 'en') => void;
  refreshState: () => void;
  triggerManualSync: () => Promise<void>;
  createWorkspace: (name: string, kind: 'personal' | 'business') => Workspace;
  archiveWorkspace: (id: UUID) => boolean;
  restoreWorkspace: (id: UUID) => boolean;
  durabilityInfo: { type: string; isPersistent: boolean; warning?: string };
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
const isProduction = (): boolean => {
  return (
    (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD === true)
  );
};

function getProductionDeviceProfile(): DeviceProfile {
  let deviceId: string | null = null;
  let deviceName = 'Hisab Device';
  if (typeof localStorage !== 'undefined') {
    try {
      deviceId = localStorage.getItem('hisab_production_device_id_v1');
      const savedName = localStorage.getItem('hisab_production_device_name_v1');
      if (savedName) deviceName = savedName;
    } catch {}
  }
  const finalDeviceId = deviceId || generateUUID();
  if (!deviceId && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('hisab_production_device_id_v1', finalDeviceId);
    } catch {}
  }
  if (typeof navigator !== 'undefined') {
    if (Capacitor.isNativePlatform()) {
      deviceName = `Android Device (${Capacitor.getPlatform()})`;
    } else {
      const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      deviceName = isMobile ? 'Mobile Browser' : 'Desktop Browser';
    }
  }
  return {
    id: finalDeviceId,
    name: deviceName,
    platform: Capacitor.isNativePlatform() ? 'android' : 'web',
  };
}

const deviceDatabases: Map<string, LocalDatabase> = new Map();

function getOrCreateDeviceDb(deviceId: string, deviceName: string): LocalDatabase {
  let db = deviceDatabases.get(deviceId);
  if (!db) {
    db = new LocalDatabase(`hisab_db_${deviceId}`);
    db.setDeviceIdentity(deviceId, deviceName);
    deviceDatabases.set(deviceId, db);
  }
  return db;
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const prod = isProduction();
  const initialDevice: DeviceProfile = prod ? getProductionDeviceProfile() : SIMULATED_DEVICES[0];
  const [currentDevice, setCurrentDevice] = useState<DeviceProfile>(initialDevice);
  const [db, setDb] = useState<LocalDatabase>(() =>
    prod
      ? (() => {
          const mainDb = new LocalDatabase('hisab_dekhtechai_db');
          mainDb.setDeviceIdentity(initialDevice.id, initialDevice.name);
          return mainDb;
        })()
      : getOrCreateDeviceDb(SIMULATED_DEVICES[0].id, SIMULATED_DEVICES[0].name)
  );

  const auth = useMemo(() => new GoogleAuthManager(), []);
  const sharedTransport = useMemo(() => {
    if (prod) {
      // In production mode, never instantiate simulated cloud storage
      return new RealGoogleDriveTransport('', {
        tokenProvider: async (forceRenew?: boolean) => {
          const token = await auth.getValidAccessToken(forceRenew);
          const activeOwnerHash = db.getIdentity()?.ownerSubjectHash;
          const currentAuthOwnerHash = auth.getProfile()?.subjectHash;
          if (activeOwnerHash && currentAuthOwnerHash && activeOwnerHash !== currentAuthOwnerHash) {
            throw new Error(
              `Security Error: Renewed Google account owner (${currentAuthOwnerHash}) does not match dataset owner (${activeOwnerHash}).`
            );
          }
          return token;
        },
      });
    }
    return new SimulatedGoogleDriveTransport();
  }, [prod, auth, db]);

  const [sync, setSync] = useState<SyncOrchestrator>(() => new SyncOrchestrator(db, sharedTransport));

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

  const [durabilityInfo, setDurabilityInfo] = useState<{
    type: string;
    isPersistent: boolean;
    warning?: string;
  }>({ type: 'indexeddb', isPersistent: true });

  // Initialize durable storage engine on mount / db switch
  useEffect(() => {
    let isMounted = true;
    db.init().then(() => {
      if (isMounted) {
        db.getDurabilityInfo().then((info) => {
          if (isMounted) setDurabilityInfo(info);
        });
        refreshState();
      }
    });
    return () => {
      isMounted = false;
    };
  }, [db]);

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
    const isRealGoogle = auth.isRealGoogleAuthenticated();
    if (isRealGoogle && currentProf?.accessToken) {
      sync.setTransport(
        new RealGoogleDriveTransport(currentProf.accessToken, {
          tokenProvider: () => auth.getValidAccessToken(),
        })
      );
      sync.setAuthorized(true);
    } else {
      sync.setAuthorized(false);
    }
    const unsub = sync.subscribe((status) => {
      setSyncStatus(status);
      refreshState();
    });
    return unsub;
  }, [db, sync, currentWorkspaceId, userProfile?.accessToken]);

  // Automatic sync on network connectivity restoration
  useEffect(() => {
    const handleOnline = () => {
      console.info('[Network] Connectivity restored. Automatically triggering sync.');
      setIsOnlineState(true);
      sync.setOnline(true);
      if (auth.isRealGoogleAuthenticated()) {
        sync.triggerSync().catch((err) => {
          console.warn('[Auto-sync error on online restoration]:', err);
        });
      }
    };

    const handleOffline = () => {
      console.info('[Network] Connection lost. Switching to offline mode.');
      setIsOnlineState(false);
      sync.setOnline(false);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, [sync, auth]);

  const switchDevice = async (dev: DeviceProfile) => {
    if (isProduction()) {
      console.warn('Security: Simulated device switching is forbidden in production mode.');
      return;
    }
    const targetDb = getOrCreateDeviceDb(dev.id, dev.name);
    const isRealGoogle = auth.isRealGoogleAuthenticated();
    const targetTransport =
      isRealGoogle && userProfile?.accessToken && !auth.isTokenExpired()
        ? new RealGoogleDriveTransport(userProfile.accessToken, {
            tokenProvider: () => auth.getValidAccessToken(),
          })
        : sharedTransport;
    const targetSync = new SyncOrchestrator(targetDb, targetTransport);
    targetSync.setOnline(isOnline);
    if (!isRealGoogle) {
      targetSync.setAuthorized(false);
    }
    setDb(targetDb);
    setSync(targetSync);
    setCurrentDevice(dev);
    // Trigger sync on device switch
    if (isOnline && isRealGoogle) {
      setTimeout(() => targetSync.triggerSync(), 200);
    }
  };

  const setIsOnline = (online: boolean) => {
    setIsOnlineState(online);
    sync.setOnline(online);
    if (online) {
      sync.triggerSync().catch((err) => {
        console.warn('[Auto-sync error on manual online toggle]:', err);
      });
    }
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

  const archiveWorkspace = (id: UUID) => {
    const res = db.archiveWorkspace(id);
    refreshState();
    return res;
  };

  const restoreWorkspace = (id: UUID) => {
    const res = db.restoreWorkspace(id);
    refreshState();
    return res;
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
        isLiveGoogleAuth: auth.isRealGoogleAuthenticated(),
        isOnline,
        setIsOnline,
        language,
        setLanguage,
        refreshState,
        triggerManualSync,
        createWorkspace,
        archiveWorkspace,
        restoreWorkspace,
        durabilityInfo,
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
