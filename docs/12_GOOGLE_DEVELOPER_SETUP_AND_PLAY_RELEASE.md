# 12 — GOOGLE CLOUD DEVELOPER SETUP & PLAY STORE RELEASE CHECKLIST

> **Only the APP DEVELOPER / OWNER does these one-time actions. Individual customers do NOT touch Google Cloud, API keys or OAuth configuration.** Google will still show required account picker and authorization consent.

## Part A — Google account & API integration setup
1. Sign into the official Google Cloud Console with the developer's project/account. Create a dedicated Google Cloud project for `Hisab DekhteChai` — **not** linked to any existing unrelated business production system.
2. Configure Google Auth Platform consent/branding/app name, support contact, authorized domain(s), developer contact and requested user data scope. During test, use test audience/authorized test users as applicable.
3. Enable **Google Drive API** for this project. Keep minimum scope: `https://www.googleapis.com/auth/drive.appdata`; use `openid`, necessary basic profile scope for identity according to verified implementation. Avoid broad `drive` scope.
4. Create **Android OAuth client** using final application ID and correct SHA fingerprint(s). Separate debug certificate SHA and Google Play App Signing release SHA. A debug build working does **not** prove Play release build will sign in.
5. Create Google identity client IDs needed for Credential Manager; the Android Google sign-in API commonly uses a **Web client ID as `serverClientId`** even when Android is app target. Follow current Google official integration guide, not an unverified legacy library.
6. Native Android: use Google Credential Manager for account identity and Google `AuthorizationClient` for Drive data authorization. Keep identity and Drive token tied to the **same user**. If separate tokens are involved, obtain a reliable Google account-subject binding from appropriately authorized Google SDK/OIDC APIs; never trust email text or a locally decoded unsigned token alone. Without a backend, document local identity-security limitations instead of claiming server-side token verification.
7. Before Web development, create a Web OAuth client in the same intended project with appropriate authorized HTTPS origins. Use Google Identity Services for browser tokens; prove shared Drive app-data area as a formal test.
8. Complete external-brand / OAuth verification when required by Google for production and requested scope. No customer should see internal test-app limitations in general release.
9. Store API credentials safely. Public OAuth client IDs may be in app; **client secrets/private signing keys/refresh tokens never in mobile or JavaScript bundles**.

**Useful official pages:**
- Google sign-in for Android: https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
- Google account data authorization: https://developers.google.com/android/reference/com/google/android/gms/auth/api/identity/AuthorizationClient
- Drive API scope and consent: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Drive appDataFolder: https://developers.google.com/workspace/drive/api/guides/appdata
- GIS Web OAuth token: https://developers.google.com/identity/oauth2/web/guides/use-token-model

## Part B — Production Google identity edge cases
| Case | Required behavior |
|---|---|
| Customer has many Google accounts | explicit account selection; link same selected account to Drive access |
| Customer denies Drive scope | local use if already initialized; no false synced label |
| Customer signs in with another Google account | isolate local datasets; confirmation before switching |
| Google Account inaccessible | cached Android owner may continue locally if identity unlocked; cloud requires authorization |
| New device without Internet | cannot finish Google-only first setup; show guidance |
| Another client ID opens same Drive user | integration test file list, owner-binding and scope; never assume until tested |

## Part C — Play Store preparations
1. Reserve unique application ID, logo, screenshots, branding and app icon. Avoid infringing existing app's trade dress/name.
2. Configure release AAB and signing keys; use Google Play App Signing and store developer signing credentials securely. Never change package ID or signing lineage arbitrarily after first release.
3. Confirm current Google Play Target API. **As of 2026-10-22:** new apps/updates target Android 16 **API level 36** or higher for typical phone apps, subject to official exceptions; recheck on publication date.
4. Write accurate English/Bangla Privacy Policy; explain local DB, owner's hidden Drive app data, OAuth scopes, possible loss of unsynced changes, deletion and support.
5. Complete Play Data Safety form based on actual app behavior. Financial data, customer Google ID and sync data must not be obscured. Review Google API User Data Policy.
6. Use internal test track for smoke tests and permitted developer testing, then applicable closed-test requirement. For **newly-created Personal Google Play developer accounts**, public guidance requires **at least 12 testers continuously opted into closed test for 14 days** before production eligibility; verify account-specific applicability.
7. Test AAB from **Play internal track** with actual release signing, **not only a debug APK**. Confirm Google sign-in, Drive authorization, offline update preservation and cloud restore.
8. Pre-launch report review, crash-free regression and owner go-live approval. Gradual production rollout with monitoring and safe forward-fix plan; schema upgrades aren't trivially rolled back by publishing an older APK.
9. Only the owner authorizes actual public release.

## Part D — Never ask a customer to do this
- Create Google Cloud project, turn on API, paste API key, get OAuth token manually, share Drive folder by hand, configure a webhook URL, create Recovery Key, install Supabase/Firebase, subscribe to a paid technical service.
