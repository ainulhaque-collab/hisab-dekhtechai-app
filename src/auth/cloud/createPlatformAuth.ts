import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { CloudAuth } from './cloudAuth';
import { cloudAuthConfig } from './config';
import { AndroidCloudStorage } from './nativeStorage';
import { EncryptedCloudStorage } from './secureStorage';

/** Used by account settings. Financial provider/adoption remains separately gated. */
export async function createPlatformCloudAuth(): Promise<CloudAuth | null> {
  const platform = Capacitor.getPlatform();
  const config = cloudAuthConfig({
    enabled: import.meta.env.VITE_SUPABASE_AUTH_ENABLED,
    projectUrl: import.meta.env.VITE_SUPABASE_URL,
    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    webOrigin: window.location.origin, android: platform === 'android',
  });
  if (!config) return null;
  if (!['android', 'web'].includes(platform)) throw new Error('CLOUD_PLATFORM_UNSUPPORTED');
  if (platform === 'android' && (await App.getInfo()).id !== 'com.hisabdekhtechai.app') {
    throw new Error('CLOUD_NATIVE_RELEASE_REQUIRED');
  }
  const storage = platform === 'android' ? new AndroidCloudStorage(config.storageKey)
    : new EncryptedCloudStorage(config.storageKey, window.location.origin);
  return CloudAuth.create(config, storage);
}
