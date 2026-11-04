import { ExternalAccountClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
import senderPlan from '../../config/firebase-sender-preview.plan.json' with { type: 'json' };

export const FIREBASE_SENDER_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const fail = code => { throw new Error(code); };

function safeIdentityFailure(error) {
  const details = error?.response?.data?.error?.details;
  const reasons = Array.isArray(details) ? details.map(entry => entry?.reason) : [];
  if (reasons.includes('SERVICE_DISABLED')) return 'PUSH_IDENTITY_API_DISABLED';
  if (reasons.some(reason => ['BILLING_DISABLED', 'BILLING_NOT_ACTIVE'].includes(reason))) return 'PUSH_IDENTITY_BILLING_REQUIRED';
  const oauthError = error?.response?.data?.error;
  if (oauthError === 'invalid_grant') return 'PUSH_IDENTITY_ASSERTION_REJECTED';
  if (oauthError === 'invalid_target') return 'PUSH_IDENTITY_PROVIDER_INVALID';
  if (error?.response?.status === 403) return 'PUSH_IDENTITY_PERMISSION_DENIED';
  return 'PUSH_IDENTITY_UNAVAILABLE';
}

/** A local boundary check, NOT signature verification or end-user login.
 * Google STS verifies the actual signature, issuer, audience and provider CEL.
 * Never use these decoded claims as authorization without that exchange. */
export function assertPreviewSenderClaims(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    if (typeof token !== 'string' || token.length > 32768 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error();
    const [headerText, claimsText] = token.split('.');
    const header = JSON.parse(Buffer.from(headerText, 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(claimsText, 'base64url').toString('utf8'));
    if (header.alg !== 'RS256' || claims.iss !== senderPlan.provider.issuerUri ||
        claims.aud !== senderPlan.provider.allowedAudiences[0] ||
        claims.owner_id !== 'team_GtyIJ90B2vhl4tLHJkuyyamQ' ||
        claims.project_id !== 'prj_3zLhTBZiE6SUBr05SjmxA57sq4bC' || claims.environment !== 'preview' ||
        claims.sub !== 'owner:ainulhaque-collab:project:hisab-dekhtechai-app:environment:preview' ||
        !Number.isSafeInteger(claims.exp) || claims.exp < nowSeconds + 60 ||
        !Number.isSafeInteger(claims.iat) || claims.iat > nowSeconds + 30 ||
        !Number.isSafeInteger(claims.nbf) || claims.nbf > nowSeconds + 30 || claims.exp <= claims.iat) throw new Error();
  } catch { fail('PUSH_OIDC_BOUNDARY_INVALID'); }
}

export function firebaseSenderCredentialOptions(getSubjectToken = getVercelOidcToken) {
  const serviceAccount = `${senderPlan.serviceAccountId}@${senderPlan.projectId}.iam.gserviceaccount.com`;
  return {
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${senderPlan.projectNumber}/locations/global/workloadIdentityPools/${senderPlan.workloadIdentityPoolId}/providers/${senderPlan.provider.id}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateAccessToken`,
    service_account_impersonation: { token_lifetime_seconds: 600 },
    scopes: [FIREBASE_SENDER_SCOPE],
    transporterOptions: { timeout: 12000, retry: false },
    subject_token_supplier: {
      async getSubjectToken() {
        // Request-context SDK helper. Do not cache the Vercel token in a module
        // global, accept a caller-provided header, or use a static JSON key.
        const token = await getSubjectToken();
        assertPreviewSenderClaims(token);
        return token;
      },
    },
  };
}

/** Server-only token. No public route, token logging or notification send.
 * A new client binds each exchange to the current Vercel request/build context. */
export async function getFirebaseSenderAccessToken({ environment = process.env.VERCEL_ENV,
  getSubjectToken = getVercelOidcToken, createClient = ExternalAccountClient.fromJSON } = {}) {
  if (environment !== 'preview') fail('PUSH_PREVIEW_ONLY');
  try {
    const client = createClient(firebaseSenderCredentialOptions(getSubjectToken));
    if (!client) fail('PUSH_IDENTITY_UNAVAILABLE');
    const result = await client.getAccessToken();
    if (!result?.token || typeof result.token !== 'string') fail('PUSH_IDENTITY_UNAVAILABLE');
    return result.token;
  } catch (error) {
    if (error instanceof Error && error.message === 'PUSH_OIDC_BOUNDARY_INVALID') throw error;
    // SDK errors may contain request headers and credentials; never forward them.
    fail(safeIdentityFailure(error));
  }
}
