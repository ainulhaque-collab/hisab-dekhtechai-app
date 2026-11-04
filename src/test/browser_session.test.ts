import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserTokenSession, SessionKeyStore } from '../auth/browserSession';
import { GoogleAuthManager } from '../auth/googleAuth';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import { SyncOrchestrator } from '../sync/orchestrator';

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
class MemoryKeys implements SessionKeyStore {
  data = new Map<string, CryptoKey>();
  async get(id: string) { return this.data.has(id) ? structuredClone(this.data.get(id)!) : null; }
  async put(id: string, key: CryptoKey) { assert.equal(key.extractable, false); this.data.set(id, structuredClone(key)); }
  async remove(id: string) { this.data.delete(id); }
}
const ORIGIN = 'http://localhost:3000';
function environment(t: TestContext) {
  const storage = new MemoryStorage(), keys = new MemoryKeys(), publicStorage = new MemoryStorage();
  let popups = 0;
  for (const [name, value] of Object.entries({ localStorage: publicStorage, window: {
    location: { protocol: 'http:', hostname: 'localhost', origin: ORIGIN },
    google: { accounts: { oauth2: { initTokenClient: (config: any) => ({ requestAccessToken: () => {
      popups++; void config.callback({ access_token: 'synthetic-reload-token', expires_in: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.appdata' });
    } }) } } },
  } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name); });
  }
  const make = () => {
    const auth = new GoogleAuthManager(new BrowserTokenSession({ storage, keys, origin: ORIGIN }));
    auth.fetchFn = async () => Response.json({ sub: 'qa-reload-owner', name: 'QA', email: 'qa@example.invalid' });
    return auth;
  };
  return { make, storage, keys, publicStorage, popups: () => popups };
}

test('A new auth instance restores a verified same-tab session after reload without another Google popup', async t => {
  const env = environment(t), first = env.make(); await first.promptGoogleSignIn();
  assert.equal(env.popups(), 1);
  assert.ok(!JSON.stringify([...env.publicStorage.data]).includes('synthetic-reload-token'));
  assert.ok(!JSON.stringify([...env.storage.data]).includes('synthetic-reload-token'));
  assert.equal(env.keys.data.size, 1);
  const reloaded = env.make(); assert.equal(reloaded.getProfile()?.accessToken, undefined);
  let verifications = 0; reloaded.fetchFn = async () => { verifications++; return Response.json({ sub: 'qa-reload-owner' }); };
  const tokens = await Promise.all([reloaded.getValidAccessToken(), reloaded.getValidAccessToken()]);
  assert.deepEqual(tokens, ['synthetic-reload-token', 'synthetic-reload-token']);
  assert.equal(verifications, 1); assert.equal(reloaded.isRealGoogleAuthenticated(), true); assert.equal(reloaded.isDriveAuthorized(), true);
  assert.equal(env.popups(), 1);
});

test('AES-GCM session rejects tampering, different origins, OAuth clients, owners and expired tokens', async () => {
  const storage = new MemoryStorage(), keys = new MemoryKeys(); let now = Date.now();
  const make = (origin = ORIGIN) => new BrowserTokenSession({ storage, keys, origin, now: () => now });
  const session = { accessToken: 'synthetic-session', tokenExpiresAt: now + 3600_000 };
  for (const read of [() => make().read('other-owner', 'client'), () => make().read('owner', 'other-client'),
    () => make('https://example.invalid').read('owner', 'client'), async () => {
      const key = storage.key(0)!, record = JSON.parse(storage.getItem(key)!); record.ciphertext[0] ^= 1;
      storage.setItem(key, JSON.stringify(record)); return make().read('owner', 'client');
    }]) {
    await make().save(session, 'owner', 'client'); assert.equal(await read(), null); assert.equal(storage.length, 0);
  }
  await make().save(session, 'owner', 'client'); now = session.tokenExpiresAt;
  assert.equal(await make().read('owner', 'client'), null); assert.equal(storage.length, 0);
});

test('A restored token with a different verified Google subject is refused and removed', async t => {
  const env = environment(t); await env.make().promptGoogleSignIn();
  const reloaded = env.make(); reloaded.fetchFn = async () => Response.json({ sub: 'another-google-owner' });
  await assert.rejects(reloaded.getValidAccessToken(), /owner does not match/);
  assert.equal(reloaded.isRealGoogleAuthenticated(), false); assert.equal(env.storage.length, 0);
});

test('Revoked Google sessions cannot return after reload or a forced HTTP 401 renewal', async t => {
  const env = environment(t); await env.make().promptGoogleSignIn();
  const rejected = env.make(); rejected.fetchFn = async () => new Response('', { status: 401 });
  await assert.rejects(rejected.getValidAccessToken(), /AUTH_REQUIRED/); assert.equal(env.storage.length, 0);
  const fresh = env.make(); await fresh.promptGoogleSignIn();
  await assert.rejects(fresh.getValidAccessToken(true), /AUTH_REQUIRED/); assert.equal(env.storage.length, 0);
  await assert.rejects(env.make().getValidAccessToken(), /AUTH_REQUIRED/); assert.equal(env.popups(), 2);
});

test('Sign out during restore cannot resurrect the session; consent revocation clears recovery too', async t => {
  const env = environment(t); await env.make().promptGoogleSignIn(); const reloaded = env.make();
  let started!: () => void, finish!: (response: Response) => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  reloaded.fetchFn = async () => { started(); return new Promise<Response>(resolve => { finish = resolve; }); };
  const pending = reloaded.getValidAccessToken(); await requestStarted; reloaded.signOut(); finish(Response.json({ sub: 'qa-reload-owner' }));
  await assert.rejects(pending, /AUTH_REQUIRED/); assert.equal(reloaded.getProfile(), null); assert.equal(env.storage.length, 0);
  const fresh = env.make(); await fresh.promptGoogleSignIn(); fresh.revokeDriveConsent();
  assert.equal(env.storage.length, 0); await assert.rejects(env.make().getValidAccessToken(), /AUTH_REQUIRED/);
});

test('Temporary Google/network verification failure preserves the encrypted session for a later retry', async t => {
  const env = environment(t); await env.make().promptGoogleSignIn(); const reloaded = env.make();
  reloaded.fetchFn = async () => { throw new Error('network unavailable'); };
  await assert.rejects(reloaded.getValidAccessToken(), /network unavailable/); assert.equal(env.storage.length, 1);
  reloaded.fetchFn = async () => Response.json({ sub: 'qa-reload-owner' });
  assert.equal(await reloaded.getValidAccessToken(), 'synthetic-reload-token'); assert.equal(env.popups(), 1);
});

test('Session storage or key-store failures keep real Google sign-in usable in memory', async t => {
  const env = environment(t);
  const broken: SessionKeyStore = { get: async () => { throw new Error('Unavailable'); }, put: async () => { throw new Error('Unavailable'); }, remove: async () => {} };
  const auth = new GoogleAuthManager(new BrowserTokenSession({ storage: env.storage, keys: broken, origin: ORIGIN }));
  auth.fetchFn = async () => Response.json({ sub: 'qa-reload-owner' }); await auth.promptGoogleSignIn();
  assert.equal(await auth.getValidAccessToken(), 'synthetic-reload-token'); assert.equal(env.storage.length, 0);
});

test('Reload keeps the last verified sync time while current connection still requires real authorization', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud(); const driver = new LocalStorageFallbackDriver();
  const key = `reload-sync-${crypto.randomUUID()}`, db = new LocalDatabase(key, driver); await db.init();
  db.setIdentity('qa-owner'); const transport = new SimulatedGoogleDriveTransport(), sync = new SyncOrchestrator(db, transport);
  await sync.triggerSync(); const at = sync.getStatus().lastSuccessfulSyncAt; assert.ok(at);
  const restarted = new LocalDatabase(key, driver); await restarted.init(); const next = new SyncOrchestrator(restarted, transport);
  next.setAuthorized(false); assert.equal(next.getStatus().lastSuccessfulSyncAt, at); assert.equal(next.getStatus().state, 'auth_required');
  restarted.getRawState().localIdentity!.ownerSubjectHash = 'different-owner'; assert.equal(next.getStatus().lastSuccessfulSyncAt, null);
});
