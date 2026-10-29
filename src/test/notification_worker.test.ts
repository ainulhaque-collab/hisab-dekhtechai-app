import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundleWebPushWorker } from '../../server/notifications/buildWebWorker.mjs';

test('the Firebase worker is a single classic script with no shared chunks or leaked environment', async () => {
  const result = await bundleWebPushWorker(JSON.stringify({ apiKey: `AIza${'x'.repeat(35)}`, projectId: 'hisab-dekhtechai-notifications',
    messagingSenderId: '706081957087', appId: '1:706081957087:web:2966864dcc99f41b77356a' }), false);
  assert.equal(result.outputFiles?.length, 1);
  const source = result.outputFiles![0].text;
  assert.doesNotThrow(() => new vm.Script(source), 'a classic service worker must parse without module syntax');
  assert.doesNotMatch(source, /importScripts\(|import\.meta|\/assets\//);
  assert.match(source, /hisab-dekhtechai-notifications/);
});
