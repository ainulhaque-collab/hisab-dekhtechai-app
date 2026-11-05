# Web Admin, redeem periods and managed AI keys

The owner requested a separate Web-only Admin for Gemini key management and AI access for redeem/subscription customers. Android remains the customer product. OpenAI retains the existing provider boundary; no OpenAI service is activated.

## Current behavior

- Admin is now an owner workspace with overview metrics, searchable/filterable customer rows, bulk selection, Gmail permission preparation, central AI settings, redeem codes and recent activity. The layout adapts to narrow screens; Admin has its own persisted light/dark preference and no native dropdowns. Reference: the owner's EcomDrive command center, inspected for navigation/management patterns only.
- The owner can prepare up to 50 email permissions per batch (6,000 characters), with a 1–3660 day duration. This sends no email and creates no shared Auth user. Both existing and new customers claim only on their next fresh server-verified Google connection/AI authorization. An existing period is extended; otherwise it starts then. No email string or cached directory contact can activate access by itself.
- Verified Google identity emails are a private contact directory, not financial ownership. The server accepts only `getUser()` identity entries with the same user UUID, provider `google` and `email_verified: true`. No metadata claim, client-supplied email, Gmail dot/plus guessing or shared `auth.users` scan is used. A changed verified contact label never moves an existing entitlement or ledger.
- One atomic claim per batch/customer prevents two linked Gmail identities or concurrent requests from adding the same period twice. A block prevents pending claims; unblocking does not invent a period. Pending individual grants can be cancelled before claim. Bulk block/unblock is atomic and refuses an owner block or unknown target. Request IDs are actor/payload-bound for all directory mutations. Customer lists/search, pending lists and recent events are bounded and owner-only.

- `/admin` is a lazy Web-only route. It does not mount `AppProvider`, initialize the financial database or upload financial records. Android cannot enter Admin. Google login returns to Admin through a one-time session hint, limited to the fixed `/admin` destination and ten minutes; it is never authorization evidence. Callback codes are removed from browser history before rendering.
- The server verifies the request JWT online with the configured Supabase Auth `/auth/v1/user` endpoint. JWT payloads, cached sessions, email strings, browser roles and `user_metadata` cannot grant access. The initial owner was bound to the authoritative, confirmed customer UUID of the already approved account. Linked Google identities share entitlement, Admin status and quota without changing the primary email.
- Request credentials remain transient. Sign-out invalidates in-flight handles even after login to the same UUID. The rollout flag changes AI service/consent scope only; it does not adopt or relabel financial ownership.
- Owner-only Admin saves/replaces/disables a Gemini key. Password input clears on submission or identity change. AES-256-GCM uses a separate server wrapping secret, random nonce and provider/revision AAD. SQL stores ciphertext only; read responses return configured/enabled/model/revision/time, never a key or suffix. Rotation uses an expected revision. Disable/rotation applies on the next request; an in-flight generation cannot be recalled. There is no old-key fallback or arbitrary provider endpoint.
- Codes are random 128-bit, single-use, returned once, stored only as a domain-separated digest, and claimable for 30 days. Admin selects 1–3660 days. First redemption starts the period; renewal extends the remaining period. Row/advisory locks and actor/payload-bound request IDs prevent concurrent double claims, duplicated renewal and cross-user replay. A blocked customer cannot consume a fresh code. A lost issuance response requires a new code; saved plaintext cannot be retrieved.
- Manual grants and app-specific blocks never modify shared Auth users. Owner self-block is rejected. AI checks current entitlement before quota/generation. Owner recovery/operation retains AI service access within the same quota. Access mode cannot be bypassed through legacy Google auth. Durable access request counters are separate from generation quota; no automatic paid generation retry.
- The UI explicitly describes the current gate as **AI access**. Broader app-wide subscription enforcement still requires ledger-write guards and a signed offline lease (up to seven days or the remaining period), while retaining own-record view/export. Do not sell this Preview as completed app-wide enforcement.
- Responses have exact CORS, JSON limits, no-store and fixed safe errors. Audit records contain fixed actions and actor/subject IDs, no codes, keys, media or financial records. Existing push/inbox bindings remain unchanged; their verified-customer migration is separate.

## Private SQL and scope

Portable SQL is under `server/access/migrations`. CLI-generated host migrations are under `supabase/migrations`; their filenames are aligned to actual applied host versions. The shared host is `sfzitbasxrpmtmldujbm`. Only `hisab_access` and the dedicated `hisab_access_preview` role were created. No finance/public/other-application table, Auth policy, SMS setting or primary email was modified.

All ten tables have RLS. No anon/authenticated/shared service-role grant was added. The role has only needed table/sequence privileges and no DDL/finance access. DELETE is restricted to the new contact snapshot table so unlinked contacts can be removed; financial, subscription, code, provider and audit rows cannot be deleted by the runtime. Existing audit constraints/rows are preserved; directory events use a new private table. Runtime refuses superuser, BYPASSRLS, CREATEDB, CREATEROLE or INHERIT connections and requires the exact role name. The role's live TLS connection was verified before secret upload.

Management provisioning helpers are invoker-privilege and denied to the runtime. The current helper returns **only public-key-encrypted recovery material and a checksum**. It never returns a live password/wrapping secret through MCP. Earlier management-only bootstrap forms were superseded; none was granted to customers. Do not invoke provisioning again after the current credentials are uploaded: it rotates the DB password. Optional final removal (`005-retire-preview-bootstrap.sql`) is tested locally but has not been applied to the host: its destructive-DDL confirmation expired. The remaining helper is inaccessible to the runtime; this cleanup is not required by normal Admin/AI requests. Do not label it retired until confirmed.

This Supabase project also hosts other applications. Never bulk-reset or blindly push/reconcile the shared migration history. Apply only reviewed, explicitly scoped Hisab migrations. Runtime never performs DDL.

## TLS

Supabase's shared pooler requires its official CA. `accessDatabaseConfig` adds that CA only for Supabase database hostnames and retains `rejectUnauthorized: true` and hostname verification. Other PostgreSQL hosts keep normal CA trust. No global trust-store, SSL-enforcement or network protection was weakened.

Public certificate: `config/certificates/supabase-prod-ca-2021.crt`, copied from the authenticated dashboard's exact download link. Its generated server constant supports emitted ESM without filesystem tracing assumptions. Fingerprint SHA-256: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`; expiry April 26, 2031. Tests verify the CA fingerprint, asset consistency and full TLS settings.

Official guidance: [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement), [database connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Secret handling and recovery

Automatic review rejected methods that embedded live credentials in command arguments/code or returned them to AI tool history. Do not repeat those methods or expose decrypted recovery data through MCP, stdout, arguments, chat or Notion.

The completed safe pipeline is:

1. `Create-PreviewRecoveryKey.mjs` generates a local RSA OpenPGP pair; the private key is protected with the owner's PowerShell 7/DPAPI context. Only its public key leaves the local process.
2. Management SQL generates a fresh DB password/wrapping secret and returns a public-key-encrypted record plus checksum only. Previous experimental credentials were rotated and are not active.
3. `.local-access-preview/credentials.pgp.json` is encrypted; `recovery-private-key.dpapi` is separately owner-protected. `Verify-PreviewRecovery.mjs` decrypts only in private local process memory and verifies the exact record hash/project/branch. It prints a fixed success marker, never secrets.
4. `Upload-PreviewAccessSecrets.mjs` verifies Vercel CLI identity/team/project, recovery, restricted DB role and full TLS, then sends the two values via private stdin directly to Vercel Sensitive storage. No `--value`/token flags or plaintext files. Child CLI output is not forwarded. A value-free receipt records only scope and verification booleans.

The private directory is outside build/worktrees, excluded in both Git local excludes and this branch's `.gitignore`. Do not commit, upload or delete it as cache. Operator OpenPGP dependency is isolated under `.local-tools/secret-backup` and pinned to 6.3.2; Vercel CLI is pinned to 65.11.0. These are not app dependencies. Use PowerShell 7; inheriting its module path into PowerShell 5 caused a failed backup, so that path is not accepted.

DPAPI recovery has been verified in the current Windows owner profile. An owner-controlled off-device/passphrase-protected recovery export remains a Production gate; this local verification does not claim recovery after loss of the entire Windows profile. Losing a wrapping key can require a fresh Gemini key; it must never affect financial records. Rotating a Gemini key is implemented; rotating a wrapping key requires an explicit decrypt/re-encrypt migration.

## Preview activation

Only branch `codex/verified-service-identity` in Vercel project `hisab-dekhtechai-app` is configured. `ACCESS_DATABASE_URL` and `AI_VAULT_WRAPPING_KEY` are Sensitive and Preview/branch scoped. Public rollout/configuration flags are also branch scoped. The server requires `AI_AUTH_MODE=supabase`, `ACCESS_ENABLED=true`, verified Auth project/public key, exact owner UUID, approved exact origins and the existing Redis generation budget. Client flags are `VITE_SUPABASE_AUTH_ENABLED=true` and `VITE_CUSTOMER_ACCESS_ENABLED=true`. Other branches/Production are not changed.

Approved Admin URL: `https://hisab-dekhtechai-app-git-codex-verifie-f9b531-ainulhaque-collab.vercel.app/admin`. Exactly its `/auth/callback` was appended to shared Auth; all seven old callbacks and Site URL were retained. Vercel project/alias protection remains enabled. Authenticated temporary connector inspection is limited to the owner-approved Preview and at most 23 hours.

Configuration changes require a new deployment. Current hosted acceptance/source/CI evidence is tracked in PR #19 and Notion; configuration existing is not proof that an older deployment is enabled. The owner enters the real Gemini key directly in Admin after deployment. No real key has been imported or generation charged by this setup.

Protected-preview browser requests use `credentials: same-origin` for access, extraction and guide calls. `omit` passed Google login but dropped the same-site hosting-protection cookie before requests reached the API. Cross-origin/native requests still omit ambient cookies; verified bearer identity and server-side entitlement remain mandatory. Redirects stay rejected and responses stay uncached. A regression covers reaching the application denial instead of an HTML hosting login.

## Verification and release gates

Local checks cover verified UUIDs, sign-out fencing, role/RLS denial, code expiry/replay/concurrency, encryption/tamper/revisions, safe errors, CA/TLS, callback return allowlist/expiry, storage denial and protected same-origin API transport. Latest local suite: 400 tests, 399 passed, one native-only skip; lint and bundle passed. Native CI at `7693708` also covers exact private access/vault/audit dump/restore and key decryption with the retained wrapping key. That is not evidence for later commits until their CI runs. Existing finance sync/RLS/restore tests remain separate.

Synthetic-only browser tests demonstrated masked key save, code issuance and customer activation/expiry without real data/provider calls. Browser-native confirmation was replaced with inline confirmation. Final inline/responsive UI and real owner Google-to-Admin acceptance, actual provider-key entry, optional management-helper retirement and the new deployment checks remain to be recorded. Do not claim live/production PASS from synthetic tests.

Installed accepted Android remains `1.0.24-rc4/code25`, source `94bea38`. No APK replacement, uninstall/data clear, real financial upload/adoption, new Android permission, broadcast, customer-Web alias movement, paid service or Vercel Production change was performed. Native AI rollout needs its own reachable API/protection plan and acceptance; do not embed a Vercel protection-bypass secret in an APK.
