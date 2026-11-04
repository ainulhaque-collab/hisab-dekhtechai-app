import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise emitted Node ESM, rather than tsx's development-only import resolver.
const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const compiled = spawnSync(process.execPath, [compiler, '--project', 'api/tsconfig.json', '--outDir', 'build/api-runtime'],
  { cwd: root, stdio: 'inherit' });
if (compiled.status !== 0) process.exit(compiled.status || 1);
process.env.AI_ENABLED = 'false'; // No credentials, identities, media or paid provider calls.
const { default: app } = await import('../build/api-runtime/api/ai/extract.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
try {
  const url = `http://127.0.0.1:${server.address().port}/api/ai/extract`;
  const method = await fetch(url);
  assert.equal(method.status, 405);
  assert.equal((await method.json()).error, 'AI_METHOD_NOT_ALLOWED');
  const disabled = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).error, 'AI_NOT_CONFIGURED');
  console.log('Compiled Node ESM API starts and returns safe method/configuration responses.');
} finally { server.closeAllConnections(); server.close(); }
