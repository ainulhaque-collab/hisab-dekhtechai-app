# Web Admin, redeem periods and managed AI keys

Owner request: a separate Web-only Admin accepts the owner's Gemini key and controls access for manually verified BDT1 payments/redeem subscriptions. Android remains the customer product. A future OpenAI adapter can share the existing extraction/guide contracts; OpenAI is not activated in this milestone.

## Implemented boundary

- `/admin` is a separate lazy Web route. Android cannot enter it. It does not mount `AppProvider`, open the financial database or upload financial records. A signed-in customer without the server-configured owner UUID receives no Admin API access.
- The server calls the configured Supabase Auth `/auth/v1/user` endpoint with the request JWT. It does not trust JWT payloads, cached sessions, `user_metadata`, browser role flags, email strings or phone numbers as authorization. Linked Google logins share the stable customer UUID and AI quota. The initial owner's UUID must be resolved from the owner's authoritative verified Auth account before activation; the primary email is not changed.
- Request credentials remain transient. Sign-out invalidates an in-flight request even when the same customer signs in again. AI consent uses the new customer service scope only when the rollout flag is enabled. No financial owner adoption, dataset relabelling, migration or journal write is added.
- The Admin issues cryptographically random, single-use 128-bit codes. Only a domain-separated digest is stored. The code is returned once, must be claimed within 30 days, and starts an admin-selected 1–3660-day period. Renewal adds to the remaining period. Lost issuance responses cannot reveal a saved plaintext code; issue another unused code. Blocked customers cannot consume a new code.
- Atomic PostgreSQL transactions, row/advisory locks and actor/payload-bound request IDs prevent concurrent double redemption, duplicated renewal and cross-customer request replay. Admin manual grants and app-specific block/unblock never modify shared Supabase Auth users. The owner cannot block themself.
- Every customer-mode AI request checks current server entitlement before reserving quota or calling the provider. Blocked, expired or unconfigured access fails closed. Owner service access is retained for operation/recovery, within the same AI usage limits. Enabling the access backend with legacy Google AI auth disables AI rather than creating a bypass.
- Key input is password-masked and cleared on submission/account changes. AES-256-GCM uses a separate 32-byte server wrapping key, fresh nonce, authentication tag and provider/revision AAD. PostgreSQL stores ciphertext only. Status responses contain configured/enabled/model/revision/time, never the key or suffix. Provider rotation uses an expected revision; disable/rotation is checked on the next request. In-flight generations cannot be recalled. There is no fallback to an old environment key in customer mode, no arbitrary provider URL and no automatic chargeable retry.
- Access API rate counters are durable, bounded to one row/customer plus a global row, and separate from chargeable AI quota. Responses use fixed safe errors, exact CORS, JSON limits and no-store. Audit entries contain actor/subject IDs and fixed action names, no keys, codes, receipt contents or financial records.

## SQL and deployment controls

Canonical portable SQL: `server/access/migrations/001-access.sql`. It creates only the private `hisab_access` namespace and a new **NOLOGIN** `hisab_access_preview` role. RLS is enabled on all six tables. No anonymous/authenticated/shared service-role grants or policies are added. The dedicated role gets only required table/sequence operations, no delete/DDL/finance access. A pre-existing role/schema is not silently reused or modified. Applying this portable SQL to the shared Supabase host requires a CLI-generated tracked host migration and inspection/review of existing objects first; no runtime DDL.

The hosted runtime refuses a project-owner/superuser/BYPASSRLS/CREATEDB/CREATEROLE database login. It requires `hisab_access_preview` and verified TLS. A dedicated restricted pooled connection and its credentials must be prepared securely before activation. Never use a Supabase service key or a browser `VITE_*` variable for database/provider/wrapping credentials.

Branch-scoped Preview configuration, all default off:

| Variable | Meaning |
| --- | --- |
| `ACCESS_ENABLED=true` | Mount the configured Preview access service |
| `AI_AUTH_MODE=supabase` | Require verified-customer AI auth and entitlement |
| `VITE_CUSTOMER_ACCESS_ENABLED=true` | Show customer redeem UI and use customer AI identity |
| `VITE_SUPABASE_AUTH_ENABLED=true` | Existing verified customer login |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Server Auth endpoint and public project key |
| `ACCESS_ADMIN_CUSTOMER_ID` | Stable, verified owner UUID; not an email |
| `ACCESS_DATABASE_URL` | Sensitive dedicated-role pooled DB URL, verified TLS |
| `AI_VAULT_WRAPPING_KEY` | Sensitive random 32-byte hexadecimal server wrapping key |

Existing AI budget Redis pair and approved exact origins remain required. Keep server/client rollout settings aligned and scoped to the new Preview branch. Do not move existing customer aliases or enable Production. An authenticated Admin login callback for the new Preview origin must be reviewed before saving it to shared Auth. Enter the real Gemini key through the protected Admin after deployment; no key belongs in chat, Git or Notion.

Recovery: preserve the wrapping key separately from the SQL dump. Rotating the Gemini API key is implemented. Rotating the wrapping key itself needs an explicit decrypt/re-encrypt migration; do not simply replace it. Losing a wrapping key requires the owner to enter a fresh Gemini key; it must never affect financial records. Code redemption history, grants and blocks need a private schema dump/restore rehearsal before any real subscription is issued. Do not drop tables or disable access while grants are active as a rollback shortcut.

## Evidence and open gates

Local TypeScript, full suite (395 tests: 394 pass, one existing native-only skip), bundle and compiled Node ESM AI/access adapters pass. Access-specific tests cover encryption/tamper/wrong-key/revision handling, verified UUID identity, cross-user denial, code expiry/replay/blocked-customer rollback, RLS default-deny, key rotation/disable, quota separation, fixed safe HTTP errors and sign-out fencing. Native PostgreSQL concurrency is added to CI and must pass separately.

Browser evidence uses disposable loopback synthetic-only Auth fixtures and a real PGlite access store, not real customer data: Admin key save returns configured status with an emptied input; issuance creates a code; customer redemption displays active access and its expiry. No provider generation or charge was made. A browser-native confirmation blocked the automation; it was replaced with inline readable confirmation. Visual acceptance of the replacement, compact mobile Admin layout, real Google-to-Admin login, hosted role/secret configuration, private access-schema dump/restore and native customer acceptance remain open. Do not label these live/production PASS.

This milestone gates **AI only**. The broader approved subscription policy (own-record view/export retained; new ledger writes stopped after expiry/block; signed offline lease up to seven days/remaining period) still needs its own ledger command guards, signed-lease/clock-rollback tests and acceptance before selling app-wide subscriptions. No UI-only flag claims to enforce offline ledger access. Existing push/inbox identity migration is separate and remains unchanged to avoid losing bindings/history. Existing Google/legacy API deployment is not a new production subscription endpoint.

Installed owner-accepted Android remains `1.0.24-rc4/code25`, source `94bea38`. No APK replacement, uninstall, data clear, new Android permissions, financial SQL migration/upload, Google Drive work, Production change, paid service or real customer entitlement is part of the verification above.
