/** Short-lived, same-tab reload recovery. No plaintext tokens in browser storage. */
export interface SessionKeyStore {
  get(id: string): Promise<CryptoKey | null>;
  put(id: string, key: CryptoKey, expiresAt: number): Promise<void>;
  remove(id: string): Promise<void>;
}

class IndexedSessionKeys implements SessionKeyStore {
  private async access<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('hisab_oauth_session_keys_v1', 1);
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; reject(new Error('Session key storage unavailable.')); }, 5_000);
      open.onupgradeneeded = () => { open.result.createObjectStore('keys'); };
      open.onerror = () => { clearTimeout(timeout); reject(open.error); };
      open.onsuccess = () => {
        const db = open.result;
        if (timedOut) { db.close(); return; }
        const tx = db.transaction('keys', mode);
        let request: IDBRequest<T>;
        try { request = run(tx.objectStore('keys')); }
        catch (error) { clearTimeout(timeout); db.close(); reject(error); return; }
        tx.oncomplete = () => { clearTimeout(timeout); db.close(); resolve(request.result); };
        tx.onerror = tx.onabort = () => { clearTimeout(timeout); db.close(); reject(tx.error); };
      };
    });
  }
  async get(id: string): Promise<CryptoKey | null> {
    const record = await this.access('readonly', store => store.get(id));
    return record && record.expiresAt > Date.now() ? record.key : null;
  }
  async put(id: string, key: CryptoKey, expiresAt: number): Promise<void> {
    await this.access('readwrite', store => {
      // Reclaim abandoned keys from closed tabs after their access token expires.
      const cursor = store.openCursor();
      cursor.onsuccess = () => { const item = cursor.result; if (item) { if (item.value.expiresAt <= Date.now()) item.delete(); item.continue(); } };
      return store.put({ key, expiresAt }, id);
    });
  }
  async remove(id: string): Promise<void> { await this.access('readwrite', store => store.delete(id)); }
}

const STORAGE_KEY = 'hisab_google_tab_session_v1';
export interface BrowserAccessSession { accessToken: string; tokenExpiresAt: number }

/**
 * AES-GCM ciphertext lives in sessionStorage, bound to origin/client/owner.
 * The non-extractable key is structured-cloned into IndexedDB, never exported.
 * This protects stored bytes, not a compromised same-origin JavaScript runtime.
 */
export class BrowserTokenSession {
  private revision = 0;
  private storage?: Storage;
  private keys: SessionKeyStore;
  private origin: string;
  private now: () => number;

  constructor(options: { storage?: Storage; keys?: SessionKeyStore; origin?: string; now?: () => number } = {}) {
    try { this.storage = options.storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined); } catch {}
    this.keys = options.keys ?? new IndexedSessionKeys();
    this.origin = options.origin ?? (typeof location !== 'undefined' ? location.origin : '');
    this.now = options.now ?? Date.now;
  }

  clear(): void {
    this.revision++;
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      this.storage?.removeItem(STORAGE_KEY);
      const id = raw ? JSON.parse(raw).keyId : null;
      if (typeof id === 'string') void this.keys.remove(id).catch(() => {});
    } catch { /* Storage denial must not block logout or local records. */ }
  }

  async save(session: BrowserAccessSession, owner: string, client: string): Promise<void> {
    this.clear();
    const revision = this.revision;
    if (!this.storage || !this.origin || !globalThis.crypto?.subtle || !session.accessToken ||
        !Number.isFinite(session.tokenExpiresAt) || session.tokenExpiresAt <= this.now() + 60_000) return;
    const keyId = crypto.randomUUID();
    try {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aad = new TextEncoder().encode(JSON.stringify([1, this.origin, client, owner]));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key,
        new TextEncoder().encode(JSON.stringify(session)));
      await this.keys.put(keyId, key, session.tokenExpiresAt);
      if (revision !== this.revision) { await this.keys.remove(keyId); return; }
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, keyId, iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) }));
    } catch {
      void this.keys.remove(keyId).catch(() => {});
      // The current in-memory session still works if storage/crypto is unavailable.
    }
  }

  async read(owner: string, client: string): Promise<BrowserAccessSession | null> {
    const revision = this.revision;
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw || !this.origin || !globalThis.crypto?.subtle) return null;
      if (raw.length > 100_000) throw new Error('Invalid session.');
      const record = JSON.parse(raw);
      if (record.version !== 1 || typeof record.keyId !== 'string' || !Array.isArray(record.iv) || record.iv.length !== 12 ||
          !Array.isArray(record.ciphertext) || record.ciphertext.length > 24_000) throw new Error('Invalid session.');
      const key = await this.keys.get(record.keyId);
      if (!key || key.extractable) throw new Error('Session key unavailable.');
      const aad = new TextEncoder().encode(JSON.stringify([1, this.origin, client, owner]));
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(record.iv), additionalData: aad }, key,
        new Uint8Array(record.ciphertext));
      const session = JSON.parse(new TextDecoder().decode(bytes));
      if (typeof session.accessToken !== 'string' || !session.accessToken || !Number.isFinite(session.tokenExpiresAt) ||
          session.tokenExpiresAt <= this.now() + 60_000) throw new Error('Session expired.');
      return revision === this.revision ? session : null;
    } catch {
      if (revision === this.revision) this.clear();
      return null;
    }
  }
}
