/**
 * App State and Services Context
 * Provides reactive access to LocalDatabase, SyncOrchestrator, GoogleAuth,
 * and multi-device simulation.
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalDatabase } from '../storage/db';
import { SyncOrchestrator, SyncStatusInfo } from '../sync/orchestrator';
import { AutomaticSync } from '../sync/automaticSync';
import { runForegroundLoanRepayments } from '../services/loanAutoRepayment';
import { SimulatedGoogleDriveTransport, RealGoogleDriveTransport } from '../drive/transport';
import { GoogleAuthManager, GoogleUserProfile } from '../auth/googleAuth';
import { generateUUID } from '../domain/journal';
import {
  Workspace,
  Account,
  AccountGroup,
  AccountGroupSummary,
  AccountPermissionGrant,
  EmployeeRole,
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
import { soundService, SoundPreferences } from '../services/soundService';
import { migrateLegacyWorkspaceImages } from '../storage/workspaceMediaMigration';
import { notificationService } from '../notifications/service';

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
  accountGroups: AccountGroup[];
  accountPermissions: AccountPermissionGrant[];
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
  createWorkspace: (name: string, kind: 'personal' | 'business', description?: string) => Promise<Workspace>;
  archiveWorkspace: (id: UUID) => boolean;
  restoreWorkspace: (id: UUID) => boolean;
  durabilityInfo: { type: string; isPersistent: boolean; warning?: string };
  createCategory: (name: string, kind: Category['kind'], parentId?: UUID | null, nameEn?: string) => Category;
  deleteCategory: (id: UUID) => void;
  createAccount: (name: string, kind: Account['kind'], openingBalanceMinor?: string, accountNumberMasked?: string, classification?: Account['classification'], groupId?: UUID | null) => Account;
  updateAccount: (id: UUID, updates: Partial<Pick<Account, 'name' | 'accountNumberMasked' | 'kind' | 'groupId'>>) => Account | null;
  archiveAccount: (id: UUID) => boolean;
  restoreAccount: (id: UUID) => boolean;
  safeDeleteAccount: (id: UUID, confirmationText: string) => { success: boolean; mode: 'archived' | 'deleted'; error?: string };
  createAccountGroup: (name: string, icon?: string, description?: string) => AccountGroup;
  updateAccountGroup: (id: UUID, updates: Partial<Pick<AccountGroup, 'name' | 'icon' | 'description'>>) => AccountGroup | null;
  archiveAccountGroup: (id: UUID) => boolean;
  restoreAccountGroup: (id: UUID) => boolean;
  addAccountToGroup: (accountId: UUID, groupId: UUID) => boolean;
  removeAccountFromGroup: (accountId: UUID) => boolean;
  getAccountGroupSummary: (groupId: UUID) => AccountGroupSummary | null;
  grantAccountPermission: (employeeEmail: string, employeeSubjectHash: string, accountIds: UUID[], role: EmployeeRole) => AccountPermissionGrant;
  revokeAccountPermission: (grantId: UUID) => boolean;
  soundPrefs: SoundPreferences;
  setSoundPrefs: (prefs: Partial<SoundPreferences>) => void;
  createParty: (name: string, role: PartyRole, phone?: string, notes?: string) => BusinessParty;
  deleteParty: (id: UUID) => void;
  editParty: (id: UUID, updates: Partial<Pick<BusinessParty, 'name' | 'phone' | 'role' | 'notes'>>) => void;
  deleteTransaction: (id: UUID, reason?: string) => Promise<void>;
  editTransaction: (id: UUID, cmd: any) => Promise<void>;
  signInWithGoogle: () => Promise<GoogleUserProfile>;
  bootstrapWithTestProfile: (profile: GoogleUserProfile) => Promise<void>;
  updateUserProfile: (updates: {
    displayName?: string;
    photoUrl?: string;
    phone?: string;
    address?: string;
  }) => GoogleUserProfile;
  signOut: () => Promise<void>;
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
    db = new LocalDatabase(`hisab_sim_db_${deviceId}`);
    db.setDeviceIdentity(deviceId, deviceName);
    deviceDatabases.set(deviceId, db);
  }
  return db;
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const prod = isProduction();
  const simulation = !prod && import.meta.env?.VITE_ENABLE_SYNC_SIMULATION === 'true';
  const initialDevice = useMemo(() => simulation ? SIMULATED_DEVICES[0] : getProductionDeviceProfile(), [simulation]);
  const [currentDevice, setCurrentDevice] = useState<DeviceProfile>(initialDevice);
  const [db, setDb] = useState<LocalDatabase>(() =>
    !simulation
      ? (() => {
          // Keep both existing storage keys stable across this upgrade.
          const mainDb = new LocalDatabase(prod ? 'hisab_dekhtechai_db' : 'hisab_db_device-android-A');
          mainDb.setDeviceIdentity(initialDevice.id, initialDevice.name);
          return mainDb;
        })()
      : getOrCreateDeviceDb(SIMULATED_DEVICES[0].id, SIMULATED_DEVICES[0].name)
  );

  const auth = useMemo(() => new GoogleAuthManager(), []);
  // Account preview never starts the retired Drive transport or binds legacy data.
  const accountPreview = import.meta.env.VITE_SUPABASE_AUTH_ENABLED === 'true';

  const createSecureTokenProvider = (targetDb: LocalDatabase = db) => {
    return async (forceRenew?: boolean): Promise<string> => {
      if (accountPreview) throw new Error('LEGACY_SYNC_DISABLED');
      const token = await auth.getValidAccessToken(forceRenew);
      const activeOwnerHash = targetDb.getIdentity()?.ownerSubjectHash;
      const currentAuthOwnerHash = auth.getProfile()?.subjectHash;
      if (activeOwnerHash && currentAuthOwnerHash && activeOwnerHash !== currentAuthOwnerHash) {
        throw new Error(
          `Security Error: Renewed Google account owner (${currentAuthOwnerHash}) does not match dataset owner (${activeOwnerHash}).`
        );
      }
      return token;
    };
  };

  const sharedTransport = useMemo(() => {
    if (!simulation) {
      // In production mode, never instantiate simulated cloud storage
      return new RealGoogleDriveTransport('', {
        tokenProvider: createSecureTokenProvider(db),
      });
    }
    return new SimulatedGoogleDriveTransport();
  }, [simulation, auth, db]);

  const [sync, setSync] = useState<SyncOrchestrator>(() => new SyncOrchestrator(db, sharedTransport, { cloudBackups: !simulation && !accountPreview }));

  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<UUID>('ws-personal-default');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [accountPermissions, setAccountPermissions] = useState<AccountPermissionGrant[]>([]);
  const [soundPrefs, setSoundPrefsState] = useState<SoundPreferences>(() =>
    soundService.getPreferences()
  );

  const setSoundPrefs = (prefs: Partial<SoundPreferences>) => {
    soundService.setPreferences(prefs);
    setSoundPrefsState(soundService.getPreferences());
  };

  const [categories, setCategories] = useState<Category[]>([]);
  const [parties, setParties] = useState<BusinessParty[]>([]);
  const [transactions, setTransactions] = useState<JournalTransaction[]>([]);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatusInfo>(() => sync.getStatus());
  const [userProfile, setUserProfile] = useState<GoogleUserProfile | null>(() => auth.getProfile());
  const [isOnline, setIsOnlineState] = useState<boolean>(() => typeof navigator === 'undefined' || navigator.onLine);
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

  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  // Initialize durable storage engine on mount / db switch
  useEffect(() => {
    let isMounted = true;
    setStorageReady(false);
    db.init().then(async () => {
      if (!simulation) { db.setDeviceIdentity(initialDevice.id, initialDevice.name); await db.persist(); }
      if (!simulation) await migrateLegacyWorkspaceImages(db)
        .catch(() => console.warn('Previous workspace photos remain safe locally; their sync copy will retry on reconnect.'));
      if (isMounted) {
        db.getDurabilityInfo().then((info) => {
          if (isMounted) setDurabilityInfo(info);
        });
        refreshState();
        setStorageReady(true);
      }
    }).catch(() => { if (isMounted) setStorageError(true); });
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
      setAccountGroups(db.getAccountGroups(activeWs.id));
      setAccountPermissions(db.getAccountPermissions(activeWs.id));
      setCategories(db.getCategories(activeWs.id));
      setParties(db.getParties(activeWs.id));
      setTransactions(db.getTransactions(activeWs.id));
      setDashboardData(db.getDashboardData(activeWs.id));
      setBudgets(db.getBudgets(activeWs.id));
      setRecurringRules(db.getRecurringRules(activeWs.id));
    } else {
      setAccounts([]); setAccountGroups([]); setAccountPermissions([]); setCategories([]);
      setParties([]); setTransactions([]); setDashboardData(null); setBudgets([]); setRecurringRules([]);
    }
    setConflicts(db.getConflicts());
    setSyncStatus(sync.getStatus());
    setUserProfile(auth.getProfile());
  };
  const refreshRef = useRef(refreshState);
  refreshRef.current = refreshState;
  const automatic = useRef<AutomaticSync | null>(null);

  const authorizeAutomaticSync = async (): Promise<boolean> => {
    if (accountPreview) { sync.setAuthorized(false); return false; }
    const owner = db.getIdentity()?.ownerSubjectHash;
    if (!owner || auth.isTestMode() || auth.getProfile()?.subjectHash !== owner) { sync.setAuthorized(false); return false; }
    try { await auth.getValidAccessToken(); sync.setAuthorized(true); return true; }
    catch { sync.setAuthorized(false); refreshRef.current(); return false; }
  };

  useEffect(() => {
    sync.setAuthorized(!accountPreview && auth.isRealGoogleAuthenticated() && !!db.getIdentity());
    const unsub = sync.subscribe((status) => {
      setSyncStatus(status);
      refreshRef.current();
    });
    return unsub;
  }, [db, sync, accountPreview]);

  useEffect(() => { refreshRef.current(); }, [currentWorkspaceId]);

  const notificationLanguage = useRef(language);
  notificationLanguage.current = language;
  useEffect(() => {
    if (!storageReady || simulation) return;
    const detach = notificationService.attach(auth, () => db.getIdentity()?.ownerSubjectHash || '', () => notificationLanguage.current);
    const unsubscribe = db.subscribeToCommittedJournals(notificationService.committed);
    return () => { unsubscribe(); detach(); };
  }, [db, auth, storageReady, simulation, userProfile?.subjectHash]);

  useEffect(() => {
    if (!storageReady || simulation) return;
    if (accountPreview) return;
    const worker = new AutomaticSync(db, sync, {
      enabled: () => (typeof navigator === 'undefined' || navigator.onLine) &&
        (typeof document === 'undefined' || document.visibilityState === 'visible') && !!auth.getProfile(),
      authorize: authorizeAutomaticSync,
      afterVerifiedSync: async () => { if (auth.getProfile()?.subjectHash === db.getIdentity()?.ownerSubjectHash) await runForegroundLoanRepayments(db); refreshRef.current(); },
    });
    automatic.current = worker;
    const foreground = () => { if (document.visibilityState === 'visible') worker.request(true); };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('focus', foreground);
    window.addEventListener('hisab-foreground', foreground);
    worker.start();
    return () => {
      worker.stop(); automatic.current = null;
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('focus', foreground);
      window.removeEventListener('hisab-foreground', foreground);
    };
  }, [db, sync, auth, storageReady, simulation, userProfile?.subjectHash, accountPreview]);

  // Automatic sync on network connectivity restoration
  useEffect(() => {
    const handleOnline = () => {
      console.info('[Network] Connectivity restored. Automatically triggering sync.');
      setIsOnlineState(true);
      sync.setOnline(true);
      automatic.current?.request(true);
    };

    const handleOffline = () => {
      console.info('[Network] Connection lost. Switching to offline mode.');
      setIsOnlineState(false);
      sync.setOnline(false);
    };
    sync.setOnline(typeof navigator === 'undefined' || navigator.onLine);

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
    if (!simulation) {
      console.warn('Security: Simulated device switching is forbidden in production mode.');
      return;
    }
    const targetDb = getOrCreateDeviceDb(dev.id, dev.name);
    const isRealGoogle = auth.isRealGoogleAuthenticated();
    const targetTransport =
      isRealGoogle && userProfile?.accessToken && !auth.isTokenExpired()
        ? new RealGoogleDriveTransport(userProfile.accessToken, {
            tokenProvider: createSecureTokenProvider(targetDb),
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
      setTimeout(() => targetSync.triggerSync().catch(console.warn), 200);
    }
  };

  const setIsOnline = (online: boolean) => {
    setIsOnlineState(online);
    sync.setOnline(online);
    if (online) {
      automatic.current?.request(true);
    }
  };

  const triggerManualSync = async () => {
    if (!await authorizeAutomaticSync()) {
      sync.setAuthorized(false);
      throw new Error('AUTH_REQUIRED: Reconnect Google Drive.');
    }
    await sync.triggerSync();
    refreshState();
    const status = sync.getStatus();
    if (status.state !== 'synced_verified') throw new Error(status.lastError || status.state);
    if (auth.getProfile()?.subjectHash === db.getIdentity()?.ownerSubjectHash) await runForegroundLoanRepayments(db);
    refreshState();
  };

  const createWorkspace = async (name: string, kind: 'personal' | 'business', description = '') => {
    await db.beginTransaction();
    try { const ws = db.createWorkspace(name, kind, description); await db.commitTransaction(); refreshState(); return ws; }
    catch (error) { await db.rollbackTransaction(); throw error; }
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

  const createAccount = (
    name: string,
    kind: Account['kind'],
    openingBalanceMinor = '0',
    accountNumberMasked = '',
    classification: Account['classification'] = 'asset',
    groupId?: UUID | null
  ) => {
    const acc = db.createAccount(
      currentWorkspaceId,
      name,
      kind,
      openingBalanceMinor,
      accountNumberMasked,
      classification,
      groupId || null
    );
    refreshState();
    return acc;
  };

  const updateAccount = (
    id: UUID,
    updates: Partial<Pick<Account, 'name' | 'accountNumberMasked' | 'kind' | 'groupId'>>
  ) => {
    const res = db.updateAccount(id, updates);
    refreshState();
    return res;
  };

  const archiveAccount = (id: UUID) => {
    const res = db.archiveAccount(id);
    refreshState();
    return res;
  };

  const restoreAccount = (id: UUID) => {
    const res = db.restoreAccount(id);
    refreshState();
    return res;
  };

  const safeDeleteAccount = (id: UUID, confirmationText: string) => {
    const res = db.safeDeleteAccount(id, confirmationText);
    refreshState();
    return res;
  };

  const createAccountGroup = (name: string, icon?: string, description?: string) => {
    const group = db.createAccountGroup(currentWorkspaceId, name, icon, description);
    refreshState();
    return group;
  };

  const updateAccountGroup = (
    id: UUID,
    updates: Partial<Pick<AccountGroup, 'name' | 'icon' | 'description'>>
  ) => {
    const res = db.updateAccountGroup(id, updates);
    refreshState();
    return res;
  };

  const archiveAccountGroup = (id: UUID) => {
    const res = db.archiveAccountGroup(id);
    refreshState();
    return res;
  };

  const restoreAccountGroup = (id: UUID) => {
    const res = db.restoreAccountGroup(id);
    refreshState();
    return res;
  };

  const addAccountToGroup = (accountId: UUID, groupId: UUID) => {
    const res = db.addAccountToGroup(accountId, groupId);
    refreshState();
    return res;
  };

  const removeAccountFromGroup = (accountId: UUID) => {
    const res = db.removeAccountFromGroup(accountId);
    refreshState();
    return res;
  };

  const getAccountGroupSummary = (groupId: UUID) => {
    return db.getAccountGroupSummary(groupId);
  };

  const grantAccountPermission = (
    employeeEmail: string,
    employeeSubjectHash: string,
    accountIds: UUID[],
    role: EmployeeRole
  ) => {
    const grant = db.grantAccountPermission(
      currentWorkspaceId,
      employeeEmail,
      employeeSubjectHash,
      accountIds,
      role
    );
    refreshState();
    return grant;
  };

  const revokeAccountPermission = (grantId: UUID) => {
    const res = db.revokeAccountPermission(grantId);
    refreshState();
    return res;
  };

  const deleteTransaction = async (id: UUID, reason?: string) => {
    await db.deleteTransaction(id, reason);
    refreshState();
  };

  const editTransaction = async (id: UUID, cmd: any) => {
    await db.editTransaction(id, cmd);
    refreshState();
  };

  const signInWithGoogle = async (): Promise<GoogleUserProfile> => {
    if (accountPreview) throw new Error('LEGACY_SYNC_DISABLED');
    // Invoke GIS within the original tap. Awaiting storage first loses popup permission on mobile.
    const needsBinding = !db.getIdentity() && !db.hasOnlyUntouchedStarters();
    if (needsBinding && !window.confirm(language === 'en'
      ? 'Link all existing offline records on this device to the Google account you select? Use only your own account.'
      : 'এই ডিভাইসের সব অফলাইন হিসাব নির্বাচিত গুগল অ্যাকাউন্টের সাথে যুক্ত করবেন? শুধুমাত্র নিজের অ্যাকাউন্ট ব্যবহার করুন।')) {
      throw new Error('Offline ownership binding cancelled.');
    }
    const profile = await auth.promptGoogleSignIn();
    try {
      if (profile.accessToken) {
        sync.setTransport(
          new RealGoogleDriveTransport(profile.accessToken, {
            tokenProvider: createSecureTokenProvider(db),
          })
        );
      }
      await sync.bootstrapAndRestore(profile, needsBinding);
    } catch (err) {
      auth.signOut();
      sync.setAuthorized(false);
      refreshState();
      throw err;
    }
    refreshState();
    const status = sync.getStatus();
    if (status.state !== 'synced_verified') throw new Error(status.lastError || status.state);
    return profile;
  };

  const bootstrapWithTestProfile = async (profile: GoogleUserProfile): Promise<void> => {
    if (prod) throw new Error('Test authentication is forbidden in production.');
    try {
      await sync.bootstrapAndRestore(profile, true);
      refreshState();
    } catch (err) {
      auth.signOut();
      refreshState();
      throw err;
    }
  };

  const updateUserProfile = (updates: {
    displayName?: string;
    photoUrl?: string;
    phone?: string;
    address?: string;
  }) => {
    const updated = auth.updateEditableProfile(updates);
    refreshState();
    return updated;
  };

  const signOut = async () => {
    await notificationService.disable();
    auth.signOut();
    sync.setAuthorized(false);
    refreshState();
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
        accountGroups,
        accountPermissions,
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
        createAccount,
        updateAccount,
        archiveAccount,
        restoreAccount,
        safeDeleteAccount,
        createAccountGroup,
        updateAccountGroup,
        archiveAccountGroup,
        restoreAccountGroup,
        addAccountToGroup,
        removeAccountFromGroup,
        getAccountGroupSummary,
        grantAccountPermission,
        revokeAccountPermission,
        soundPrefs,
        setSoundPrefs,
        createParty,
        deleteParty,
        editParty,
        deleteTransaction,
        editTransaction,
        signInWithGoogle,
        bootstrapWithTestProfile,
        updateUserProfile,
        signOut,
      }}
    >
      {storageReady ? children : <div role="status" className="p-8 text-center">{storageError ? 'Storage could not be opened. Your records are preserved. Restart the app; do not clear storage.' : 'Opening your local records…'}</div>}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
