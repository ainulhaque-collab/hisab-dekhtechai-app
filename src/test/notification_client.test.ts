import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationService } from '../notifications/service';
import { firebaseWebConfig, pushEndpoint } from '../notifications/config';

test('notification endpoint requires a trusted HTTPS origin on Android; client config rejects foreign projects/private extras', () => {
  assert.throws(() => pushEndpoint('', 'https://localhost', true), /NOT_CONFIGURED/);
  for (const base of ['http://remote.example', 'https://remote.example/path', 'https://user:secret@remote.example', 'https://remote.example/?key=x'])
    assert.throws(() => pushEndpoint(base, 'https://localhost', true), /NOT_CONFIGURED/);
  assert.equal(pushEndpoint('https://approved.example', 'https://localhost', true), 'https://approved.example/api/notifications/push');
  assert.equal(pushEndpoint('', 'http://localhost:3000', false), 'http://localhost:3000/api/notifications/push');
  const config = { apiKey: `AIza${'x'.repeat(35)}`, projectId: 'hisab-dekhtechai-notifications', messagingSenderId: '706081957087', appId: '1:706081957087:web:2966864dcc99f41b77356a' };
  assert.equal(firebaseWebConfig(JSON.stringify(config)).projectId, config.projectId);
  for (const value of [{ ...config, projectId: 'foreign' }, { ...config, private_key: 'secret' }]) assert.throws(() => firebaseWebConfig(JSON.stringify(value)), /NOT_CONFIGURED/);
});

test('enable, silent resume, owner-change race and disable keep device registration separate from financial data', async t => {
  const restore = new Map<string, PropertyDescriptor | undefined>();
  const storage = new Map<string, string>();
  const install = (key: string, value: unknown) => { restore.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); };
  const windowTarget = new EventTarget(), documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  install('window', windowTarget); install('document', documentTarget); install('navigator', { onLine: true });
  install('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) });
  t.after(() => { for (const [key, descriptor] of restore) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; } });
  const owner = 'a'.repeat(64); let profile = owner; const prompts: boolean[] = []; const requests: any[] = []; let removed = 0;
  const identity = { isTestMode: () => false, getProfile: () => profile ? { subjectHash: profile } : null, getValidAccessToken: async () => 'synthetic-auth' };
  const service = new NotificationService({ enabled: true, endpoint: 'https://approved.example/api/notifications/push',
    platformFactory: async () => ({ token: async prompt => { prompts.push(prompt); return 'synthetic-device-token'.repeat(3); }, remove: async () => { removed++; }, dispose() {} }),
    fetchFn: async (_url, init) => { const body = JSON.parse(init!.body as string); requests.push(body); return new Response(JSON.stringify(body.action === 'test' ? { accepted: 1 } : { registered: body.action === 'register' }), { headers: { 'Content-Type': 'application/json' } }); } });
  const detach = service.attach(identity, () => owner, () => 'bn');
  assert.equal(prompts.length, 0, 'mount must not ask permission');
  await service.register(); assert.equal(service.snapshot().enabled, true); assert.deepEqual(prompts, [true]);
  await service.register(false); assert.deepEqual(prompts, [true, false], 'resume uses a permission check without another prompt');
  await service.test(); assert.equal(service.snapshot().accepted, true);
  assert.equal(requests.at(-1).action, 'test');
  await service.disable(); assert.equal(service.snapshot().enabled, false); assert.equal(removed, 1); assert.equal(requests.at(-1).action, 'unregister');
  assert.ok([...storage.keys()].every(key => key.startsWith('hisab_push_')), 'notification settings never write ledger keys');
  assert.ok(requests.every(body => !('amount' in body) && !('note' in body) && !('workspaceId' in body)));
  // A Google account change during token renewal must not send under stale UI ownership.
  identity.getValidAccessToken = async () => { profile = 'b'.repeat(64); return 'synthetic-other-auth'; };
  const count = requests.length; await service.register();
  assert.equal(requests.length, count); assert.equal(service.snapshot().enabled, false); assert.equal(service.snapshot().error, 'PUSH_AUTH_REQUIRED');
  detach();
});
