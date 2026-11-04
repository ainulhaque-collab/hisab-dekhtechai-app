import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudAuthConfig, NATIVE_CLOUD_CALLBACK, readCloudCallback } from '../auth/cloud/config';
import { CloudAuth } from '../auth/cloud/cloudAuth';
import { EncryptedCloudStorage, RevocableCloudStorage, type CloudSecretStorage, type EncryptedAuthRecord, type EncryptedAuthRecords } from '../auth/cloud/secureStorage';

const origin = 'https://hisab.example.invalid';
const ref = 'sfzitbasxrpmtmldujbm';
const config = cloudAuthConfig({ enabled: 'true', projectUrl: `https://${ref}.supabase.co`,
  publishableKey: 'sb_publishable_synthetic', webOrigin: origin, android: false })!;
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
class Records implements EncryptedAuthRecords {
  data = new Map<string, EncryptedAuthRecord>();
  async get(id: string) { const value = this.data.get(id); return value && structuredClone(value); }
  async put(id: string, value: EncryptedAuthRecord) { this.data.set(id, structuredClone(value)); }
  async remove(id: string) { this.data.delete(id); }
  async clearPrefix(prefix: string) { for (const key of this.data.keys()) if (key.startsWith(prefix)) this.data.delete(key); }
}
function user(id = a) {
  return { id, email: 'synthetic@example.invalid', email_confirmed_at: '2026-10-29T00:00:00Z',
    app_metadata: { provider: 'google' }, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-29T00:00:00Z',
    identities: [{ id: 'synthetic-google-subject', identity_id: a, user_id: id, provider: 'google', identity_data: {} }] };
}
function environment() {
  const records = new Records(), storage = new EncryptedCloudStorage(config.storageKey, origin, records);
  let id = a, userUnavailable = false, logoutUnavailable = false, now = Date.now(), forgedMetadata = false;
  let tokenGate: Promise<void> | null = null, tokenEntered: (() => void) | null = null;
  let challenge = '', refreshes = 0, tokenCalls = 0, userCalls = 0, logoutCalls = 0;
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, config.projectUrl);
    if (url.pathname === '/auth/v1/token') {
      tokenCalls++;
      tokenEntered?.(); if (tokenGate) await tokenGate;
      const body = JSON.parse(init!.body as string);
      if (url.searchParams.get('grant_type') === 'pkce') {
        assert.equal(body.auth_code, 'synthetic-code-12345');
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.code_verifier));
        assert.equal(Buffer.from(hash).toString('base64url'), challenge, 'real SDK submits the matching PKCE verifier');
      } else {
        assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
        assert.equal(body.refresh_token, 'synthetic-refresh'); refreshes++;
      }
      const jwt = [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url'), 'synthetic'].join('.');
      return Response.json({ access_token: jwt, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, user: user(id) });
    }
    if (url.pathname === '/auth/v1/user') {
      userCalls++; if (userUnavailable) return Response.json({ message: 'temporary' }, { status: 400 });
      const value = user(id);
      if (forgedMetadata) { value.identities = []; value.user_metadata = { provider: 'google', email_verified: true }; }
      return Response.json(value);
    }
    if (url.pathname === '/auth/v1/logout') {
      logoutCalls++; assert.equal(url.searchParams.get('scope'), 'local');
      return logoutUnavailable ? Response.json({ message: 'temporary' }, { status: 400 }) : new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected synthetic Auth request: ${url.pathname}`);
  };
  const make = (override: CloudSecretStorage = storage) => CloudAuth.create(config, override, { fetch: fetchFn, now: () => now });
  const start = async (auth: CloudAuth, expected: string | null = null) => {
    const url = new URL(await auth.beginGoogleSignIn(expected));
    assert.equal(url.searchParams.get('provider'), 'google');
    assert.equal(url.searchParams.get('code_challenge_method'), 's256');
    challenge = url.searchParams.get('code_challenge')!;
    const callback = new URL(url.searchParams.get('redirect_to')!);
    assert.equal(callback.origin + callback.pathname, config.redirectTo);
    assert.equal(callback.search, '', 'exact hosted allowlist requires a redirect without SDK experimental query parameters');
    callback.searchParams.set('code', 'synthetic-code-12345');
    return callback.href;
  };
  return { records, storage, make, start, setId: (value: string) => { id = value; },
    setUserUnavailable: (value: boolean) => { userUnavailable = value; },
    setLogoutUnavailable: () => { logoutUnavailable = true; }, advance: () => { now += 600_001; },
    forgeMetadata: () => { forgedMetadata = true; },
    holdToken: () => {
      let release!: () => void;
      tokenGate = new Promise<void>(resolve => { release = resolve; });
      const entered = new Promise<void>(resolve => { tokenEntered = resolve; });
      return { release, entered };
    },
    counts: () => ({ tokenCalls, userCalls, logoutCalls, refreshes }) };
}

test('Cloud rollout is explicit and rejects secret keys, foreign projects and unsafe origins', () => {
  assert.equal(cloudAuthConfig({ webOrigin: origin, android: false }), null);
  for (const patch of [{ publishableKey: 'sb_secret_wrong' }, { publishableKey: 'eyJ.legacy.jwt' },
    { projectUrl: 'https://attacker.example.invalid' }, { webOrigin: 'http://192.168.1.108:3000' },
    { webOrigin: `${origin}/auth/callback` }]) {
    assert.throws(() => cloudAuthConfig({ enabled: 'true', projectUrl: config.projectUrl,
      publishableKey: config.publishableKey, webOrigin: origin, android: false, ...patch }));
  }
});

test('Cloud callback only accepts exact Web/native endpoints and one authorization code', () => {
  const query = '?code=synthetic-code-12345';
  assert.deepEqual(readCloudCallback(config.redirectTo + query, config.redirectTo), { code: 'synthetic-code-12345' });
  assert.ok(readCloudCallback(NATIVE_CLOUD_CALLBACK + query, NATIVE_CLOUD_CALLBACK));
  for (const raw of [origin + query, 'https://attacker.example.invalid/auth/callback' + query,
    config.redirectTo + query + '&code=another-code', config.redirectTo + query + '#access_token=secret',
    config.redirectTo + query + '&sb_flow_id=untrusted-selector', NATIVE_CLOUD_CALLBACK + '/extra' + query]) {
    assert.throws(() => readCloudCallback(raw, config.redirectTo));
  }
});

test('Encrypted cloud credentials survive a new storage instance without plaintext or extractable keys', async () => {
  const env = environment();
  await env.storage.setItem(config.storageKey, 'synthetic-refresh-secret');
  const record = [...env.records.data.values()][0]; assert.equal(record.key.extractable, false);
  assert.ok(!Buffer.from(record.ciphertext).includes(Buffer.from('synthetic-refresh-secret')));
  const fresh = new EncryptedCloudStorage(config.storageKey, origin, env.records);
  assert.equal(await fresh.getItem(config.storageKey), 'synthetic-refresh-secret');
  await env.storage.clear(); assert.equal(await fresh.getItem(config.storageKey), null);
});

test('Tampered ciphertext and origin/key swaps fail closed; unrelated credential namespaces survive logout', async () => {
  const env = environment(); await env.storage.setItem(config.storageKey, 'secret');
  const id = [...env.records.data.keys()][0], record = env.records.data.get(id)!;
  new Uint8Array(record.ciphertext)[0] ^= 1;
  await assert.rejects(env.storage.getItem(config.storageKey), /CLOUD_STORAGE_INVALID/);
  await env.storage.setItem(config.storageKey, 'secret');
  const next = env.records.data.get(id)!;
  env.records.data.set(id.replace(origin, 'https://other.example.invalid'), structuredClone(next));
  const other = new EncryptedCloudStorage(config.storageKey, 'https://other.example.invalid', env.records);
  await assert.rejects(other.getItem(config.storageKey), /CLOUD_STORAGE_INVALID/);
  env.records.data.set('unrelated-application', structuredClone(next));
  await env.storage.clear(); assert.ok(env.records.data.has('unrelated-application'));
});

test('Real pinned SDK completes S256 PKCE, verifies Auth HTTP user and refuses duplicate callbacks', async () => {
  const env = environment(), auth = await env.make();
  const callback = await env.start(auth);
  assert.deepEqual(await auth.handleCallback(callback), { userId: a, email: 'synthetic@example.invalid' });
  assert.deepEqual(env.counts(), { tokenCalls: 1, userCalls: 1, logoutCalls: 0, refreshes: 0 });
  await assert.rejects(auth.handleCallback(callback), /CLOUD_CALLBACK_UNSOLICITED/);
  assert.equal(env.counts().tokenCalls, 1);
  await assert.rejects(auth.beginGoogleSignIn(), /CLOUD_SIGN_OUT_FIRST/);
  await auth.signOut(); assert.equal(env.counts().logoutCalls, 1);
});

test('Reload re-verifies the owner over HTTP; temporary verification failure retains encrypted credentials', async () => {
  const env = environment(), auth = await env.make(); await auth.handleCallback(await env.start(auth));
  const restarted = await env.make(); env.setUserUnavailable(true);
  await assert.rejects(restarted.getVerifiedIdentity(), /CLOUD_IDENTITY_UNAVAILABLE/);
  assert.ok(await env.storage.getItem(config.storageKey));
  env.setUserUnavailable(false); assert.equal((await restarted.getVerifiedIdentity())?.userId, a);
  assert.equal(env.counts().userCalls, 3); await restarted.signOut();
});

test('Different-account callback is rejected and signed out without any financial adoption', async () => {
  const env = environment(), auth = await env.make(); const callback = await env.start(auth, a);
  env.setId(b); await assert.rejects(auth.handleCallback(callback), /CLOUD_ACCOUNT_MISMATCH/);
  assert.equal(await env.storage.getItem(config.storageKey), null);
  await assert.rejects(auth.getVerifiedIdentity(), /CLOUD_SESSION_CLOSED/);
});

test('Only one outstanding login is allowed; expired and unsolicited callbacks cannot exchange codes', async () => {
  const env = environment(), auth = await env.make(), current = await env.start(auth);
  await assert.rejects(env.start(auth), /CLOUD_SIGN_IN_IN_PROGRESS/);
  env.advance(); await assert.rejects(auth.handleCallback(current), /CLOUD_CALLBACK_EXPIRED/);
  await assert.rejects(auth.handleCallback(current), /CLOUD_CALLBACK_UNSOLICITED/);
  assert.equal(env.counts().tokenCalls, 0); await auth.signOut();
});

test('Local logout erases credentials and PKCE state even when server revocation is unavailable', async () => {
  const env = environment(), auth = await env.make(); await auth.handleCallback(await env.start(auth));
  env.setLogoutUnavailable(); assert.equal((await auth.signOut()).serverRevoked, false);
  assert.equal(env.records.data.size, 0);
  assert.equal(await (await env.make()).getVerifiedIdentity(), null);
});

test('Expired stored access token refreshes through SDK and is verified before returning an owner', async () => {
  const env = environment(), auth = await env.make(); await auth.handleCallback(await env.start(auth));
  const session = JSON.parse((await env.storage.getItem(config.storageKey))!);
  session.expires_at = 1; await env.storage.setItem(config.storageKey, JSON.stringify(session));
  const restarted = await env.make(); assert.equal((await restarted.getVerifiedIdentity())?.userId, a);
  assert.equal(env.counts().refreshes, 1); await restarted.signOut();
});

test('Secure storage failure stops initialization without an insecure memory/localStorage fallback', async () => {
  await assert.rejects(CloudAuth.create(config, { getItem: async () => null,
    setItem: async () => { throw new Error('denied'); }, removeItem: async () => {}, clear: async () => {} }), /denied/);
});

test('User-editable metadata cannot substitute for a server-confirmed Google identity', async () => {
  const env = environment(), auth = await env.make(); env.forgeMetadata();
  await assert.rejects(auth.handleCallback(await env.start(auth)), /CLOUD_IDENTITY_UNVERIFIED/);
  assert.equal(env.records.data.size, 0);
});

test('Concurrent owner verification keeps each caller’s expected UUID instead of sharing mutable identity', async () => {
  const env = environment(), auth = await env.make(); await auth.handleCallback(await env.start(auth));
  const result = await Promise.allSettled([auth.getVerifiedIdentity(b), auth.getVerifiedIdentity(a)]);
  assert.equal(result[0].status, 'rejected'); assert.equal(result[1].status, 'fulfilled');
  if (result[0].status === 'rejected') assert.match(result[0].reason.message, /CLOUD_ACCOUNT_MISMATCH/);
  await auth.signOut();
});

test('A late token response cannot restore credentials after local logout', async () => {
  const env = environment(), auth = await env.make(), callback = await env.start(auth), gate = env.holdToken();
  const callbackResult = auth.handleCallback(callback).then(() => null, error => error);
  await gate.entered; await auth.signOut(); gate.release();
  assert.match((await callbackResult).message, /CLOUD_SESSION_CLOSED/);
  assert.equal(env.records.data.size, 0);
  assert.equal(await (await env.make()).getVerifiedIdentity(), null);
});

test('Revocation waits for an already-dispatched native storage write before clearing credentials', async () => {
  let value: string | null = null, release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const storage = new RevocableCloudStorage({ getItem: async () => value,
    setItem: async (_key, next) => { entered(); await gate; value = next; },
    removeItem: async () => { value = null; }, clear: async () => { value = null; } });
  const write = storage.setItem('synthetic-key', 'synthetic-secret'); await started;
  const revocation = storage.revoke(); release(); await write; await revocation;
  assert.equal(value, null); assert.equal(await storage.getItem('synthetic-key'), null);
  await assert.rejects(storage.setItem('synthetic-key', 'late-secret'), /CLOUD_SESSION_CLOSED/);
});

test('A failed local credential erase can be retried without resurrecting a closed Auth client', async () => {
  const env = environment(); let deny = true;
  const auth = await env.make({ getItem: key => env.storage.getItem(key), setItem: (key,value) => env.storage.setItem(key,value),
    removeItem: key => env.storage.removeItem(key), clear: async () => { if (deny) throw new Error('storage denied'); await env.storage.clear(); } });
  await auth.handleCallback(await env.start(auth)); await assert.rejects(auth.signOut(), /storage denied/);
  assert.ok(await env.storage.getItem(config.storageKey)); deny = false;
  await auth.signOut(); assert.equal(env.records.data.size, 0);
  await assert.rejects(auth.getVerifiedIdentity(), /CLOUD_SESSION_CLOSED/);
});
