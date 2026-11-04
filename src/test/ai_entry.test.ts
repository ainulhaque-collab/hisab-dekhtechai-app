import test from 'node:test';
import assert from 'node:assert/strict';
import { BlockedReason, FinishReason } from '@google/genai';
import { validateEntryDraft } from '../ai/entryDraft';
import { GeminiEntryProvider } from '../../server/ai/gemini';
import { receiptFromBytes } from '../storage/receipts';

const raw = () => ({ transactionType: 'expense', amountDecimal: '১২৩.৪৫', currency: 'BDT', merchant: 'দোকান', transactionDate: null, transactionTime: null, transcript: null, note: 'বাজার', warnings: [] });
const receipt = () => receiptFromBytes(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), 'image/png', 'synthetic.png');
const config = { apiKey: 'synthetic-unit-test-key', model: 'gemini-unit-test-model' };

test('AI draft normalizes exact Bengali money and never fabricates a date or posting permission', () => {
  const draft = validateEntryDraft(raw());
  assert.equal(draft.amountDecimal, '123.45');
  assert.equal(draft.transactionDate, null); assert.equal(draft.transactionTime, null);
  assert.equal(draft.requiresConfirmation, true);
  assert.equal(validateEntryDraft({ ...raw(), amountDecimal: null, transactionType: 'unknown', currency: 'unknown' }).amountDecimal, null);
  for (const amountDecimal of ['-1.00', '0', '10.555', 'NaN', 123.45]) assert.throws(() => validateEntryDraft({ ...raw(), amountDecimal }));
});

test('AI output cannot inject an account, sync operation or impossible date/time', () => {
  for (const extra of [{ accountId: 'private-account' }, { operationId: 'post-now' }, { requiresConfirmation: false }])
    assert.throws(() => validateEntryDraft({ ...raw(), ...extra }), /AI_DRAFT_INVALID/);
  assert.throws(() => validateEntryDraft({ ...raw(), transactionDate: '2026-02-29' }));
  assert.throws(() => validateEntryDraft({ ...raw(), transactionTime: '25:15' }));
  assert.throws(() => validateEntryDraft({ ...raw(), warnings: ['x'.repeat(301)] }));
});

test('Gemini adapter requires configuration and explicit consent before any provider call', async () => {
  assert.throws(() => new GeminiEntryProvider({ apiKey: '', model: '' }), /AI_NOT_CONFIGURED/);
  let calls = 0;
  const provider = new GeminiEntryProvider(config, async () => { calls++; return { text: JSON.stringify(raw()) }; });
  await assert.rejects(provider.extract({ source: 'receipt', receipt: receipt(), consentToProcess: false }), /AI_CONSENT_REQUIRED/);
  await assert.rejects(provider.extract({ source: 'receipt', receipt: { ...receipt(), sha256: 'a'.repeat(64) }, consentToProcess: true }));
  assert.equal(calls, 0);
});

test('Gemini uses structured image/audio inputs and returns a source-bound review-only draft', async () => {
  const requests: any[] = [];
  const provider = new GeminiEntryProvider(config, async request => { requests.push(request); return { text: JSON.stringify(raw()) }; });
  const blob = receipt();
  const result = await provider.extract({ source: 'receipt', receipt: blob, consentToProcess: true });
  assert.equal(result.provider, 'gemini'); assert.equal(result.sourceSha256, blob.sha256);
  assert.equal(result.draft.requiresConfirmation, true);
  assert.equal(requests[0].config.responseMimeType, 'application/json');
  assert.equal(requests[0].config.httpOptions.retryOptions.attempts, 1);
  assert.equal(requests[0].contents[0].parts[1].inlineData.mimeType, 'image/png');
  await provider.extract({ source: 'voice', dataBase64: btoa('synthetic audio'), mimeType: 'audio/webm;codecs=opus', consentToProcess: true });
  assert.equal(requests[1].contents[0].parts[1].inlineData.mimeType, 'audio/webm');
});

test('Malformed audio is rejected locally and provider failures never echo credentials or raw response', async () => {
  let calls = 0;
  const provider = new GeminiEntryProvider(config, async () => { calls++; throw new Error('sensitive synthetic-key response'); });
  await assert.rejects(provider.extract({ source: 'voice', dataBase64: 'bad!', mimeType: 'audio/wav', consentToProcess: true }), /AI_AUDIO_INVALID/);
  await assert.rejects(provider.extract({ source: 'voice', dataBase64: btoa('x'), mimeType: 'application/javascript', consentToProcess: true }), /AI_AUDIO_INVALID/);
  assert.equal(calls, 0);
  await assert.rejects(provider.extract({ source: 'receipt', receipt: receipt(), consentToProcess: true }), error => {
    assert.equal((error as Error).message, 'AI_PROVIDER_UNAVAILABLE'); return true;
  });
  const invalidJson = new GeminiEntryProvider(config, async () => ({ text: 'private malformed response' }));
  await assert.rejects(invalidJson.extract({ source: 'receipt', receipt: receipt(), consentToProcess: true }), /AI_RESPONSE_INVALID/);
});

test('Google service statuses become fixed safe errors, without leaking response details', async () => {
  for (const [status, expected] of [[503, 'AI_PROVIDER_BUSY'], [429, 'AI_PROVIDER_QUOTA'], [403, 'AI_PROVIDER_AUTH_ERROR'], [404, 'AI_MODEL_UNAVAILABLE']] as const) {
    const provider = new GeminiEntryProvider(config, async () => { throw Object.assign(new Error('sensitive synthetic response'), { status }); });
    await assert.rejects(provider.extract({ source: 'receipt', receipt: receipt(), consentToProcess: true }), error => {
      assert.equal((error as Error).message, expected); return true;
    });
  }
});

test('Gemini incomplete or blocked output cannot masquerade as a valid draft', async () => {
  const media = { source: 'receipt' as const, receipt: receipt(), consentToProcess: true };
  for (const [finishReason, code] of [[FinishReason.MAX_TOKENS, 'AI_RESPONSE_INCOMPLETE'], [FinishReason.SAFETY, 'AI_CONTENT_BLOCKED']] as const) {
    const provider = new GeminiEntryProvider(config, async () => ({ text: JSON.stringify(raw()), candidates: [{ finishReason }] }));
    await assert.rejects(provider.extract(media), new RegExp(code));
  }
  const blocked = new GeminiEntryProvider(config, async () => ({ text: JSON.stringify(raw()), promptFeedback: { blockReason: BlockedReason.SAFETY } }));
  await assert.rejects(blocked.extract(media), /AI_CONTENT_BLOCKED/);
  const checked = new GeminiEntryProvider({ ...config, model: 'gemini-3.6-flash' }, async request => {
    assert.equal(request.config?.thinkingConfig?.thinkingLevel, 'MINIMAL');
    assert.equal(request.config?.candidateCount, 1);
    return { text: JSON.stringify(raw()), candidates: [{ finishReason: FinishReason.STOP }] };
  });
  assert.equal((await checked.extract(media)).draft.amountDecimal, '123.45');
});
