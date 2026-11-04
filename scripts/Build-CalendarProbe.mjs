import { build } from 'esbuild';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Test-only bundle of the actual production component. No keys, login or database.
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ entryPoints: [path.join(root, 'scripts/fixtures/calendar-probe.tsx')],
  bundle: true, write: false, minify: true, jsx: 'automatic', target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' } });
const assetDir = path.join(root, 'dist/assets');
const files = (await readdir(assetDir)).filter(file => file.endsWith('.css'));
if (!files.length) throw new Error('Build the current Web client before its calendar test helper.');
const css = (await Promise.all(files.map(file => readFile(path.join(assetDir, file), 'utf8')))).join('\n');
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const output = path.join(root, 'build/calendar-native-probe');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'calendar-probe.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:white;color:#0f172a"><div id="root"></div><script>${script}</script></body></html>`);
console.log('Built synthetic DOM calendar fixture from AppDateInput.');
