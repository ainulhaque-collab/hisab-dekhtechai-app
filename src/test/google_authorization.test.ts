import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAuthManager, computeOwnerSubjectHash } from '../auth/googleAuth';
import { WorkspaceMediaStore } from '../storage/workspaceMedia';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { RealGoogleDriveTransport } from '../drive/transport';

test('BUG-011: real GIS callback requires Drive consent and verifies the Google subject before storing a token', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let grantedScope = 'openid email profile';
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { google: { accounts: { oauth2: {
    initTokenClient: (config: any) => ({ requestAccessToken: () => { config.callback({ access_token: 'mock-gis-token', scope: grantedScope, expires_in: 3600 }); } }),
  } } } } });
  try {
    const auth = new GoogleAuthManager(); let lookups = 0;
    auth.fetchFn = async () => { lookups++; return new Response(JSON.stringify({ sub: 'qa-gis-owner', name: 'QA', email: 'qa@example.invalid' })); };
    await assert.rejects(auth.promptGoogleSignIn(), /permission is required/);
    assert.equal(lookups, 0); assert.equal(auth.isRealGoogleAuthenticated(), false);
    grantedScope += ' https://www.googleapis.com/auth/drive.appdata';
    const user = await auth.promptGoogleSignIn();
    assert.equal(user.subjectHash, await computeOwnerSubjectHash('qa-gis-owner'));
    assert.equal(auth.isRealGoogleAuthenticated(), true);
  } finally { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('FEAT-009: offline images are isolated until explicitly claimed after verified first-owner binding', async () => {
  const store = new WorkspaceMediaStore(new LocalStorageFallbackDriver());
  await store.save('offline-workspace', 'local-owner', 'data:image/jpeg;base64,YQ==');
  assert.equal(await store.get('offline-workspace', 'verified-owner'), null);
  await store.claimOfflineAssets(['offline-workspace'], 'verified-owner');
  assert.equal(await store.get('offline-workspace', 'verified-owner'), 'data:image/jpeg;base64,YQ==');
  assert.equal(await store.get('offline-workspace', 'another-owner'), null);
  await store.claimOfflineAssets(['offline-workspace'], 'another-owner');
  assert.equal(await store.get('offline-workspace', 'another-owner'), null);
});

test('BUG-011: quota endpoint errors are propagated, never replaced with a fabricated quota', async () => {
  const transport = new RealGoogleDriveTransport('mock', { customFetch: async () => new Response('No permission', { status: 403 }), initialRetryDelayMs: 0 });
  await assert.rejects(transport.getQuotaStatus(), /403 Forbidden/);
});
