import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { type CloudAuthConfig, readCloudCallback } from './config';
import { type CloudSecretStorage, RevocableCloudStorage } from './secureStorage';

export interface VerifiedCloudIdentity { userId: string; email: string }
interface PendingSignIn { flowId: string; issuedAt: number; expectedUserId: string | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function boundedAuthFetch(projectUrl: string, delegate: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== projectUrl || !url.pathname.startsWith('/auth/v1/')) throw new Error('CLOUD_AUTH_ENDPOINT');
    const controller = new AbortController();
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 12_000);
    try { return await delegate(input, { ...init, signal: controller.signal, redirect: 'error' }); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  };
}

/** No LocalDatabase, Drive, financial upload or owner-adoption dependency is permitted here. */
export class CloudAuth {
  private client: SupabaseClient;
  private storage: RevocableCloudStorage;
  private busy = false;
  private closed = false;
  private epoch = 0;
  private expectedUserId: string | null = null;
  private constructor(private config: CloudAuthConfig, store: CloudSecretStorage, fetchFn?: typeof fetch,
    private now: () => number = Date.now) {
    this.storage = new RevocableCloudStorage(store);
    this.client = createClient(config.projectUrl, config.publishableKey, {
      auth: { storage: this.storage, storageKey: config.storageKey, flowType: 'pkce', persistSession: true,
        autoRefreshToken: false, detectSessionInUrl: false, debug: false },
      global: { fetch: boundedAuthFetch(config.projectUrl, fetchFn ?? globalThis.fetch.bind(globalThis)) }, realtime: { worker: false },
    });
  }
  static async create(config: CloudAuthConfig, store: CloudSecretStorage, options: { fetch?: typeof fetch; now?: () => number } = {}) {
    const probe = `${config.storageKey}-probe`;
    await store.setItem(probe, 'ready');
    if (await store.getItem(probe) !== 'ready') throw new Error('CLOUD_STORAGE_UNAVAILABLE');
    await store.removeItem(probe);
    return new CloudAuth(config, store, options.fetch, options.now);
  }
  private checkOpen() { if (this.closed) throw new Error('CLOUD_SESSION_CLOSED'); }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    this.checkOpen();
    if (this.busy) throw new Error('CLOUD_AUTH_BUSY');
    this.busy = true;
    try { return await work(); } finally { this.busy = false; }
  }
  private verified(user: User, sessionUserId: string, expectedUserId: string | null): VerifiedCloudIdentity {
    if (!UUID.test(user.id) || user.id !== sessionUserId || user.is_anonymous || !user.email || !user.email_confirmed_at ||
        !user.identities?.some(identity => identity.provider === 'google' && identity.user_id === user.id)) {
      throw new Error('CLOUD_IDENTITY_UNVERIFIED');
    }
    if (expectedUserId && user.id !== expectedUserId) throw new Error('CLOUD_ACCOUNT_MISMATCH');
    // Email is display-only. Never authorize or link a legacy dataset by email or user_metadata.
    return { userId: user.id, email: user.email };
  }
  async getVerifiedIdentity(expectedUserId: string | null = this.expectedUserId): Promise<VerifiedCloudIdentity | null> {
    this.checkOpen();
    const epoch = this.epoch;
    if (expectedUserId && !UUID.test(expectedUserId)) throw new Error('CLOUD_ACCOUNT_MISMATCH');
    const { data, error } = await this.client.auth.getSession();
    if (error) throw new Error('CLOUD_SESSION_UNAVAILABLE');
    if (!data.session) return null;
    // A cached getSession/user_metadata value is not a verified owner. Always ask Auth.
    const verified = await this.client.auth.getUser();
    if (verified.error || !verified.data.user) throw new Error('CLOUD_IDENTITY_UNAVAILABLE');
    const result = this.verified(verified.data.user, data.session.user.id, expectedUserId);
    if (epoch !== this.epoch || this.closed) throw new Error('CLOUD_SESSION_CLOSED');
    return result;
  }
  async beginGoogleSignIn(expectedUserId: string | null = null): Promise<string> {
    return this.exclusive(async () => {
      const epoch = this.epoch;
      if (expectedUserId && !UUID.test(expectedUserId)) throw new Error('CLOUD_ACCOUNT_MISMATCH');
      this.expectedUserId = expectedUserId;
      const current = await this.client.auth.getSession();
      if (current.error) throw new Error('CLOUD_SESSION_UNAVAILABLE');
      if (current.data.session) throw new Error('CLOUD_SIGN_OUT_FIRST');
      const savedPending = await this.storage.getItem(`${this.config.storageKey}-pending`);
      if (savedPending) {
        const pending = JSON.parse(savedPending) as PendingSignIn;
        if (this.now() - pending.issuedAt <= 600_000) throw new Error('CLOUD_SIGN_IN_IN_PROGRESS');
      }
      const { data, error } = await this.client.auth.signInWithOAuth({ provider: 'google', options: {
        redirectTo: this.config.redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' },
      } });
      if (error || !data.url || !data.flowId) throw new Error('CLOUD_SIGN_IN_UNAVAILABLE');
      const url = new URL(data.url);
      if (url.origin !== this.config.projectUrl || url.pathname !== '/auth/v1/authorize' ||
          url.searchParams.get('code_challenge_method') !== 's256') throw new Error('CLOUD_SIGN_IN_UNAVAILABLE');
      const pending: PendingSignIn = { flowId: data.flowId, issuedAt: this.now(), expectedUserId };
      await this.storage.setItem(`${this.config.storageKey}-pending`, JSON.stringify(pending));
      if (this.closed || epoch !== this.epoch) throw new Error('CLOUD_SESSION_CLOSED');
      return data.url;
    });
  }
  async handleCallback(raw: string): Promise<VerifiedCloudIdentity> {
    return this.exclusive(async () => {
      const { code } = readCloudCallback(raw, this.config.redirectTo);
      const key = `${this.config.storageKey}-pending`;
      const rawPending = await this.storage.getItem(key);
      if (!rawPending) throw new Error('CLOUD_CALLBACK_UNSOLICITED');
      const pending = JSON.parse(rawPending) as PendingSignIn;
      // Select only the verifier saved locally for this outstanding login, never URL input.
      const flowId = pending.flowId;
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(flowId)) throw new Error('CLOUD_CALLBACK_UNSOLICITED');
      const current = await this.client.auth.getSession();
      if (current.error) throw new Error('CLOUD_SESSION_UNAVAILABLE');
      if (current.data.session) throw new Error('CLOUD_SIGN_OUT_FIRST');
      await this.storage.removeItem(key); // One use, including cancelled/failed exchanges.
      if (!Number.isFinite(pending.issuedAt) || pending.issuedAt > this.now() ||
          this.now() - pending.issuedAt > 600_000) throw new Error('CLOUD_CALLBACK_EXPIRED');
      this.expectedUserId = pending.expectedUserId;
      const { error } = await this.client.auth.exchangeCodeForSession(code, { flowId });
      if (error) throw new Error('CLOUD_SIGN_IN_UNAVAILABLE');
      try {
        const result = await this.getVerifiedIdentity();
        if (!result) throw new Error('CLOUD_IDENTITY_UNVERIFIED');
        return result;
      } catch (error) {
        if (error instanceof Error && ['CLOUD_ACCOUNT_MISMATCH', 'CLOUD_IDENTITY_UNVERIFIED'].includes(error.message)) {
          await this.signOut();
        }
        throw error;
      }
    });
  }
  /** Call on foreground only after the callback listener has been registered. */
  async resume() { this.checkOpen(); await this.client.auth.startAutoRefresh(); }
  async suspend() { await this.client.auth.stopAutoRefresh(); }
  async signOut(): Promise<{ serverRevoked: boolean }> {
    if (this.closed) return { serverRevoked: false };
    this.epoch++;
    this.closed = true;
    await this.client.auth.stopAutoRefresh();
    let accessToken: string | undefined;
    try { accessToken = (await this.client.auth.getSession()).data.session?.access_token; }
    catch { /* Credential clearing still runs when the saved session is unreadable. */ }
    // Revoke first: an in-flight network response must never put a refresh token back.
    // Auth's logout API accepts this session JWT; no service-role/admin credential is used.
    const signingOut = accessToken
      ? this.client.auth.admin.signOut(accessToken, 'local')
      : Promise.resolve({ error: null });
    await this.storage.revoke();
    try { const result = await signingOut; return { serverRevoked: !result.error }; }
    catch { return { serverRevoked: false }; }
  }
}
