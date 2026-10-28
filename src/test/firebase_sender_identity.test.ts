import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPreviewSenderClaims, firebaseSenderCredentialOptions, getFirebaseSenderAccessToken } from '../../server/notifications/keylessIdentity.mjs';
import { verifyFirebaseSenderBuild } from '../../scripts/Verify-FirebaseSender.mjs';

const now = 1_800_000_000;
const claims = { iss: 'https://oidc.vercel.com/ainulhaque-collab', aud: 'https://vercel.com/ainulhaque-collab',
  sub: 'owner:ainulhaque-collab:project:hisab-dekhtechai-app:environment:preview', environment: 'preview',
  owner_id: 'team_GtyIJ90B2vhl4tLHJkuyyamQ', project_id: 'prj_3zLhTBZiE6SUBr05SjmxA57sq4bC',
  exp: now + 600, iat: now - 60, nbf: now - 60 };
const fixture = (overrides: Record<string, unknown> = {}, alg = 'RS256') =>
  [JSON.stringify({ alg }), JSON.stringify({ ...claims, ...overrides }), 'synthetic-signature'].map(s => Buffer.from(s).toString('base64url')).join('.');

test('sender admission excludes production, other team/project, issuer and audience before STS exchange', () => {
  assert.doesNotThrow(() => assertPreviewSenderClaims(fixture(), now));
  for (const field of ['iss', 'aud', 'sub', 'environment', 'owner_id', 'project_id'])
    assert.throws(() => assertPreviewSenderClaims(fixture({ [field]: 'other' }), now), /PUSH_OIDC_BOUNDARY_INVALID/);
  assert.throws(() => assertPreviewSenderClaims(fixture({}, 'none'), now), /BOUNDARY_INVALID/);
  assert.throws(() => assertPreviewSenderClaims('not-a-jwt', now), /BOUNDARY_INVALID/);
});
test('sender admission rejects expired, near-expiry, future and invalid token times', () => {
  for (const override of [{ exp: now }, { exp: now + 59 }, { iat: now + 31 }, { nbf: now + 31 }, { exp: 'later' }])
    assert.throws(() => assertPreviewSenderClaims(fixture(override), now), /BOUNDARY_INVALID/);
});
test('credential config pins Google endpoints, exact account/provider, 10-minute lifetime and only messaging scope', () => {
  const options = firebaseSenderCredentialOptions();
  assert.equal(options.audience, '//iam.googleapis.com/projects/706081957087/locations/global/workloadIdentityPools/hisab-vercel-preview/providers/vercel-preview');
  assert.equal(options.service_account_impersonation_url, 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/hisab-preview-push@hisab-dekhtechai-notifications.iam.gserviceaccount.com:generateAccessToken');
  assert.equal(options.token_url, 'https://sts.googleapis.com/v1/token');
  assert.deepEqual(options.scopes, ['https://www.googleapis.com/auth/firebase.messaging']);
  assert.equal(options.service_account_impersonation.token_lifetime_seconds, 600);
  assert.equal('private_key' in options, false);
});
test('token supplier obtains current-context token per exchange and rejects wrong claims', async () => {
  const current = Math.floor(Date.now() / 1000);
  const good = fixture({ exp: current + 600, iat: current - 60, nbf: current - 60 });
  let calls = 0;
  const options = firebaseSenderCredentialOptions(async () => { calls++; return calls === 1 ? good : fixture({ environment: 'production' }); });
  assert.equal(await options.subject_token_supplier.getSubjectToken(), good);
  await assert.rejects(options.subject_token_supplier.getSubjectToken(), /BOUNDARY_INVALID/);
  assert.equal(calls, 2);
});
test('identity wrapper refuses local/production use and never forwards SDK credential details', async () => {
  let called = 0;
  const createClient = (() => { called++; return { getAccessToken: async () => { throw new Error('credential secret from SDK'); } }; }) as any;
  for (const environment of [undefined, 'development', 'production'])
    await assert.rejects(getFirebaseSenderAccessToken({ environment, createClient }), /PUSH_PREVIEW_ONLY/);
  assert.equal(called, 0);
  await assert.rejects(getFirebaseSenderAccessToken({ environment: 'preview', createClient }), error =>
    error instanceof Error && error.message === 'PUSH_IDENTITY_UNAVAILABLE');
  for (const [response, expected] of [
    [{ data: { error: { details: [{ reason: 'SERVICE_DISABLED' }] } } }, 'PUSH_IDENTITY_API_DISABLED'],
    [{ data: { error: { details: [{ reason: 'BILLING_DISABLED' }] } } }, 'PUSH_IDENTITY_BILLING_REQUIRED'],
    [{ data: { error: 'invalid_grant' } }, 'PUSH_IDENTITY_ASSERTION_REJECTED'],
    [{ data: { error: 'invalid_target' } }, 'PUSH_IDENTITY_PROVIDER_INVALID'],
    [{ status: 403 }, 'PUSH_IDENTITY_PERMISSION_DENIED'],
  ] as const) {
    await assert.rejects(getFirebaseSenderAccessToken({ environment: 'preview', createClient: (() => ({
      getAccessToken: async () => { throw Object.assign(new Error('private credential detail'), { response }); },
    })) as any }), error => error instanceof Error && error.message === expected);
  }
});
test('build probe makes no calls by default, requires preview, and returns no token', async () => {
  let called = 0;
  const exchange = async () => { called++; return 'synthetic-private-token'; };
  assert.equal(await verifyFirebaseSenderBuild({}, exchange), 'PUSH_IDENTITY_CHECK_SKIPPED');
  await assert.rejects(verifyFirebaseSenderBuild({ PUSH_VERIFY_IDENTITY_ON_BUILD: 'true', VERCEL_ENV: 'production' }, exchange), /PREVIEW_ONLY/);
  assert.equal(called, 0);
  assert.equal(await verifyFirebaseSenderBuild({ PUSH_VERIFY_IDENTITY_ON_BUILD: 'true', VERCEL_ENV: 'preview' }, exchange), 'PUSH_KEYLESS_IDENTITY_VERIFIED');
  assert.equal(called, 1);
});
