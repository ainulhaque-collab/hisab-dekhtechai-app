import { build } from 'esbuild';
import { loadEnv } from 'vite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
export async function bundleWebPushWorker(raw, write = true) {
  const assets = write ? ['/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png',
    ...(await readdir(resolve(root,'dist/assets'))).filter(name=>/\.(?:js|css|woff2?)$/.test(name)).map(name=>'/assets/'+name),
    '/audio/income.wav','/audio/expense.wav','/audio/transfer.wav'] : [];
  const hash = createHash('sha256');
  hash.update(raw).update(await readFile(resolve(root,'src/notifications/firebase-sw.ts'))).update(await readFile(resolve(root,'src/pwa/offlineShell.ts')));
  for(const asset of assets) hash.update(asset).update(await readFile(resolve(root,'dist'+asset)));
  const shell = {version:hash.digest('hex').slice(0,16),assets};
  // Exactly one public setting is embedded. No sender/provider/Redis secrets.
  return build({ entryPoints: [resolve(root, 'src/notifications/firebase-sw.ts')],
  outfile: resolve(root, 'dist/push-sw.js'), bundle: true, minify: true,
  format: 'iife', platform: 'browser', target: 'es2020', write,
  define: { 'import.meta.env': JSON.stringify({ VITE_FIREBASE_WEB_CONFIG: raw }), __OFFLINE_SHELL__:JSON.stringify(shell) },
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const env = loadEnv('production', root, 'VITE_');
  await bundleWebPushWorker(process.env.VITE_FIREBASE_WEB_CONFIG || env.VITE_FIREBASE_WEB_CONFIG || '');
  console.log('PUSH_CLASSIC_WORKER_BUNDLED');
}
