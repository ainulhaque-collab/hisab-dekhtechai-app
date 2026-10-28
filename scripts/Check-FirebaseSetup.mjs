import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ECDH } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const expected = JSON.parse(await readFile(new URL('../config/firebase-notifications.json', import.meta.url), 'utf8'));
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const hasPrivateMaterial = value => {
  if (typeof value === 'string') return /-----BEGIN .*PRIVATE KEY-----/.test(value);
  if (Array.isArray(value)) return value.some(hasPrivateMaterial);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) => /^(private_key|private_key_id|client_secret|refresh_token)$/i.test(key) ||
    key === 'type' && entry === 'service_account' || hasPrivateMaterial(entry));
};
const invalid = code => { throw new Error(code); };

/** Client configuration is public; service-account JSON is never client input.
 * Return only the FCM fields, without Analytics or Authentication configuration. */
export function validateFirebaseWebConfig(value) {
  if (!isRecord(value) || hasPrivateMaterial(value)) invalid('FIREBASE_CLIENT_CONFIG_INVALID');
  if (value.projectId !== expected.projectId || value.messagingSenderId !== expected.senderId ||
      value.appId !== expected.webAppId) invalid('FIREBASE_WEB_PROJECT_MISMATCH');
  if (typeof value.apiKey !== 'string' || !/^AIza[\w-]{35}$/.test(value.apiKey)) invalid('FIREBASE_WEB_API_KEY_INVALID');
  return { apiKey: value.apiKey, projectId: value.projectId, messagingSenderId: value.messagingSenderId, appId: value.appId };
}

export function validateFirebaseAndroidConfig(value) {
  if (!isRecord(value) || hasPrivateMaterial(value)) invalid('FIREBASE_CLIENT_CONFIG_INVALID');
  if (value.project_info?.project_id !== expected.projectId || value.project_info?.project_number !== expected.senderId ||
      !Array.isArray(value.client)) invalid('FIREBASE_ANDROID_PROJECT_MISMATCH');
  const clients = value.client.filter(client => client?.client_info?.android_client_info?.package_name === expected.androidPackage);
  if (clients.length !== 1 || clients[0].client_info.mobilesdk_app_id !== expected.androidAppId)
    invalid('FIREBASE_ANDROID_APP_MISMATCH');
  const apiKey = clients[0].api_key?.[0]?.current_key;
  if (typeof apiKey !== 'string' || !/^AIza[\w-]{35}$/.test(apiKey)) invalid('FIREBASE_ANDROID_API_KEY_INVALID');
  return { projectId: expected.projectId, appId: expected.androidAppId, packageName: expected.androidPackage };
}

export function validateWebPushPublicKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(value)) invalid('FIREBASE_VAPID_PUBLIC_KEY_INVALID');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 65 || bytes[0] !== 4 || bytes.toString('base64url') !== value) invalid('FIREBASE_VAPID_PUBLIC_KEY_INVALID');
  try { ECDH.convertKey(bytes, 'prime256v1', undefined, undefined, 'uncompressed'); }
  catch { invalid('FIREBASE_VAPID_PUBLIC_KEY_INVALID'); }
  return value;
}

async function checkFile(path, validate, parse = JSON.parse) {
  try { validate(parse(await readFile(path, 'utf8'))); return 'verified'; }
  catch (error) {
    if (error?.code === 'ENOENT') return 'missing';
    // Fixed codes only: never print paths, file contents, keys or parser errors.
    return error instanceof Error && /^FIREBASE_[A-Z_]+$/.test(error.message) ? error.message : 'invalid';
  }
}

export async function checkFirebaseSetup() {
  const [web, android, webPushPublicKey] = await Promise.all([
    checkFile(resolve(root, '.local-firebase/web-config.json'), validateFirebaseWebConfig),
    checkFile(resolve(root, '.local-firebase/google-services.json'), validateFirebaseAndroidConfig),
    checkFile(resolve(root, '.local-firebase/web-push-public-key.txt'), validateWebPushPublicKey, value => value.trim()),
  ]);
  // Configuration intake only; no imports of Firebase, network calls, credential
  // generation, permission prompts, resource provisioning or ledger writes.
  return { projectId: expected.projectId, web, android, webPushPublicKey,
    trustedSender: 'keyless Preview plan applied; live exchange checked separately', pushDelivery: 'client/server integration implemented; physical delivery requires verification' };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(await checkFirebaseSetup(), null, 2));
}
