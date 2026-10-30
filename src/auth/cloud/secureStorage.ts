/** Only credentials and PKCE state belong here. Financial records stay in LocalDatabase. */
export interface CloudSecretStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface EncryptedAuthRecord { key: CryptoKey; iv: Uint8Array; ciphertext: ArrayBuffer }
export interface EncryptedAuthRecords {
  get(id: string): Promise<EncryptedAuthRecord | undefined>;
  put(id: string, value: EncryptedAuthRecord): Promise<void>;
  remove(id: string): Promise<void>;
  clearPrefix(prefix: string): Promise<void>;
}

class IndexedAuthRecords implements EncryptedAuthRecords {
  private async run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('hisab_cloud_credentials_v1', 1);
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error('CLOUD_STORAGE_UNAVAILABLE')); }, 5000);
      open.onupgradeneeded = () => open.result.createObjectStore('records');
      open.onerror = () => { clearTimeout(timer); reject(new Error('CLOUD_STORAGE_UNAVAILABLE')); };
      open.onsuccess = () => {
        const db = open.result;
        if (expired) { db.close(); return; }
        const tx = db.transaction('records', mode);
        let request: IDBRequest<T>;
        try { request = work(tx.objectStore('records')); }
        catch { tx.abort(); db.close(); clearTimeout(timer); reject(new Error('CLOUD_STORAGE_UNAVAILABLE')); return; }
        tx.oncomplete = () => { clearTimeout(timer); db.close(); resolve(request.result); };
        tx.onabort = tx.onerror = () => { clearTimeout(timer); db.close(); reject(new Error('CLOUD_STORAGE_UNAVAILABLE')); };
      };
    });
  }
  get(id: string) { return this.run<EncryptedAuthRecord | undefined>('readonly', store => store.get(id)); }
  async put(id: string, value: EncryptedAuthRecord) { await this.run('readwrite', store => store.put(value, id)); }
  async remove(id: string) { await this.run('readwrite', store => store.delete(id)); }
  async clearPrefix(prefix: string) {
    await this.run('readwrite', store => store.delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`)));
  }
}

/**
 * AES-GCM with a structured-cloned non-extractable key, fresh IV and origin/project/key AAD.
 * No localStorage/plaintext fallback. This protects stored bytes, not same-origin script compromise.
 * IndexedDB commits key+ciphertext together so a crash cannot leave mismatched generations.
 */
export class EncryptedCloudStorage implements CloudSecretStorage {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly prefix: string;
  constructor(private namespace: string, private origin: string, private records: EncryptedAuthRecords = new IndexedAuthRecords()) {
    this.prefix = `${origin}|${namespace}|`;
  }
  private id(key: string) {
    if (key !== this.namespace && !key.startsWith(`${this.namespace}-`)) throw new Error('CLOUD_STORAGE_KEY');
    if (key.length > 240) throw new Error('CLOUD_STORAGE_KEY');
    return `${this.prefix}${key}`;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => {}); return result;
  }
  getItem(key: string): Promise<string | null> {
    return this.serial(async () => {
      const id = this.id(key), record = await this.records.get(id);
      if (!record) return null;
      try {
        if (record.key.extractable || record.iv.length !== 12 || record.ciphertext.byteLength > 65552) throw new Error();
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv as Uint8Array<ArrayBuffer>,
          additionalData: new TextEncoder().encode(id) }, record.key, record.ciphertext);
        return new TextDecoder().decode(plain);
      } catch { await this.records.remove(id); throw new Error('CLOUD_STORAGE_INVALID'); }
    });
  }
  setItem(key: string, value: string): Promise<void> {
    return this.serial(async () => {
      const id = this.id(key), bytes = new TextEncoder().encode(value);
      if (bytes.length > 65536) throw new Error('CLOUD_STORAGE_SIZE');
      const secret = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) }, secret, bytes);
      await this.records.put(id, { key: secret, iv, ciphertext });
    });
  }
  removeItem(key: string) { return this.serial(() => this.records.remove(this.id(key))); }
  clear() { return this.serial(() => this.records.clearPrefix(this.prefix)); }
}

/** Prevent a late refresh/callback from re-saving credentials after local logout. */
export class RevocableCloudStorage implements CloudSecretStorage {
  private revoked = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private delegate: CloudSecretStorage) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.catch(() => {}); return result;
  }
  getItem(key: string) { return this.serial(() => this.revoked ? Promise.resolve(null) : this.delegate.getItem(key)); }
  setItem(key: string, value: string) {
    return this.serial(() => {
      if (this.revoked) throw new Error('CLOUD_SESSION_CLOSED');
      return this.delegate.setItem(key, value);
    });
  }
  removeItem(key: string) { return this.serial(() => this.delegate.removeItem(key)); }
  clear() { return this.serial(() => this.delegate.clear()); }
  async revoke() { this.revoked = true; await this.clear(); }
}
