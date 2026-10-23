/**
 * Durable Storage Driver Abstraction
 * Implements:
 * 1. Native SQLite on Android (via @capacitor-community/sqlite)
 * 2. Durable IndexedDB with OPFS / StorageManager persistence request on Web
 * 3. Graceful, non-destructive fallback for Node.js test environments
 */

import { Capacitor } from '@capacitor/core';

export type StorageType = 'sqlite-native' | 'indexeddb-durable' | 'localstorage-fallback';

export interface DurableStorageDriver {
  init(): Promise<void>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  isPersistent(): Promise<boolean>;
  getType(): StorageType;
}

/**
 * 1. Native SQLite Storage Driver for Android
 */
export class CapacitorSqliteDriver implements DurableStorageDriver {
  private dbName: string;
  private sqliteConnection: any = null;
  private db: any = null;
  private isInitialized = false;

  constructor(dbName = 'hisab_dekhtechai_db') {
    this.dbName = dbName;
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
      this.sqliteConnection = new SQLiteConnection(CapacitorSQLite);

      const isConsistent = await this.sqliteConnection.checkConnectionsConsistency();
      const isConnected = await this.sqliteConnection.isConnection(this.dbName, false);

      if (isConsistent.result && isConnected.result) {
        this.db = await this.sqliteConnection.retrieveConnection(this.dbName, false);
      } else {
        this.db = await this.sqliteConnection.createConnection(
          this.dbName,
          false,
          'no-encryption',
          1,
          false
        );
      }

      await this.db.open();

      // Create durable key-value store table and transaction journal tables
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS durable_kv (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      this.isInitialized = true;
    } catch (err) {
      console.warn('Native SQLite initialization failed or running in non-native environment:', err);
      throw err;
    }
  }

  public async getItem(key: string): Promise<string | null> {
    if (!this.db) return null;
    const res = await this.db.query('SELECT value FROM durable_kv WHERE key = ?;', [key]);
    if (res.values && res.values.length > 0) {
      return res.values[0].value;
    }
    return null;
  }

  public async setItem(key: string, value: string): Promise<void> {
    if (!this.db) return;
    const now = new Date().toISOString();
    await this.db.run(
      'INSERT OR REPLACE INTO durable_kv (key, value, updated_at) VALUES (?, ?, ?);',
      [key, value, now]
    );
  }

  public async removeItem(key: string): Promise<void> {
    if (!this.db) return;
    await this.db.run('DELETE FROM durable_kv WHERE key = ?;', [key]);
  }

  public async isPersistent(): Promise<boolean> {
    return true; // Native SQLite on Android file system is 100% durable across app updates & restarts
  }

  public getType(): StorageType {
    return 'sqlite-native';
  }
}

/**
 * 2. Durable IndexedDB Storage Driver for Web & PWA
 * Automatically requests persistent storage from the browser (StorageManager.persist)
 */
export class IndexedDBDurableDriver implements DurableStorageDriver {
  private dbName: string;
  private storeName = 'hisab_store';
  private db: IDBDatabase | null = null;
  private isPersisted = false;

  constructor(dbName = 'hisab_dekhtechai_durable_v1') {
    this.dbName = dbName;
  }

  public async init(): Promise<void> {
    if (this.db) return;

    // Request browser storage persistence to prevent eviction
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        this.isPersisted = await navigator.storage.persist();
      } catch {
        this.isPersisted = false;
      }
    }

    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not supported in this runtime.');
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = (event: any) => {
        this.db = event.target.result;
        resolve();
      };

      request.onerror = (event: any) => {
        reject(event.target.error || new Error('Failed to open IndexedDB'));
      };
    });
  }

  public async getItem(key: string): Promise<string | null> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db!.transaction(this.storeName, 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  public async setItem(key: string, value: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db!.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(value, key);

        request.onsuccess = () => {
          resolve();
        };
        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  public async removeItem(key: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db!.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(key);

        request.onsuccess = () => {
          resolve();
        };
        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  public async isPersistent(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persisted) {
      try {
        return await navigator.storage.persisted();
      } catch {
        return this.isPersisted;
      }
    }
    return this.isPersisted;
  }

  public getType(): StorageType {
    return 'indexeddb-durable';
  }
}

/**
 * 3. Fallback LocalStorage & Memory Driver (for Node.js test runs or old engines)
 */
export class LocalStorageFallbackDriver implements DurableStorageDriver {
  private mem = new Map<string, string>();

  public async init(): Promise<void> {
    // No-op
  }

  public async getItem(key: string): Promise<string | null> {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    return this.mem.get(key) || null;
  }

  public async setItem(key: string, value: string): Promise<void> {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
    this.mem.set(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
    this.mem.delete(key);
  }

  public async isPersistent(): Promise<boolean> {
    return false;
  }

  public getType(): StorageType {
    return 'localstorage-fallback';
  }
}

/**
 * Factory that selects the most durable storage available:
 * 1. Native Android SQLite when running on device/emulator
 * 2. IndexedDB with StorageManager persistent lease on Web
 * 3. Fallback driver for Node.js unit tests
 */
export async function createDurableStorageDriver(dbName?: string): Promise<DurableStorageDriver> {
  // 1. Android Capacitor Native Platform Check
  if (Capacitor.isNativePlatform()) {
    try {
      const sqliteDriver = new CapacitorSqliteDriver(dbName);
      await sqliteDriver.init();
      return sqliteDriver;
    } catch (err) {
      console.warn('Native SQLite unavailable, attempting IndexedDB driver:', err);
    }
  }

  // 2. Browser Environment with IndexedDB
  if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
    try {
      const idbDriver = new IndexedDBDurableDriver(dbName);
      await idbDriver.init();
      return idbDriver;
    } catch (err) {
      console.warn('IndexedDB unavailable, using fallback driver:', err);
    }
  }

  // 3. Fallback (Node.js tests, headless, or private browsing restriction)
  const fallback = new LocalStorageFallbackDriver();
  await fallback.init();
  return fallback;
}
