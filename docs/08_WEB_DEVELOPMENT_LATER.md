# 08 — WEB APP DEVELOPMENT (ONLY AFTER ANDROID IS COMPLETE)

## 1. Entry conditions
Begin Web implementation automatically **once** Android signed beta/release tests PASS; do not begin before: correct offline finance engine, Drive↔two-Android sync, data-safe upgrades, account-binding, conflict handling, Play release preparations and stable shared operation protocol.

## 2. Product
- Web App accessible on smartphone/desktop browsers by HTTPS. **No native Windows desktop app**.
- Same minimal blue/white Bangla-first UI, shared React domain and shared finance/sync-core code.
- Customer uses **Continue with Google**. Developer has already configured Google Cloud; adds Web OAuth client and verified domains/origins once.
- Browser IndexedDB stores offline copies (after first login); not as durable as Android app-private SQLite if user clears browser data, Private Browsing exits or browser evicts data.
- Same user's Google Drive `appDataFolder` is cloud carrier. Before implementing, prove Web OAuth client can access the exact same app-data storage as Android with the same Google owner. If this fails, STOP and propose a verified alternative with minimum scopes and user consent.

## 3. Web differences
| Concern | Android | Web |
|---|---|---|
| Local store | Private native SQLite | IndexedDB with versioned migrations |
| Shell | Capacitor-installed app | Browser / optional installable PWA |
| Identity | Native Google identity/authorization | Google Identity Services OAuth token model |
| Drive API | Native Drive client with token | Scoped HTTPS API calls while authorized |
| Background sync | OS worker best-effort | Foreground tab only unless proven otherwise |
| Offline use | Reliable after setup, subject to local storage | Cached app shell and IndexedDB, subject to browser storage policies |
| Updates | Signed app + schema migrations | Deploy new JS + IndexedDB schema migration; protect against old tab concurrent migration |
| Storage protection | Android sandbox, device OS encryption | browser profile protection; XSS/CSP critical |

## 4. Web implementation stages
**W0 Preparation:** duplicate Android golden fixtures, cross-client Google Drive identity proof, define supported browsers and minimum storage requirements.  
**W1 UX & local store:** responsive layouts, same 5 nav tabs on mobile, desktop sidebar, accessible forms, IndexedDB adapter with all repository contracts and integer money precision.  
**W2 Google Identity and Drive:** GIS authorization/scopes, handle token expiry/reconsent, same `ownerHash` derivation and appDataFolder op protocol, real Android↔Web reconciliation.  
**W3 Offline/PWA:** service worker precache minimal app shell, IndexedDB persistence attempt and quota handling, feature detection, storage-clear warning, pending changes UI, no cloud promises while tab closed.  
**W4 QA:** Android/Web data parity; two browsers offline/concurrent; revoked consent, reinstall app, old tab/new tab update and IndexedDB migration, XSS/CSP, restore from Drive.  
**W5 Deploy:** choose static HTTPS host/domain, Google OAuth verified origins/redirects and privacy policy; build and deploy preview, owner approval and then production release.

## 5. Web Auth details
- Do not assume a Google ID token grants Drive access. Obtain OAuth access token for requested Drive scope via GIS and adhere to Google's user gesture/consent rules. Avoid storing access token in persistent JS `localStorage` or IndexedDB.
- Browser closed ⇒ no guaranteed pull/push; pending offline records sync next permitted active session.
- Multiple tabs require a leader/lock (e.g., browser locking strategy) and transactionally idempotent merge; do not let two tabs upload same op without safe dedupe.
- Never use same `device_id` or SQLite local identity on separate browser profiles. Each installation/browser profile has its own random device ID and monotonic sequence.

## 6. Web deployment security
- HTTPS, trusted static asset hosting, restrictive Content Security Policy, secure dependencies, no third-party finance data analytics, strict DOM XSS defense and safe exported CSV formula escaping.
- `Cache-Control` for app shell/versioning; avoid service worker activation replacing a running form without saving input.
- Upgrade DB before app begins writes; if upgrade is blocked by older tabs, show user guidance rather than wiping IndexedDB.

## 7. Web acceptance
- Android A records income offline, syncs → browser signs in and sees the record.
- Browser B records expense offline, later syncs → Android A sees change after next sync.
- Account balance/journal counts and SHA/operation IDs match golden fixtures. Duplicates and conflicts handled identically on both.
- Browser logout/account switch doesn't show old owner's cached finance.
- Browser reload, update, low storage and authorization expiry never silently lose local saved changes.
