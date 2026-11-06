import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('the no-AI build rejects extraction and guides before reading identity, media or network', async () => {
  const result = await build({
    stdin: { contents: `export {extractEntry} from './src/ai/client';
      export {requestFinancialGuide} from './src/ai/guideClient';
      export {aiFeaturesEnabled} from './src/ai/availability';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    define: { 'import.meta.env': JSON.stringify({ VITE_AI_FEATURES_ENABLED: 'false' }) },
  });
  const disabled = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  assert.equal(disabled.aiFeaturesEnabled, false);
  const forbidden = () => { assert.fail('AI-disabled builds must not touch identity or network'); };
  const identity = { isTestMode: forbidden, getProfile: forbidden, getValidAccessToken: forbidden };
  await assert.rejects(disabled.extractEntry(null, '', identity, { endpoint: 'https://example.invalid', fetchFn: forbidden }), /^Error: AI_NOT_CONFIGURED$/);
  await assert.rejects(disabled.requestFinancialGuide(null, '', identity, { endpoint: 'https://example.invalid', signal: new AbortController().signal, fetchFn: forbidden }), /^Error: AI_NOT_CONFIGURED$/);
});
