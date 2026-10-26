import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createAIRouter, AIHttpOptions } from '../../server/ai/http';
import { AIServiceError, googleIdentityVerifier, ownerHashForSubject } from '../../server/ai/googleIdentity';
import { DevelopmentAIBudget, RedisAIBudget } from '../../server/ai/budget';
import { aiOptionsFromEnvironment } from '../../server/ai/runtime';
import { validateEntryDraft } from '../ai/entryDraft';
import { aiEndpoint, aiErrorMessage, extractEntry, validateExtractionResult } from '../ai/client';
import { validateReviewedEntry } from '../ai/review';
import { receiptFromBytes } from '../storage/receipts';

const owner = ownerHashForSubject('123456789');
const clientId = '123456789-example.apps.googleusercontent.com';
const rawDraft = () => ({ transactionType: 'expense', amountDecimal: '১২০', currency: 'BDT', merchant: 'দোকান', transactionDate: null, transactionTime: null, transcript: null, note: '', warnings: [] });
const input = () => ({ source: 'receipt' as const, consentToProcess: true,
  receipt: receiptFromBytes(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), 'image/png', 'synthetic.png') });
const body = () => ({ ownerHash: owner, requestId: randomUUID(), input: input() });

async function serve(t: TestContext, overrides: Partial<AIHttpOptions> = {}) {
  let calls = 0;
  const app = express();
  const options: AIHttpOptions = { enabled: true, allowedOrigins: new Set(['https://localhost', 'http://localhost:3000']),
    verifyToken: async token => { if (token !== 'synthetic-valid-token') throw new AIServiceError('AI_AUTH_REQUIRED', 401); return owner; },
    budget: new DevelopmentAIBudget(), provider: { provider: 'gemini', extract: async media => {
      calls++; return { provider: 'gemini', sourceSha256: media.source === 'receipt' ? media.receipt.sha256 : '', draft: validateEntryDraft(rawDraft()) };
    } }, ...overrides };
  app.use('/api/ai', createAIRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/api/ai/extract`;
  const post = (data: unknown, headers: Record<string, string> = {}) => fetch(endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-valid-token', Origin: 'https://localhost', ...headers }, body: JSON.stringify(data) });
  return { endpoint, post, calls: () => calls };
}

test('AI endpoint authenticates, binds owner and source, and never makes a duplicate provider call', async t => {
  const server = await serve(t);
  const request = body();
  const result = await server.post(request);
  assert.equal(result.status, 200); assert.match(result.headers.get('cache-control')!, /no-store/);
  const raw = await result.json();
  assert.equal(raw.draft.amountDecimal, '120.00'); assert.equal(raw.draft.requiresConfirmation, true);
  assert.equal(raw.sourceSha256, request.input.receipt.sha256);
  assert.equal((await server.post(request)).status, 409);
  assert.equal(server.calls(), 1);
});

test('Auth, owner, consent and cross-origin failures never reach the AI provider', async t => {
  const server = await serve(t);
  assert.equal((await server.post(body(), { Authorization: '' })).status, 401);
  assert.equal((await server.post(body(), { Authorization: 'Bearer invalid' })).status, 401);
  assert.equal((await server.post({ ...body(), ownerHash: 'a'.repeat(64) })).status, 403);
  const noConsent = body(); noConsent.input.consentToProcess = false;
  assert.equal((await server.post(noConsent)).status, 400);
  assert.equal((await server.post(body(), { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await server.post({ ...body(), accountId: 'attempted-account-injection' })).status, 400);
  assert.equal(server.calls(), 0);
});

test('API rejects huge, malformed and unsupported requests without echoing body or credentials', async t => {
  const server = await serve(t);
  assert.equal((await fetch(server.endpoint, { method: 'GET' })).status, 405);
  assert.equal((await fetch(server.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'private text' })).status, 415);
  const invalid = await fetch(server.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"synthetic-secret":' });
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error, 'AI_REQUEST_INVALID');
  const large = await server.post({ ...body(), padding: 'x'.repeat(3 * 1024 * 1024) });
  assert.equal(large.status, 413); assert.equal((await large.json()).error, 'AI_MEDIA_TOO_LARGE');
  assert.equal(server.calls(), 0);
});

test('Concurrent duplicate requests reserve once and global/day quotas apply across owners', async () => {
  let now = 1_000_000;
  const budget = new DevelopmentAIBudget({ perMinute: 1, perDay: 2, globalPerDay: 2 }, () => now);
  const id = randomUUID();
  const results = await Promise.allSettled([budget.reserve(owner, id), budget.reserve(owner, id)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await assert.rejects(budget.reserve(owner, randomUUID()), /AI_LIMIT_REACHED/);
  now += 60_001;
  await budget.reserve(owner, randomUUID());
  await assert.rejects(budget.reserve('b'.repeat(64), randomUUID()), /AI_LIMIT_REACHED/);
});

test('Redis quota failures fail closed and runtime never uses memory in production', async () => {
  const failed = new RedisAIBudget('https://redis.example', 'synthetic-redis-secret', undefined, async () => { throw new Error('private storage response'); });
  await assert.rejects(failed.reserve(owner, randomUUID()), /AI_LIMIT_UNAVAILABLE/);
  const limited = new RedisAIBudget('https://redis.example', 'synthetic', undefined, async () => new Response(JSON.stringify({ result: 1 })));
  await assert.rejects(limited.reserve(owner, randomUUID()), /AI_LIMIT_REACHED/);
  const config = { AI_ENABLED: 'true', AI_LOCAL_DEVELOPMENT: 'true', GEMINI_API_KEY: 'synthetic-key', GEMINI_MODEL: 'gemini-synthetic-model', GOOGLE_OAUTH_CLIENT_IDS: clientId, AI_ALLOWED_ORIGINS: 'https://localhost' };
  assert.equal(aiOptionsFromEnvironment({ ...config, NODE_ENV: 'production' }).enabled, false);
  assert.equal(aiOptionsFromEnvironment({ ...config, NODE_ENV: 'development' }).enabled, false);
  assert.equal(aiOptionsFromEnvironment({ ...config, NODE_ENV: 'development' }, true).enabled, true);
  assert.equal(aiOptionsFromEnvironment({ ...config, NODE_ENV: 'development', AI_PER_DAY: 'NaN' }).enabled, false);
});

test('Google verification checks live expiry, audience, authorized client and subject before hashing', async () => {
  let info: any = { sub: '123456789', aud: clientId, azp: clientId, scope: 'openid email', expires_in: '3600', exp: String(Math.floor(Date.now() / 1000) + 3600) };
  const verify = googleIdentityVerifier([clientId], async (url, settings) => {
    assert.equal(url, 'https://oauth2.googleapis.com/tokeninfo'); assert.equal(settings?.method, 'POST');
    assert.equal(new Headers(settings?.headers).get('Authorization'), 'Bearer synthetic-token');
    return new Response(JSON.stringify(info));
  });
  assert.equal(await verify('synthetic-token'), owner);
  for (const changes of [{ aud: 'other.apps.googleusercontent.com' }, { azp: 'other.apps.googleusercontent.com' }, { expires_in: '0' }, { exp: '1' }, { sub: '' }, { scope: 'email' }]) {
    const original = info; info = { ...info, ...changes };
    await assert.rejects(verify('synthetic-token'), /AI_AUTH_REQUIRED/); info = original;
  }
  const down = googleIdentityVerifier([clientId], async () => { throw new Error('sensitive diagnostic'); });
  await assert.rejects(down('synthetic-token'), /AI_AUTH_UNAVAILABLE/);
});

test('Client and server round trip requires real identity and returns only a review draft', async t => {
  const server = await serve(t);
  let tokenCalls = 0;
  const identity = { isTestMode: () => false, getValidAccessToken: async () => { tokenCalls++; return 'synthetic-valid-token'; }, getProfile: () => ({ subjectHash: owner }) };
  const media = input();
  const result = await extractEntry(media, owner, identity, { endpoint: server.endpoint });
  assert.equal(result.draft.amountDecimal, '120.00'); assert.equal(tokenCalls, 1);
  await assert.rejects(extractEntry(media, owner, { ...identity, isTestMode: () => true }, { endpoint: server.endpoint }), /AI_AUTH_REQUIRED/);
  assert.equal(server.calls(), 1);
  assert.throws(() => validateExtractionResult({ ...result, sourceSha256: 'bad' }, media.receipt.sha256, result.requestId), /AI_RESPONSE_INVALID/);
  assert.equal(aiEndpoint('https://ai.example/', 'https://localhost'), 'https://ai.example/api/ai/extract');
  assert.throws(() => aiEndpoint('http://remote.example/', 'https://localhost'), /AI_NOT_CONFIGURED/);
});

test('Stale Google identity after an AI response cannot fill the form', async () => {
  let currentOwner = owner;
  const identity = { isTestMode: () => false, getValidAccessToken: async () => 'synthetic', getProfile: () => ({ subjectHash: currentOwner }) };
  await assert.rejects(extractEntry(input(), owner, identity, { endpoint: 'https://ai.example/api/ai/extract', fetchFn: async () => {
    currentOwner = 'a'.repeat(64); return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  } }), /AI_OWNER_MISMATCH/);
});

test('Review requires positive exact BDT amount and explicit type, retaining missing times for Save', () => {
  const review = { type: 'expense', amount: '১২৩.৪৫', currency: 'BDT', date: '', time: '', note: ' বাজার ' };
  assert.deepEqual(validateReviewedEntry(review), { type: 'expense', amount: '123.45', date: '', time: '', note: 'বাজার' });
  for (const change of [{ currency: '' }, { type: '' }, { amount: '0' }, { amount: '1.111' }, { date: '2026-02-30' }, { time: '25:20' }])
    assert.throws(() => validateReviewedEntry({ ...review, ...change }));
});

test('Provider busy, quota and permission errors are safe actionable HTTP responses', async t => {
  let code = 'AI_PROVIDER_BUSY';
  const server = await serve(t, { budget: new DevelopmentAIBudget({ perMinute: 10, perDay: 10, globalPerDay: 100 }),
    provider: { provider: 'gemini', extract: async () => { throw new Error(code); } } });
  for (const [expectedCode, status] of [['AI_PROVIDER_BUSY', 503], ['AI_PROVIDER_QUOTA', 429], ['AI_PROVIDER_AUTH_ERROR', 503], ['AI_MODEL_UNAVAILABLE', 503], ['AI_RESPONSE_INCOMPLETE', 422], ['AI_CONTENT_BLOCKED', 422]] as const) {
    code = expectedCode;
    const response = await server.post(body());
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: expectedCode });
  }
});

test('Google verification outage is actionable in the UI and diagnostics contain only stage/code/status', async t => {
  const failures: unknown[] = [];
  const server = await serve(t, { verifyToken: async () => { throw new AIServiceError('AI_AUTH_UNAVAILABLE', 503); }, onFailure: failure => failures.push(failure) });
  await assert.rejects(extractEntry(input(), owner, { isTestMode: () => false, getValidAccessToken: async () => 'synthetic-valid-token', getProfile: () => ({ subjectHash: owner }) },
    { endpoint: server.endpoint }), error => {
      assert.equal((error as Error).message, 'AI_AUTH_UNAVAILABLE');
      assert.match(aiErrorMessage(error, true), /sign-in could not be verified/);
      assert.doesNotMatch(aiErrorMessage(error, true), /temporarily unavailable/);
      return true;
    });
  assert.deepEqual(failures, [{ code: 'AI_AUTH_UNAVAILABLE', status: 503, stage: 'authentication' }]);
});
