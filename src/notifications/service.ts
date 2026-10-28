import { Capacitor } from '@capacitor/core';
import type { AIIdentity } from '../ai/client';
import { pushEndpoint } from './config';
import { createPushPlatform, type PushPlatform } from './platform';

interface Binding { owner: string; deviceId: string; secret: string; enabled: boolean }
interface QueuedEvent { id: string; at: number }
export interface PushState { enabled: boolean; busy: boolean; error: string; lastReceived: number | null; accepted: boolean }
const BINDING_KEY = 'hisab_push_binding_v1';
const EMPTY: PushState = { enabled: false, busy: false, error: '', lastReceived: null, accepted: false };
export class NotificationService {
  constructor(private options: { enabled?: boolean; platformFactory?: typeof createPushPlatform; fetchFn?: typeof fetch; endpoint?: string } = {}) {}
  private state = EMPTY;
  private listeners = new Set<() => void>();
  private identity: AIIdentity | null = null;
  private owner = () => '';
  private language = () => 'en';
  private platform: PushPlatform | null = null;
  private serialized: Promise<unknown> = Promise.resolve();
  private flushing = false;
  private active = 0;
  private pending = new Map<string, QueuedEvent[]>();
  private enabled() { return this.options.enabled ?? import.meta.env?.VITE_PUSH_ENABLED === 'true'; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private update(value: Partial<PushState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()); }
  private binding(): Binding | null {
    try {
      const value = JSON.parse(localStorage.getItem(BINDING_KEY) || 'null');
      return value && /^[a-f0-9]{64}$/.test(value.owner) && /^[a-f0-9-]{36}$/.test(value.deviceId) && /^[a-f0-9-]{36}$/.test(value.secret) && typeof value.enabled === 'boolean' ? value : null;
    } catch { return null; }
  }
  private save(value: Binding) { localStorage.setItem(BINDING_KEY, JSON.stringify(value)); }
  private async request(body: Record<string, unknown>, expectedOwner = this.owner()) {
    const identity = this.identity;
    if (!identity || identity.isTestMode() || !/^[a-f0-9]{64}$/.test(expectedOwner) || identity.getProfile()?.subjectHash !== expectedOwner) throw new Error('PUSH_AUTH_REQUIRED');
    const credential = await identity.getValidAccessToken();
    if (identity.getProfile()?.subjectHash !== expectedOwner || this.owner() !== expectedOwner) throw new Error('PUSH_AUTH_REQUIRED');
    const endpoint = this.options.endpoint || pushEndpoint(import.meta.env?.VITE_AI_API_BASE_URL || '', location.origin, Capacitor.isNativePlatform());
    let response: Response;
    try { response = await (this.options.fetchFn || fetch)(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ownerHash: expectedOwner }), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25000) }); }
    catch { throw new Error('PUSH_NETWORK_ERROR'); }
    if (identity.getProfile()?.subjectHash !== expectedOwner || this.owner() !== expectedOwner) throw new Error('PUSH_AUTH_REQUIRED');
    let value: any;
    try { if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(); value = await response.json(); }
    catch { throw new Error('PUSH_NOT_CONFIGURED'); }
    if (!response.ok) throw new Error(typeof value?.error === 'string' && /^PUSH_[A-Z_]+$/.test(value.error) ? value.error : 'PUSH_UNAVAILABLE');
    return value;
  }
  private exclusive(action: () => Promise<void>) {
    const job = this.serialized.catch(() => {}).then(async () => {
      this.update({ busy: true, error: '', accepted: false });
      try { await action(); } catch (error) {
        // Only fixed support codes, never raw SDK descriptions or token details.
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        const sdkCode = code.startsWith('messaging/') ? 'PUSH_WEB_REGISTRATION_FAILED'
          : code.startsWith('installations/') ? 'PUSH_WEB_INSTALLATION_FAILED' : 'PUSH_UNAVAILABLE';
        this.update({ error: error instanceof Error && /^PUSH_[A-Z_]+$/.test(error.message) ? error.message : sdkCode });
      }
      finally { this.update({ busy: false }); }
    });
    this.serialized = job; return job;
  }
  private async adapter() {
    if (!this.platform) this.platform = await (this.options.platformFactory || createPushPlatform)(() => this.update({ lastReceived: Date.now() }), () => window.dispatchEvent(new Event('hisab-foreground')));
    return this.platform;
  }
  attach(identity: AIIdentity, owner: () => string, language: () => string) {
    this.identity = identity; this.owner = owner; this.language = language;
    const generation = ++this.active;
    const saved = this.binding();
    this.update({ enabled: saved?.enabled === true && saved.owner === owner(), error: '', accepted: false });
    if (saved?.enabled && identity.getProfile()?.subjectHash !== saved.owner) void this.disable();
    const resume = () => {
      if (generation !== this.active || document.visibilityState === 'hidden') return;
      const binding = this.binding();
      if (!binding?.enabled) this.update({ enabled: false });
      if (binding?.enabled && binding.owner === owner()) void this.register(false);
      void this.flush();
    };
    const changed = (event: StorageEvent) => { if (event.key === BINDING_KEY) resume(); };
    window.addEventListener('online', resume); window.addEventListener('focus', resume);
    window.addEventListener('storage', changed);
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => { this.active++; window.removeEventListener('online', resume); window.removeEventListener('focus', resume); window.removeEventListener('storage', changed); document.removeEventListener('visibilitychange', resume); this.platform?.dispose(); this.platform = null; };
  }
  register(prompt = true) {
    if (!prompt && this.state.busy) return Promise.resolve();
    // Request the browser permission directly from the button gesture, before
    // loading the SDK. Never prompt on resume, mount, sync or transaction save.
    const browserPermission = prompt && !Capacitor.isNativePlatform() && this.enabled() &&
      this.identity?.getProfile()?.subjectHash === this.owner() && typeof Notification !== 'undefined' && Notification.permission === 'default'
      ? Notification.requestPermission() : null;
    return this.exclusive(async () => {
      if (!this.enabled()) throw new Error('PUSH_NOT_CONFIGURED');
      const owner = this.owner();
      if (!this.identity || this.identity.isTestMode() || this.identity.getProfile()?.subjectHash !== owner || !/^[a-f0-9]{64}$/.test(owner)) throw new Error('PUSH_AUTH_REQUIRED');
      let binding = this.binding();
      if (binding && binding.owner !== owner) { await (await this.adapter()).remove(); binding = null; }
      if (!binding) binding = { owner, deviceId: crypto.randomUUID(), secret: crypto.randomUUID(), enabled: false };
      this.save(binding);
      let stage = 'PLATFORM';
      try {
        if (browserPermission && await browserPermission !== 'granted') throw new Error('PUSH_PERMISSION_DENIED');
        const adapter = await this.adapter();
        stage = 'TOKEN';
        const token = await adapter.token(prompt);
        stage = 'SERVER';
        await this.request({ action: 'register', deviceId: binding.deviceId, secret: binding.secret, token,
          platform: Capacitor.isNativePlatform() ? 'android' : 'web', language: this.language() === 'bn' ? 'bn' : 'en' }, owner);
        this.save({ ...binding, enabled: true }); this.update({ enabled: true });
      } catch (error) {
        await this.platform?.remove().catch(() => {}); this.save({ ...binding, enabled: false }); this.update({ enabled: false });
        if (error instanceof Error && /^PUSH_[A-Z_]+$/.test(error.message)) throw error;
        const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
        const category = ({ AbortError: 'ABORT', NotSupportedError: 'UNSUPPORTED', TypeError: 'TYPE', SecurityError: 'SECURITY', InvalidStateError: 'STATE' } as Record<string, string>)[name] || 'SDK';
        throw new Error(`PUSH_${stage}_${category}_FAILED`);
      }
    });
  }
  disable() {
    return this.exclusive(async () => {
      const binding = this.binding();
      if (!binding) { this.update({ enabled: false }); return; }
      this.update({ enabled: false });
      let failed = false;
      try { this.save({ ...binding, enabled: false }); } catch { failed = true; }
      try { if (binding) await this.request({ action: 'unregister', deviceId: binding.deviceId, secret: binding.secret }, binding.owner); }
      catch { failed = true; }
      try { await (await this.adapter()).remove(); } catch { failed = true; }
      if (failed) throw new Error('PUSH_DISABLE_INCOMPLETE');
    });
  }
  test() {
    return this.exclusive(async () => {
      const binding = this.binding();
      if (!binding?.enabled || binding.owner !== this.owner()) throw new Error('PUSH_DEVICE_NOT_REGISTERED');
      const result = await this.request({ action: 'test', deviceId: binding.deviceId, secret: binding.secret, eventId: crypto.randomUUID() });
      if (!result.accepted) throw new Error('PUSH_DELIVERY_UNAVAILABLE');
      this.update({ accepted: true });
    });
  }
  /** Called only after a new local journal is durable, never imports or sync. */
  committed = (id: string) => {
    const owner = this.owner();
    if (!/^[a-f0-9]{64}$/.test(owner) || !/^[a-zA-Z0-9_-]{8,128}$/.test(id)) return;
    const events = this.readEvents(owner);
    if (!events.some(value => value.id === id)) events.push({ id, at: Date.now() });
    this.writeEvents(owner, events.slice(-100));
    void this.flush();
  };
  private readEvents(owner: string): QueuedEvent[] {
    if (this.pending.has(owner)) return this.pending.get(owner)!.filter(value => value.at > Date.now() - 86400000);
    try {
      const values = JSON.parse(localStorage.getItem(`hisab_push_events_v1:${owner}`) || '[]');
      return Array.isArray(values) ? values.filter(value => value && typeof value.id === 'string' && value.at > Date.now() - 86400000).slice(-100) : [];
    } catch { return []; }
  }
  private writeEvents(owner: string, events: QueuedEvent[]) {
    this.pending.set(owner, events);
    try { localStorage.setItem(`hisab_push_events_v1:${owner}`, JSON.stringify(events)); } catch { /* Optional alerts never break journal persistence. */ }
  }
  private async flush() {
    if (this.flushing || !navigator.onLine || !this.enabled()) return;
    const owner = this.owner();
    this.flushing = true;
    try {
      for (const event of this.readEvents(owner)) {
        if (owner !== this.owner()) break;
        try { await this.request({ action: 'transaction', eventId: event.id }, owner); }
        catch { break; }
        this.writeEvents(owner, this.readEvents(owner).filter(value => value.id !== event.id));
      }
    } finally { this.flushing = false; }
  }
}
export const notificationService = new NotificationService();
