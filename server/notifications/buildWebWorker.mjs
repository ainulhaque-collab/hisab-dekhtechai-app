import { build } from 'esbuild';
import { loadEnv } from 'vite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function bundleWebPushWorker(raw, write = true) {
  // Exactly one public setting is embedded. No sender/provider/Redis secrets.
  return build({ entryPoints: [resolve(root, 'src/notifications/firebase-sw.ts')],
  outfile: resolve(root, 'dist/push-sw.js'), bundle: true, minify: true,
  format: 'iife', platform: 'browser', target: 'es2020', write,
  define: { 'import.meta.env': JSON.stringify({ VITE_FIREBASE_WEB_CONFIG: raw }) },
  });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const env = loadEnv('production', root, 'VITE_');
  await bundleWebPushWorker(process.env.VITE_FIREBASE_WEB_CONFIG || env.VITE_FIREBASE_WEB_CONFIG || '');
  console.log('PUSH_CLASSIC_WORKER_BUNDLED');
}
