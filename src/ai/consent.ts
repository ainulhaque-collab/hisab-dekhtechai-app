import { createDurableStorageDriver, DurableStorageDriver } from '../storage/drivers/durableStorage';

// Device-only storage: never exported, restored or synced with financial records.
// A different provider or privacy policy must use a new scope.
const scope = 'gemini-selected-media-v1';
export const AI_CONSENT_CHANGED = 'hisab-ai-consent-changed';
export class AIConsentStore {
  constructor(private driver: Pick<DurableStorageDriver, 'getItem' | 'setItem' | 'removeItem'>, private purpose=scope) {}
  private key(owner: string) {
    if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error('AI_AUTH_REQUIRED');
    return `${this.purpose}:${owner}`;
  }
  async allowed(owner: string) { return !!owner && await this.driver.getItem(this.key(owner)) === 'allowed'; }
  async allow(owner: string) { await this.driver.setItem(this.key(owner), 'allowed'); }
  async revoke(owner: string) { await this.driver.removeItem(this.key(owner)); }
}
let storage: Promise<AIConsentStore> | undefined;
export function aiConsentStore() {
  return storage ||= createDurableStorageDriver('hisab_ai_permissions_v1').then(driver => new AIConsentStore(driver))
    .catch(error => { storage = undefined; throw error; });
}
let guideStorage:Promise<AIConsentStore>|undefined;
export function aiGuideConsentStore() {
  return guideStorage ||= createDurableStorageDriver('hisab_ai_guide_permissions_v1').then(driver=>new AIConsentStore(driver,'gemini-financial-summary-v1'))
    .catch(error=>{guideStorage=undefined;throw error;});
}
export function notifyAIConsentChanged() {
  window.dispatchEvent(new Event(AI_CONSENT_CHANGED));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(AI_CONSENT_CHANGED);
    channel.postMessage('changed'); channel.close();
  }
}
