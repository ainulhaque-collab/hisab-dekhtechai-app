import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticGeminiEntryProvider, createEntryProvider, selectAutomaticGeminiModel } from '../../server/ai/modelSelection';
import { receiptFromBytes } from '../storage/receipts';
import { validateEntryDraft } from '../ai/entryDraft';

const model = (name: string) => ({ name: `models/${name}`, outputTokenLimit: 8192, supportedActions: ['generateContent'] });
const input = () => ({ source: 'receipt' as const, consentToProcess: true,
  receipt: receiptFromBytes(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), 'image/png', 'synthetic.png') });

test('Automatic model selection uses advertised stable Flash versions, excluding expensive/special/preview aliases', () => {
  assert.equal(selectAutomaticGeminiModel([
    model('gemini-2.5-flash'), model('gemini-3-flash'), model('gemini-99-pro'), model('gemini-99-flash-preview'),
    model('gemini-99-flash-image'), model('gemini-99-flash-live'), model('gemini-99-flash-lite'), model('gemini-flash-latest'),
    { ...model('gemini-9-flash'), supportedActions: ['embedContent'] },
    { ...model('gemini-8-flash'), outputTokenLimit: 256 },
  ]), 'gemini-3-flash');
  assert.throws(() => selectAutomaticGeminiModel([model('gemini-1.5-flash'), model('gemini-99-pro')]), /AI_MODEL_UNAVAILABLE/);
  assert.throws(() => createEntryProvider({ AI_PROVIDER: 'openai', GEMINI_API_KEY: 'synthetic' }), /AI_NOT_CONFIGURED/);
});

test('Automatic provider caches catalog selection and validates consent before listing or generation', async () => {
  let lists = 0, calls = 0;
  const provider = new AutomaticGeminiEntryProvider('synthetic-test-key', {
    list: async () => { lists++; return [model('gemini-2.5-flash')]; },
    build: name => { assert.equal(name, 'gemini-2.5-flash'); return { provider: 'gemini', extract: async media => {
      calls++; return { provider: 'gemini', sourceSha256: media.source === 'receipt' ? media.receipt.sha256 : '',
        draft: validateEntryDraft({ transactionType: 'expense', amountDecimal: '120', currency: 'BDT', merchant: null, transactionDate: null, transactionTime: null, transcript: null, note: '', warnings: [] }) };
    } }; },
  });
  await assert.rejects(provider.extract({ ...input(), consentToProcess: false }), /AI_CONSENT_REQUIRED/);
  assert.equal(lists, 0); assert.equal(calls, 0);
  await Promise.all([provider.extract(input()), provider.extract(input())]);
  await provider.extract(input());
  assert.equal(lists, 1); assert.equal(calls, 3);
});

test('No suitable catalog model fails explicitly, without a hidden fallback or generation charge', async () => {
  let builds = 0;
  const provider = new AutomaticGeminiEntryProvider('synthetic-test-key', {
    list: async () => [model('gemini-99-pro')], build: () => { builds++; throw new Error('must not build'); },
  });
  await assert.rejects(provider.extract(input()), /AI_MODEL_UNAVAILABLE/); assert.equal(builds, 0);
});

test('A busy model is skipped on the next explicit request, with one generation per request', async () => {
  let lists = 0;
  const attempts: string[] = [];
  const provider = new AutomaticGeminiEntryProvider('synthetic-key', {
    list: async () => { lists++; return [model('gemini-3-flash'), model('gemini-2.5-flash')]; },
    build: name => ({ provider: 'gemini', extract: async media => {
      attempts.push(name);
      if (name === 'gemini-3-flash') throw new Error('AI_PROVIDER_BUSY');
      return { provider: 'gemini', sourceSha256: media.source === 'receipt' ? media.receipt.sha256 : '',
        draft: validateEntryDraft({ transactionType: 'expense', amountDecimal: '120', currency: 'BDT', merchant: null, transactionDate: null, transactionTime: null, transcript: null, note: '', warnings: [] }) };
    } }),
  });
  await assert.rejects(provider.extract(input()), /AI_PROVIDER_BUSY/);
  assert.deepEqual(attempts, ['gemini-3-flash']);
  assert.equal((await provider.extract(input())).draft.amountDecimal, '120.00');
  assert.deepEqual(attempts, ['gemini-3-flash', 'gemini-2.5-flash']); assert.equal(lists, 1);
});
