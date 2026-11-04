import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { CustomerAccount, CustomerAccountChanges, CustomerChangeResult, PendingCustomerChange } from '../../contracts/customerAccount';
import { customerPhone, customerUuid, customerEmail } from '../customerIdentity';
import { readCloudCallback, type CloudAuthConfig } from './config';
import type { CloudSecretStorage } from './secureStorage';

type Pending = { customerId: string; issuedAt: number } & (
  { kind: 'phone'; phone: string } |
  { kind: 'email'; email: string } |
  { kind: 'google'; flowId: string; identityIds: string[] }
);
type AuthCalls = Pick<SupabaseClient['auth'], 'updateUser' | 'verifyOtp' | 'linkIdentity' | 'exchangeCodeForSession' | 'unlinkIdentity'>;

/** Same authenticated customer throughout a change. This class cannot access financial data. */
export class SupabaseCustomerChanges implements CustomerAccountChanges {
  private readonly pendingKey: string;
  constructor(private deps: {
    customerId: string; config: CloudAuthConfig; auth: AuthCalls; storage: CloudSecretStorage;
    exclusive: <T>(work: () => Promise<T>) => Promise<T>; assertOpen: () => void;
    readVerified: () => Promise<{ user: User; account: CustomerAccount }>;
    signOut: () => Promise<unknown>; now: () => number; phoneChangeEnabled: boolean;
  }) {
    if (!customerUuid(deps.customerId)) throw Error('CLOUD_ACCOUNT_MISMATCH');
    this.pendingKey = deps.config.storageKey + '-account-change';
  }
  private async account(): Promise<{ user: User; account: CustomerAccount }> {
    this.deps.assertOpen();
    const result = await this.deps.readVerified();
    if (result.account.customerId !== this.deps.customerId) throw Error('CLOUD_ACCOUNT_MISMATCH');
    this.deps.assertOpen(); return result;
  }
  async readAccount(): Promise<CustomerAccount> { return (await this.account()).account; }
  /** Display-only pending status; no credentials/PKCE selectors leave the Auth layer. */
  async readPendingChange(): Promise<PendingCustomerChange | null> {
    this.deps.assertOpen();
    const raw = await this.deps.storage.getItem(this.pendingKey); if (!raw) return null;
    let p: Pending;
    try { p = JSON.parse(raw); } catch { throw Error('CUSTOMER_CHANGE_INVALID'); }
    if (p?.customerId !== this.deps.customerId || !['email','phone','google'].includes(p.kind) || !Number.isFinite(p.issuedAt)) throw Error('CUSTOMER_CHANGE_INVALID');
    const target = p.kind === 'phone' ? customerPhone(p.phone) : p.kind === 'email' ? customerEmail(p.email) : null;
    return Object.freeze({kind:p.kind,target,expired:p.issuedAt>this.deps.now()||this.deps.now()-p.issuedAt>600_000});
  }
  private async pending(kind?: Pending['kind']): Promise<Pending | null> {
    const raw = await this.deps.storage.getItem(this.pendingKey);
    if (!raw) return null;
    let p: Pending;
    try { p = JSON.parse(raw); } catch { throw Error('CUSTOMER_CHANGE_INVALID'); }
    if (p?.customerId !== this.deps.customerId || !Number.isFinite(p.issuedAt) || p.issuedAt > this.deps.now() ||
        this.deps.now() - p.issuedAt > 600_000) throw Error('CUSTOMER_CHANGE_EXPIRED');
    if (!['phone', 'email', 'google'].includes(p.kind) || (kind && p.kind !== kind)) throw Error('CUSTOMER_CHANGE_INVALID');
    return p;
  }
  private async prepare(): Promise<{ user: User; account: CustomerAccount }> {
    const current = await this.account();
    const signedIn = Date.parse(current.user.last_sign_in_at ?? '');
    if (!Number.isFinite(signedIn) || signedIn > this.deps.now() || this.deps.now() - signedIn > 600_000)
      throw Error('CUSTOMER_REAUTH_REQUIRED');
    if (await this.deps.storage.getItem(this.pendingKey)) throw Error('CUSTOMER_CHANGE_IN_PROGRESS');
    return current;
  }
  private async sameCustomer(user: User | null): Promise<void> {
    if (!user || user.id !== this.deps.customerId) {
      await this.deps.signOut(); throw Error('CLOUD_ACCOUNT_MISMATCH');
    }
    this.deps.assertOpen();
  }
  requestEmailChange(raw: string): Promise<CustomerChangeResult> {
    return this.deps.exclusive(async () => {
      const email = customerEmail(raw), { account } = await this.prepare();
      if (account.email && customerEmail(account.email) === email) return { status: 'verified', account };
      const pending: Pending = { kind: 'email', email, customerId: account.customerId, issuedAt: this.deps.now() };
      await this.deps.storage.setItem(this.pendingKey, JSON.stringify(pending));
      const { data, error } = await this.deps.auth.updateUser({ email }, { emailRedirectTo: this.deps.config.redirectTo });
      if (error) throw Error('CUSTOMER_CHANGE_UNAVAILABLE');
      await this.sameCustomer(data.user);
      return { status: 'pending_verification', account: (await this.account()).account };
    });
  }
  /** Call after Auth's email confirmation links; a callback URL is never proof of ownership. */
  checkEmailChange(): Promise<CustomerChangeResult> {
    return this.deps.exclusive(async () => {
      const p = await this.pending('email'); if (!p || p.kind !== 'email' || customerEmail(p.email) !== p.email) throw Error('CUSTOMER_CHANGE_INVALID');
      const { account } = await this.account();
      if (!account.email || customerEmail(account.email) !== p.email) return { status: 'pending_verification', account };
      await this.deps.storage.removeItem(this.pendingKey);return { status: 'verified', account };
    });
  }
  requestPhoneChange(raw: string): Promise<CustomerChangeResult> {
    return this.deps.exclusive(async () => {
      const phone = customerPhone(raw);
      if (!this.deps.phoneChangeEnabled) throw Error('CUSTOMER_SMS_NOT_CONFIGURED');
      const { account } = await this.prepare();
      if (account.phone === phone) return { status: 'verified', account };
      const pending: Pending = { kind: 'phone', phone, customerId: account.customerId, issuedAt: this.deps.now() };
      // Persist before requesting: a lost response/restart must not lose the expected owner/target.
      await this.deps.storage.setItem(this.pendingKey, JSON.stringify(pending));
      const { data, error } = await this.deps.auth.updateUser({ phone });
      if (error) throw Error('CUSTOMER_CHANGE_UNAVAILABLE');
      await this.sameCustomer(data.user);
      const after = await this.account();
      // A PUT response alone never proves that this new number has been verified.
      return { status: 'pending_verification', account: after.account };
    });
  }
  confirmPhoneChange(otp: string): Promise<CustomerChangeResult> {
    return this.deps.exclusive(async () => {
      if (!/^[0-9]{6,8}$/.test(otp)) throw Error('CUSTOMER_OTP_INVALID');
      const p = await this.pending('phone'); if (!p || p.kind !== 'phone') throw Error('CUSTOMER_CHANGE_INVALID');
      if (customerPhone(p.phone) !== p.phone) throw Error('CUSTOMER_CHANGE_INVALID');
      await this.account();
      const { data, error } = await this.deps.auth.verifyOtp({ phone: p.phone, token: otp, type: 'phone_change' });
      if (error) throw Error('CUSTOMER_OTP_INVALID');
      await this.sameCustomer(data.user);
      const after = await this.account();
      if (after.account.phone !== p.phone) throw Error('CUSTOMER_CHANGE_UNVERIFIED');
      await this.deps.storage.removeItem(this.pendingKey);
      return { status: 'verified', account: after.account };
    });
  }
  beginGoogleLink(): Promise<string> {
    return this.deps.exclusive(async () => {
      const { account } = await this.prepare();
      const { data, error } = await this.deps.auth.linkIdentity({ provider: 'google', options: {
        redirectTo: this.deps.config.redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' },
      } });
      if (error || !data.url || !data.flowId || !/^[A-Za-z0-9_-]{8,64}$/.test(data.flowId)) throw Error('CUSTOMER_LINK_UNAVAILABLE');
      const url = new URL(data.url), redirect = url.searchParams.get('redirect_uri');
      if (url.origin !== 'https://accounts.google.com' || !['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname) ||
          url.username || url.password || url.hash || redirect !== this.deps.config.projectUrl + '/auth/v1/callback' ||
          url.searchParams.get('response_type') !== 'code') throw Error('CUSTOMER_LINK_UNAVAILABLE');
      await this.account(); // Fence a concurrent logout/account switch before saving callback state.
      const pending: Pending = { kind: 'google', flowId: data.flowId, customerId: account.customerId,
        issuedAt: this.deps.now(), identityIds: account.googleIdentities.map(identity => identity.identityId) };
      await this.deps.storage.setItem(this.pendingKey, JSON.stringify(pending));
      this.deps.assertOpen(); return url.href;
    });
  }
  completeGoogleLink(raw: string): Promise<CustomerChangeResult> {
    return this.deps.exclusive(async () => {
      const p = await this.pending('google'); if (!p || p.kind !== 'google') throw Error('CUSTOMER_CHANGE_INVALID');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.flowId) || !Array.isArray(p.identityIds) || p.identityIds.some(id => !customerUuid(id)))
        throw Error('CUSTOMER_CHANGE_INVALID');
      // One use, including a cancellation, wrong callback, or failed exchange.
      await this.deps.storage.removeItem(this.pendingKey);
      const { code } = readCloudCallback(raw, this.deps.config.redirectTo);
      await this.account();
      const { data, error } = await this.deps.auth.exchangeCodeForSession(code, { flowId: p.flowId });
      if (error) throw Error('CUSTOMER_LINK_UNAVAILABLE');
      await this.sameCustomer(data.user);
      const after = await this.account();
      const added = after.account.googleIdentities.some(identity => !p.identityIds.includes(identity.identityId));
      if (after.account.googleIdentities.length === 0) throw Error('CUSTOMER_CHANGE_UNVERIFIED');
      return { status: added ? 'verified' : 'already_linked', account: after.account };
    });
  }
  removeGoogleIdentity(identityId: string): Promise<CustomerAccount> {
    return this.deps.exclusive(async () => {
      if (!customerUuid(identityId)) throw Error('CUSTOMER_IDENTITY_INVALID');
      const { user, account } = await this.prepare();
      const identity = user.identities?.find(value => value.identity_id === identityId && value.user_id === account.customerId && value.provider === 'google');
      if (!identity) throw Error('CUSTOMER_IDENTITY_INVALID');
      // Require another linked Google sign-in; an unconfigured email/phone channel is not a recovery guarantee.
      if (!account.googleIdentities.some(value => value.identityId !== identityId)) throw Error('CUSTOMER_LAST_SIGN_IN_METHOD');
      if (!account.email || !account.googleIdentities.some(value => value.identityId !== identityId && value.email && customerEmail(value.email) === customerEmail(account.email!)))
        throw Error('CUSTOMER_PRIMARY_EMAIL_CHANGE_REQUIRED');
      const { error } = await this.deps.auth.unlinkIdentity(identity);
      if (error) throw Error('CUSTOMER_CHANGE_UNAVAILABLE');
      const after = await this.account();
      if (after.account.googleIdentities.some(value => value.identityId === identityId)) throw Error('CUSTOMER_CHANGE_UNVERIFIED');
      return after.account;
    });
  }
  cancelPendingChange(): Promise<void> {
    return this.deps.exclusive(async () => { await this.account(); await this.deps.storage.removeItem(this.pendingKey); });
  }
}
