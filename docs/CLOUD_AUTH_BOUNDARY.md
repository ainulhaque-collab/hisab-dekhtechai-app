# Supabase Auth adapter — staged Phase 2

This is an implemented adapter boundary, **not an activated app login or proof
of successful owner Google sign-in**. AppProvider does not import it; rollout
remains disabled. No local financial record, legacy owner, pending Drive
operation, Firebase identity or financial cloud authority changes.

## Implementation

- `src/auth/cloud/config.ts`: explicit rollout, modern publishable key only,
  exact Web/native code callbacks. No implicit token fragments or foreign URLs.
- `cloudAuth.ts`: pinned Supabase JS 2.118.0, S256 PKCE with explicit flow ID,
  ten-minute one-use pending flow, current-session replacement rejection, Auth
  HTTP getUser verification, expected-UUID account fence, refresh and logout.
  Email/user_metadata never authorize or link a dataset. Tokens are not exposed
  by the adapter API. Auth fetch is origin-bound, timed and refuses redirects.
- `secureStorage.ts`: AES-GCM, non-extractable Web Crypto key, fresh IV and
  origin/project/key AAD. Key+ciphertext commit together in separate IndexedDB.
  No plaintext localStorage or in-memory persistence fallback. This protects
  stored bytes, not a compromised same-origin script. Refresh sessions outlive
  the access token until revoked/expired by Auth.
- `nativeStorage.ts` / `CloudSessionVaultPlugin.java`: AndroidKeyStore AES-GCM,
  package/key AAD, fresh IV and atomic private-preferences commits. Existing
  allowBackup=false stays. Missing bridge/key/storage fails closed. Capacitor
  credential bridge logging is disabled, including debug builds.
- `platform.ts`: external Browser, App cold/warm callbacks, duplicate-intent
  suppression, foreground/background refresh. Web strips code URL before any
  exchange. Callback HTML is no-store; no-referrer prevents code-bearing links
  being sent as referrers to third-party resources.

The SDK flow ID stays in encrypted pending state and explicitly selects its
local verifier during exchange. Only one outstanding login is allowed; cancel
via local logout before starting another. The optional SDK query parameter is
disabled: hosted Auth matches the whole redirect URL against its allowlist, so
appending a dynamic query rejects an exact entry and falls back to this shared
project's unrelated Site URL. Tests assert a query-free SDK redirect and verify
the actual S256/token exchange. No custom OAuth protocol replaces the SDK.

Native callback: `com.hisabdekhtechai.app://auth/callback`. Manifest uses
`${applicationId}` so the separately installed .debug APK cannot claim release
callbacks. The staged factory refuses Auth activation in that debug package.
App plugin's default back handler is disabled to preserve MainActivity's existing
modal-aware back navigation.

Logout fences pending callbacks/refresh writes and clears encrypted credentials.
serverRevoked=false reports failed remote revocation accurately. Access tokens
may remain valid until expiry; local logout is not every-device global logout.

## Shared project and activation

Google is already enabled in owner-selected project sfzitbasxrpmtmldujbm. The
logged-in dashboard shows four existing redirects and an unrelated Site URL.
None was changed. The additive proposal is
`config/supabase-auth-preview.plan.json`; it contains no credential.
Security-sensitive browser redirect changes need owner action-time confirmation.
No wildcard, Site URL/provider secret replacement, API schema exposure, Preview
protection change, paid resource or Production callback is proposed.

Fifteen deterministic tests use the **real pinned SDK with synthetic Auth HTTP
responses**: exact PKCE digest/callbacks, tampering/origin swap, reload, refresh,
duplicate/expired/concurrent flows, account mismatch, forged metadata, concurrent
expected-user checks, unavailable logout/storage, logout during token response
and an already-dispatched native storage write racing logout.
These are not real Google sign-in, browser IndexedDB or hardware Keystore
acceptance. Run `node --import tsx --test src/test/cloudAuth.test.ts`, full tests,
browser/API types, Web build, compiled API runtime and Android build.

Before mounting: reviewed migration/onboarding UI, approved redirects, real
Web/permanent-key Android Google login/reload/logout, hardware vault and cold
callback acceptance. Before financial cutover: server-verified legacy Google
subject to Supabase UUID mapping, recovery snapshot, explicit migration manifest,
durable cursor sync and cross-device restore. Never enable a flag or claim
cloud recovery from these adapter tests alone. AI/FCM/Admin currently expect
Google tokens and need a coordinated later identity transition.

Official references reviewed:
- https://supabase.com/docs/reference/javascript/auth-signinwithoauth
- https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession
- https://supabase.com/docs/guides/auth/server-side/advanced-guide
- https://capacitorjs.com/docs/apis/app
- https://capacitorjs.com/docs/apis/browser
- https://developer.android.com/privacy-and-security/keystore
- https://github.com/supabase/auth/blob/master/internal/utilities/request.go
