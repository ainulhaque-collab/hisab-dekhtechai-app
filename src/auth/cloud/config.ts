export const NATIVE_CLOUD_CALLBACK = 'com.hisabdekhtechai.app://auth/callback';
export const CLOUD_CALLBACK_PATH = '/auth/callback';
const PROJECT = /^[a-z]{20}$/;

export interface CloudAuthConfig {
  projectUrl: string;
  publishableKey: string;
  redirectTo: string;
  storageKey: string;
}

/** Explicit rollout boundary. Never infer configuration from a token or callback URL. */
export function cloudAuthConfig(input: {
  enabled?: string; projectUrl?: string; publishableKey?: string;
  webOrigin: string; android: boolean;
}): CloudAuthConfig | null {
  if (input.enabled !== 'true') return null;
  const url = new URL(input.projectUrl || '');
  const ref = url.hostname.split('.')[0];
  if (!PROJECT.test(ref) || url.origin !== `https://${ref}.supabase.co` ||
      url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(input.publishableKey || '')) {
    throw new Error('CLOUD_AUTH_CONFIG');
  }
  const origin = new URL(input.webOrigin);
  const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((!local && origin.protocol !== 'https:') || origin.origin !== input.webOrigin || origin.username || origin.password) {
    throw new Error('CLOUD_AUTH_CONFIG');
  }
  return {
    projectUrl: url.origin, publishableKey: input.publishableKey!,
    redirectTo: input.android ? NATIVE_CLOUD_CALLBACK : `${origin.origin}${CLOUD_CALLBACK_PATH}`,
    storageKey: `hisab-cloud-auth-v1-${ref}`,
  };
}

/** Only authorization-code callbacks; implicit tokens, foreign origins and fragments fail closed. */
export function readCloudCallback(raw: string, redirectTo: string): { code: string } {
  if (raw.length > 4096) throw new Error('CLOUD_CALLBACK_INVALID');
  const actual = new URL(raw), expected = new URL(redirectTo);
  if (actual.protocol !== expected.protocol || actual.host !== expected.host || actual.pathname !== expected.pathname ||
      actual.username || actual.password || actual.hash) throw new Error('CLOUD_CALLBACK_INVALID');
  const keys = [...actual.searchParams.keys()];
  if (actual.searchParams.has('error')) throw new Error('CLOUD_SIGN_IN_CANCELLED');
  const code = actual.searchParams.get('code');
  if (keys.length !== 1 || !code || !/^[A-Za-z0-9_-]{8,2048}$/.test(code)) throw new Error('CLOUD_CALLBACK_INVALID');
  return { code };
}
