import test from 'node:test';
import assert from 'node:assert/strict';
import { AIConsentStore } from '../ai/consent';
import { aiEndpoint } from '../ai/client';

test('AI permission survives reopening on one device, but not another owner or a clean device', async () => {
  const values = new Map<string, string>();
  const driver = { getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); } };
  const owner = 'a'.repeat(64), other = 'b'.repeat(64);
  const initial = new AIConsentStore(driver);
  assert.equal(await initial.allowed(owner), false);
  await initial.allow(owner);
  const reopened = new AIConsentStore(driver);
  assert.equal(await reopened.allowed(owner), true);
  assert.equal(await reopened.allowed(other), false);
  const cleanDevice = new AIConsentStore({ ...driver, getItem: async () => null });
  assert.equal(await cleanDevice.allowed(owner), false);
  await reopened.revoke(owner);
  assert.equal(await initial.allowed(owner), false);
  await assert.rejects(initial.allow(''), /AI_AUTH_REQUIRED/);
});

test('A failed consent write never enables media processing', async () => {
  const store = new AIConsentStore({ getItem: async () => null,
    setItem: async () => { throw new Error('disk unavailable'); }, removeItem: async () => {} });
  await assert.rejects(store.allow('a'.repeat(64)), /disk unavailable/);
  assert.equal(await store.allowed('a'.repeat(64)), false);
});

test('Android cannot mistake its bundled localhost assets for a configured AI service', () => {
  assert.throws(() => aiEndpoint('', 'https://localhost', true), /AI_NOT_CONFIGURED/);
  assert.equal(aiEndpoint('', 'https://web.example'), 'https://web.example/api/ai/extract');
  assert.equal(aiEndpoint('https://ai.example', 'https://localhost', true), 'https://ai.example/api/ai/extract');
  for (const base of ['http://ai.example', 'https://user:secret@ai.example', 'https://ai.example/api', 'https://ai.example/?key=secret'])
    assert.throws(() => aiEndpoint(base, 'https://localhost', true));
});
