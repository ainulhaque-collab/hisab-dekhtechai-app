import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createPushRouter, type PushHttpOptions } from '../../server/notifications/http';
import { RedisPushStore, PushError, pushHash, type PushDevice, type PushStore } from '../../server/notifications/store';
import { FCMPushSender, pushMessage } from '../../server/notifications/sender';
import { pushOptionsFromEnvironment } from '../../server/notifications/runtime';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { buildExpenseJournal } from '../domain/journal';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import type { SyncOperation } from '../contracts/types';
import type { NotificationInbox, NotificationInboxItem } from '../notifications/inbox';

const owner = 'a'.repeat(64), other = 'b'.repeat(64);
const device = (): PushDevice => ({ id: randomUUID(), token: 'synthetic-device-token'.repeat(3), secretHash: pushHash('synthetic-secret'), tokenHash: pushHash('synthetic-device-token'.repeat(3)), platform: 'android', language: 'bn', updatedAt: Date.now() });
class TestStore implements PushStore {
  records = new Map<string, PushDevice[]>(); events = new Set<string>();
  history = new Map<string, NotificationInboxItem[]>(); read = new Map<string, number>();
  async register(owner: string, value: PushDevice) { this.records.set(owner, [...(this.records.get(owner) || []).filter(v => v.id !== value.id), value]); }
  async remove(owner: string, id: string, secretHash: string) { this.records.set(owner, (this.records.get(owner) || []).filter(v => v.id !== id || v.secretHash !== secretHash)); }
  async devices(owner: string) { return this.records.get(owner) || []; }
  async forget(owner: string, device: PushDevice) { this.records.set(owner, (this.records.get(owner) || []).filter(v => v.id !== device.id || v.tokenHash !== device.tokenHash)); }
  async reserve(owner: string, event: string) { const key = owner + event; if (this.events.has(key)) return false; this.events.add(key); const items = this.history.get(owner) || []; items.unshift({ id: pushHash(event), kind: event.startsWith('test:') ? 'test' : 'transaction', at: Date.now(), sequence: (items[0]?.sequence || 0) + 1 }); this.history.set(owner, items.slice(0, 100)); return true; }
  async inbox(owner: string): Promise<NotificationInbox> { return { items: this.history.get(owner) || [], readThrough: this.read.get(owner) || 0 }; }
  async markRead(owner: string, id: string) { const item = (this.history.get(owner) || []).find(value => value.id === id); if (!item) throw new PushError('PUSH_INBOX_ITEM_MISSING', 409); this.read.set(owner, Math.max(this.read.get(owner) || 0, item.sequence)); }
}
async function serve(t: TestContext, overrides: Partial<PushHttpOptions> = {}) {
  const store = new TestStore(); const sent: PushDevice[][] = [];
  const app = express();
  app.use('/api/notifications', createPushRouter({ enabled: true, allowedOrigins: new Set(['https://localhost']),
    verifyToken: async token => { if (token !== 'synthetic-auth') throw new PushError('PUSH_AUTH_REQUIRED', 401); return owner; }, store,
    sender: { send: async devices => { sent.push(devices); return devices.map(() => 'accepted'); } }, ...overrides }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/notifications/push`;
  const post = (body: unknown, headers = {}) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-auth', Origin: 'https://localhost', ...headers }, body: JSON.stringify(body) });
  return { endpoint, post, store, sent };
}

test('push rejects unauthenticated, foreign-owner, cross-origin and arbitrary-message requests before send', async t => {
  const service = await serve(t); const body = { action: 'transaction', ownerHash: owner, eventId: randomUUID() };
  assert.equal((await service.post(body, { Authorization: '' })).status, 401);
  assert.equal((await service.post(body, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await service.post({ ...body, ownerHash: other })).status, 403);
  assert.equal((await service.post(body, { Origin: 'https://evil.example' })).status, 403);
  for (const extra of [{ token: 'recipient-injection' }, { title: 'custom-message' }, { action: '__proto__' }, { action: 'campaign' }])
    assert.equal((await service.post({ ...body, ...extra })).status, 400);
  assert.equal(service.sent.length, 0);
});

test('transaction dispatch addresses only this owner, deduplicates concurrent requests and returns no tokens', async t => {
  const service = await serve(t); await service.store.register(owner, device()); await service.store.register(other, { ...device(), token: 'foreign-secret-token' });
  const body = { action: 'transaction', ownerHash: owner, eventId: randomUUID() };
  const responses = await Promise.all([service.post(body), service.post(body)]);
  for (const response of responses) { assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/); assert.doesNotMatch(await response.text(), /token|secret|foreign/); }
  assert.equal(service.sent.length, 1); assert.equal(service.sent[0].length, 1); assert.notEqual(service.sent[0][0].token, 'foreign-secret-token');
});

test('registration, test and revocation require this installation secret; tests never broadcast', async t => {
  const service = await serve(t); const id = randomUUID(), secret = randomUUID();
  const registration = { action: 'register', ownerHash: owner, deviceId: id, secret, token: 'synthetic-fcm-token'.repeat(3), platform: 'web', language: 'en' };
  assert.equal((await service.post(registration)).status, 200); await service.store.register(owner, device());
  const attempt = { action: 'test', ownerHash: owner, deviceId: id, secret, eventId: randomUUID() };
  assert.equal((await service.post({ ...attempt, secret: randomUUID() })).status, 409);
  assert.equal((await service.post(attempt)).status, 200);
  assert.equal(service.sent[0].length, 1); assert.equal(service.sent[0][0].id, id);
  await service.post({ action: 'unregister', ownerHash: owner, deviceId: id, secret: randomUUID() });
  assert.ok((await service.store.devices(owner)).some(v => v.id === id));
  await service.post({ action: 'unregister', ownerHash: owner, deviceId: id, secret });
  assert.ok(!(await service.store.devices(owner)).some(v => v.id === id));
});

test('expired recipients are pruned without deleting a new token; provider errors are fixed and redacted', async t => {
  const store = new TestStore(); const value = device(); await store.register(owner, value);
  const service = await serve(t, { store, sender: { send: async () => { await store.register(owner, { ...value, tokenHash: 'rotated' }); return ['expired']; } } });
  const body = { action: 'transaction', ownerHash: owner, eventId: randomUUID() };
  assert.equal((await service.post(body)).status, 200); assert.equal((await store.devices(owner)).length, 1);
  const failed = await serve(t, { sender: { send: async () => { throw new Error('private-token-and-provider-data'); } } });
  const response = await failed.post(body); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'PUSH_UNAVAILABLE' });
});

test('FCM sender pins project, uses short-lived bearer, generic lockscreen templates and no retry', async () => {
  const value = device(); const calls: unknown[] = [];
  const sender = new FCMPushSender(async (url, init) => {
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/hisab-dekhtechai-notifications/messages:send');
    assert.equal((init?.headers as any).Authorization, 'Bearer synthetic-server-token');
    calls.push(JSON.parse(init!.body as string)); return new Response('{}', { status: 200 });
  }, async () => 'synthetic-server-token');
  assert.deepEqual(await sender.send([value], 'transaction', 'synthetic-operation'), ['accepted']); assert.equal(calls.length, 1);
  const message = pushMessage(value, 'transaction', 'synthetic-operation');
  assert.equal(message.android.notification.visibility, 'PRIVATE'); assert.match(message.notification.body, /লেনদেন/);
  assert.doesNotMatch(JSON.stringify(message), /amount|workspace|note|balance/);
  const expired = new FCMPushSender(async () => new Response(JSON.stringify({ error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } }), { status: 404 }), async () => 'synthetic');
  assert.deepEqual(await expired.send([value], 'test', 'synthetic'), ['expired']);
  const missing = new FCMPushSender(async () => { throw new Error('private'); }, async () => 'synthetic');
  assert.deepEqual(await missing.send([value], 'test', 'synthetic'), ['unavailable']);
});

test('Redis fails closed, reports ownership/device caps, and never consumes AI quota keys', async () => {
  const failed = new RedisPushStore('https://redis.example', 'synthetic', async () => { throw new Error('private-storage-details'); });
  await assert.rejects(failed.register(owner, device()), /^Error: PUSH_STORAGE_UNAVAILABLE$/);
  const request: unknown[][] = [];
  let result = 1;
  const store = new RedisPushStore('https://redis.example', 'synthetic', async (_url, init) => {
    request.push(JSON.parse(init!.body as string)); return new Response(JSON.stringify({ result }));
  });
  await assert.rejects(store.register(owner, device()), /PUSH_DEVICE_CONFLICT/); result = 2;
  await assert.rejects(store.register(owner, device()), /PUSH_DEVICE_LIMIT/);
  await assert.rejects(store.reserve(owner, 'one-event'), /PUSH_LIMIT_REACHED/);
  assert.doesNotMatch(JSON.stringify(request), /hisab:ai/);
  assert.match(JSON.stringify(request), /hisab:push:preview:v1/);
});

test('runtime requires approved Preview, explicit activation and durable storage; production stays off', () => {
  const env = { VERCEL_ENV: 'preview', PUSH_ENABLED: 'true', GOOGLE_OAUTH_CLIENT_IDS: '123-test.apps.googleusercontent.com', UPSTASH_REDIS_REST_URL: 'https://redis.example', UPSTASH_REDIS_REST_TOKEN: 'synthetic' };
  assert.equal(pushOptionsFromEnvironment(env).enabled, true);
  for (const change of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' }, { PUSH_ENABLED: 'false' }, { UPSTASH_REDIS_REST_TOKEN: '' }])
    assert.equal(pushOptionsFromEnvironment({ ...env, ...change }).enabled, false);
});

test('inbox is owner-isolated, independent of push permission, and stale reads cannot unread newer messages', async t => {
  const service = await serve(t);
  const first = randomUUID(), second = randomUUID();
  await service.post({ action: 'transaction', ownerHash: owner, eventId: first });
  await service.post({ action: 'transaction', ownerHash: owner, eventId: second });
  await service.store.reserve(other, `transaction:${randomUUID()}`);
  const response = await service.post({ action: 'inbox', ownerHash: owner });
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.items.length, 2); assert.equal(result.readThrough, 0);
  assert.equal(result.items[0].id, pushHash(`transaction:${second}`));
  assert.ok(result.items.every((item: any) => !('token' in item) && !('amount' in item) && !('note' in item)));
  const sends = service.sent.length;
  assert.equal((await service.post({ action: 'read', ownerHash: owner, itemId: result.items[0].id })).status, 200);
  await service.post({ action: 'read', ownerHash: owner, itemId: result.items[1].id });
  const latest = await (await service.post({ action: 'inbox', ownerHash: owner })).json();
  assert.equal(latest.readThrough, 2); assert.equal(service.sent.length, sends, 'reading history cannot send notifications');
  assert.equal((await service.post({ action: 'inbox', ownerHash: other })).status, 403);
  assert.equal((await service.post({ action: 'inbox', ownerHash: owner }, { Authorization: '' })).status, 401);
  const foreign = (await service.store.inbox(other)).items[0];
  assert.equal((await service.post({ action: 'read', ownerHash: owner, itemId: foreign.id })).status, 409);
  assert.equal((await service.post({ action: 'read', ownerHash: owner, itemId: result.items[0].id, readThrough: 99999 })).status, 400);
});

test('the inbox preserves one generic event when delivery fails and a retry does not duplicate it', async t => {
  const store = new TestStore(); const value = device(); await store.register(owner, value);
  const service = await serve(t, { store, sender: { send: async () => { throw new PushError('PUSH_DELIVERY_UNAVAILABLE'); } } });
  const body = { action: 'transaction', ownerHash: owner, eventId: randomUUID() };
  assert.equal((await service.post(body)).status, 503);
  assert.equal((await service.post(body)).status, 200);
  const result = await (await service.post({ action: 'inbox', ownerHash: owner })).json();
  assert.equal(result.items.length, 1); assert.equal(result.items[0].kind, 'transaction');
});

test('Redis inbox validates private store responses and scopes read cursor commands to one owner', async () => {
  const item = { id: 'c'.repeat(64), kind: 'test', at: Date.now(), sequence: 4 };
  const commands: any[][] = [];
  let result: unknown = [3, JSON.stringify(item)];
  const store = new RedisPushStore('https://redis.example', 'synthetic', async (_url, init) => {
    commands.push(JSON.parse(init!.body as string)); return new Response(JSON.stringify({ result }));
  });
  assert.deepEqual(await store.inbox(owner), { items: [item], readThrough: 3 });
  result = 0; await store.markRead(owner, item.id);
  assert.ok(commands.flat().filter(value => typeof value === 'string' && value.startsWith('hisab:push:')).every(key => key.includes(owner)));
  result = [0, JSON.stringify({ ...item, token: 'private-value' })];
  await assert.rejects(store.inbox(owner), /^Error: PUSH_INBOX_UNAVAILABLE$/);
  result = 1; await assert.rejects(store.markRead(owner, item.id), /PUSH_INBOX_ITEM_MISSING/);
});

test('durable journal notifications exclude failed commits and duplicate saves; listener errors cannot undo a save', async () => {
  const driver = new LocalStorageFallbackDriver(); const db = new LocalDatabase(`push-test-${randomUUID()}`, driver);
  const opId = randomUUID(); const journal = buildExpenseJournal({ workspaceId: 'ws-personal-default', assetAccountId: 'acc-cash-1', expenseCategoryId: 'cat-food', amountMinor: '12000', effectiveDate: '2026-10-28', opId });
  const op: SyncOperation = { protocolVersion: 1, ownerHash: owner, deviceId: db.getDeviceId(), seq: db.getNextDeviceSeq(), operationId: opId,
    entityId: journal.transaction.id, type: 'journal.post', createdAtUtc: new Date().toISOString(), payload: { balancedJournal: journal }, contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })) };
  const events: string[] = [];
  db.subscribeToCommittedJournals(id => { assert.equal(db.isTransactionInProgress(), false); assert.ok(db.getTransaction(journal.transaction.id)); events.push(id); });
  db.subscribeToCommittedJournals(() => { throw new Error('optional-alert-failure'); });
  driver.faultInjection = 'throw_on_commit'; await assert.rejects(db.commitJournalWithOutbox(journal, op)); assert.equal(events.length, 0);
  driver.faultInjection = 'none'; db.clearPersistenceError();
  await db.commitJournalWithOutbox(journal, op); await db.commitJournalWithOutbox(journal, op);
  assert.deepEqual(events, [opId]); assert.ok(db.getTransaction(journal.transaction.id));
});
