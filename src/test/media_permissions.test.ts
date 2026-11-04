import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMediaPermissions } from '../ai/mediaPermissions';
import { aiErrorMessage } from '../ai/client';

test('Granted native media permissions never prompt again; only missing aliases are requested', async () => {
  const requested: string[][] = [];
  const bridge = { checkPermissions: async () => ({ camera: 'granted', microphone: 'prompt' }),
    requestPermissions: async ({ permissions }: { permissions: any[] }) => { requested.push(permissions); return { camera: 'granted', microphone: 'granted' }; } };
  await ensureMediaPermissions(bridge, ['camera']); assert.equal(requested.length, 0);
  await ensureMediaPermissions(bridge, ['camera', 'microphone']); assert.deepEqual(requested, [['microphone']]);
});

test('Denied native permission cannot become consent or trigger an endless re-prompt', async () => {
  let requests = 0;
  const bridge = { checkPermissions: async () => ({ microphone: 'denied' }),
    requestPermissions: async () => { requests++; return { microphone: 'granted' }; } };
  await assert.rejects(ensureMediaPermissions(bridge, ['microphone']), /AI_MEDIA_PERMISSION_DENIED/);
  assert.equal(requests, 0);
  await assert.rejects(ensureMediaPermissions({ ...bridge, checkPermissions: async () => ({ microphone: 'prompt' }),
    requestPermissions: async () => ({ microphone: 'denied' }) }, ['microphone']), /AI_MEDIA_PERMISSION_DENIED/);
});

test('Broken or malformed permission bridge is an actionable capture error, never a provider outage', async () => {
  for (const response of [undefined, null, {}, { microphone: 'GRANTED' }]) {
    await assert.rejects(ensureMediaPermissions({ checkPermissions: async () => response, requestPermissions: async () => ({}) }, ['microphone']), /AI_MEDIA_PERMISSION_UNAVAILABLE/);
  }
  const broken = { checkPermissions: async () => { throw new Error('private native diagnostic'); }, requestPermissions: async () => ({}) };
  await assert.rejects(ensureMediaPermissions(broken, ['microphone']), error => {
    assert.equal((error as Error).message, 'AI_MEDIA_PERMISSION_UNAVAILABLE');
    const text = aiErrorMessage(error, true);
    assert.match(text, /permission could not be checked/); assert.doesNotMatch(text, /temporarily unavailable|private native/);
    return true;
  });
});

test('A permission request failure or missing post-prompt state never allows capture', async () => {
  for (const requestPermissions of [async () => undefined, async () => { throw new Error('private native error'); }]) {
    await assert.rejects(ensureMediaPermissions({ checkPermissions: async () => ({ camera: 'prompt' }), requestPermissions }, ['camera']), /AI_MEDIA_PERMISSION_UNAVAILABLE/);
  }
});
