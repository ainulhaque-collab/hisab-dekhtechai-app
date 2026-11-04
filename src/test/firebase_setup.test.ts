import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { validateFirebaseWebConfig, validateFirebaseAndroidConfig, validateWebPushPublicKey } from '../../scripts/Check-FirebaseSetup.mjs';

const apiKey = `AIza${'x'.repeat(35)}`;
const web = { apiKey, projectId: 'hisab-dekhtechai-notifications', messagingSenderId: '706081957087',
  appId: '1:706081957087:web:2966864dcc99f41b77356a' };
const android = { project_info: { project_id: web.projectId, project_number: web.messagingSenderId },
  client: [{ client_info: { mobilesdk_app_id: '1:706081957087:android:6d89a6f1696eab6b77356a',
    android_client_info: { package_name: 'com.hisabdekhtechai.app' } }, api_key: [{ current_key: apiKey }] }] };

test('notification Web intake rejects a different Firebase project or another app in this project', () => {
  for (const field of ['projectId', 'messagingSenderId', 'appId'])
    assert.throws(() => validateFirebaseWebConfig({ ...web, [field]: 'other' }), /PROJECT_MISMATCH/);
  assert.equal(validateFirebaseWebConfig({ ...web, measurementId: 'optional' }).projectId, web.projectId);
  assert.equal('measurementId' in validateFirebaseWebConfig({ ...web, measurementId: 'optional' }), false);
});
test('private sender credentials cannot be mistaken for Android or Web client configuration', () => {
  for (const validate of [validateFirebaseWebConfig, validateFirebaseAndroidConfig])
    for (const value of [null, [], { ...web, type: 'service_account' }, { ...android, nested: { private_key: 'secret' } },
      { ...web, nested: ['-----BEGIN PRIVATE KEY-----'] }])
      assert.throws(() => validate(value), /CLIENT_CONFIG_INVALID/);
});
test('Android intake requires the exact release package and app ID, without accepting duplicate clients', () => {
  assert.equal(validateFirebaseAndroidConfig(android).packageName, 'com.hisabdekhtechai.app');
  const other = structuredClone(android);
  other.client[0].client_info.android_client_info.package_name += '.debug';
  assert.throws(() => validateFirebaseAndroidConfig(other), /APP_MISMATCH/);
  assert.throws(() => validateFirebaseAndroidConfig({ ...android, client: [...android.client, ...android.client] }), /APP_MISMATCH/);
  const oldApp = structuredClone(android);
  oldApp.client[0].client_info.mobilesdk_app_id = 'other';
  assert.throws(() => validateFirebaseAndroidConfig(oldApp), /APP_MISMATCH/);
});
test('malformed client key errors never include the supplied credential', () => {
  const secret = 'not-a-firebase-client-key';
  assert.throws(() => validateFirebaseWebConfig({ ...web, apiKey: secret }), error =>
    error instanceof Error && error.message === 'FIREBASE_WEB_API_KEY_INVALID' && !error.message.includes(secret));
});
test('Web push intake accepts only a canonical uncompressed P-256 public key', () => {
  const point = createECDH('prime256v1').generateKeys().toString('base64url');
  assert.equal(validateWebPushPublicKey(point), point);
  for (const value of ['', `${point}=`, 'secret', Buffer.alloc(65).toString('base64url'), Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url')])
    assert.throws(() => validateWebPushPublicKey(value), /VAPID_PUBLIC_KEY_INVALID/);
});
