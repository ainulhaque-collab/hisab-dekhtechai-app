import { readFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateFirebaseAndroidConfig, validateFirebaseWebConfig, validateWebPushPublicKey } from './Check-FirebaseSetup.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export async function prepareFirebasePush(stageAndroid = false, resourcesRoot = root) {
  const inputRoot = resolve(resourcesRoot);
  const web = validateFirebaseWebConfig(JSON.parse(await readFile(resolve(inputRoot, '.local-firebase/web-config.json'), 'utf8')));
  const vapid = validateWebPushPublicKey((await readFile(resolve(inputRoot, '.local-firebase/web-push-public-key.txt'), 'utf8')).trim());
  if (stageAndroid) {
    const source = resolve(inputRoot, '.local-firebase/google-services.json');
    validateFirebaseAndroidConfig(JSON.parse(await readFile(source, 'utf8')));
    await copyFile(source, resolve(root, 'android/app/google-services.json'));
  }
  return { VITE_PUSH_ENABLED: 'true', VITE_FIREBASE_WEB_CONFIG: JSON.stringify(web), VITE_FIREBASE_VAPID_KEY: vapid };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const index = process.argv.indexOf('--resources-root');
    if (index !== -1 && (!process.argv[index + 1] || process.argv[index + 1].startsWith('--'))) throw Error('BUILD_RESOURCES_REQUIRED');
    process.stdout.write(JSON.stringify(await prepareFirebasePush(process.argv.includes('--android'), index === -1 ? root : process.argv[index + 1])));
  }
  catch { console.error('FIREBASE_PUSH_BUILD_CONFIG_INVALID'); process.exitCode = 1; }
}
