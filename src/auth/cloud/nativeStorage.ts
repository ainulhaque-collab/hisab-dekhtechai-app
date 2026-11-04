import { Capacitor, registerPlugin } from '@capacitor/core';
import type { CloudSecretStorage } from './secureStorage';

const vault = registerPlugin<{
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
  clear(options: { prefix: string }): Promise<void>;
}>('CloudSessionVault');

/** AndroidKeyStore-backed credentials. No Preferences/localStorage fallback on an old APK. */
export class AndroidCloudStorage implements CloudSecretStorage {
  constructor(private namespace: string) {}
  private key(key: string) {
    if (!Capacitor.isPluginAvailable('CloudSessionVault')) throw new Error('CLOUD_NATIVE_UPDATE_REQUIRED');
    if ((key !== this.namespace && !key.startsWith(`${this.namespace}-`)) || key.length > 240) throw new Error('CLOUD_STORAGE_KEY');
    return key;
  }
  async getItem(key: string) { return (await vault.get({ key: this.key(key) })).value; }
  setItem(key: string, value: string) { return vault.set({ key: this.key(key), value }); }
  removeItem(key: string) { return vault.remove({ key: this.key(key) }); }
  clear() { return vault.clear({ prefix: this.key(this.namespace) }); }
}
