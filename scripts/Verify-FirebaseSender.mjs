import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** Opt-in preview build check. No ledger access or FCM message calls. */
export async function verifyFirebaseSenderBuild(environment = process.env, exchange) {
  if (environment.PUSH_VERIFY_IDENTITY_ON_BUILD !== 'true') return 'PUSH_IDENTITY_CHECK_SKIPPED';
  if (environment.VERCEL_ENV !== 'preview') throw new Error('PUSH_PREVIEW_ONLY');
  const getToken = exchange || (await import('../server/notifications/keylessIdentity.mjs')).getFirebaseSenderAccessToken;
  const token = await getToken({ environment: environment.VERCEL_ENV });
  if (typeof token !== 'string' || !token.length) throw new Error('PUSH_IDENTITY_UNAVAILABLE');
  // Only a fixed success code escapes this function, never the short-lived token.
  return 'PUSH_KEYLESS_IDENTITY_VERIFIED';
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(await verifyFirebaseSenderBuild()); }
  catch (error) {
    const code = error instanceof Error && ['PUSH_PREVIEW_ONLY', 'PUSH_OIDC_BOUNDARY_INVALID', 'PUSH_IDENTITY_API_DISABLED',
      'PUSH_IDENTITY_BILLING_REQUIRED', 'PUSH_IDENTITY_ASSERTION_REJECTED', 'PUSH_IDENTITY_PROVIDER_INVALID',
      'PUSH_IDENTITY_PERMISSION_DENIED'].includes(error.message)
      ? error.message : 'PUSH_IDENTITY_UNAVAILABLE';
    console.error(code);
    process.exitCode = 1;
  }
}
