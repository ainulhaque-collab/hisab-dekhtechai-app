# Cloud migration audit — 29 October 2026

## Decision and inspected source

The owner's new master prompt explicitly replaces the previous "No Supabase"
decision. Target: offline-first local replicas, Supabase Auth/PostgreSQL/Storage
as the eventual synchronized authority, and existing Firebase FCM delivery.
Do not activate a second financial authority while Drive sync is writing.

- Repository: `ainulhaque-collab/hisab-dekhtechai-app` (private).
- Remote default branch: `main`, inspected at
  `438d535de670afa5747c28c8a76f36c44200de95` (merged PR #4).
- Current tested feature source: `31acc7c65d7716d392d92a0c5e6e3b90b900b546`.
  It contains 60 feature commits absent from main; resetting to main would lose
  working changes. The migration branch starts from this feature source.
- Development branch: `codex/supabase-firebase-cloud-v1`.
- Baseline: 293/293 Node tests, browser/API TypeScript and Web build pass.
  Latest tested installed client is permanent-key `1.0.20-test` / code 21.
- Owner confirmed retained phone history, readable saved PDF and a working
  live AI budgeting guide. The server-only follow-up formats guide amounts in
  exact decimal taka, without changing ledger amounts or its request hash.

## Actual modules and evidence

| Area | Existing implementation | Verified status / gap |
| --- | --- | --- |
| Local persistence | `src/storage/db.ts`, `drivers/durableStorage.ts`, native SQLite connection manager | Schema 5; storage key `hisab_dekhtechai_db`; atomic snapshot/outbox and read-back; existing tests pass. Do not rename keys or clear storage. Web uses IndexedDB with an explicit localStorage fallback, not a proven OPFS driver. |
| Ledger | `contracts/types.ts`, `contracts/ledger.ts`, `domain/journal.ts`, `domain/money.ts` | BigInt integer paisa, real asset versus reserved nominal accounts, immutable corrections/reversals, opening entries and transfer fees. Existing financial regressions pass; cloud must enforce equivalent invariants. |
| Ownership | `auth/googleAuth.ts`, `sync/orchestrator.ts`, `storage/backup.ts` | Dataset owner is SHA-256 of `hisab-owner:` + verified Google subject, not an email or Supabase UUID. Existing records cannot be automatically relabeled after login. |
| Drive sync | `sync/orchestrator.ts`, `automaticSync.ts`, transports, `cloudBackup.ts` | Protocol 1 immutable operations, per-device sequence, payload checksums, outbox/retry, conflict review and verified recovery copies. Owner previously confirmed Android↔Web. Supabase transport/cursors and migration are not implemented. |
| Accounts/workspaces | Account groups, archive/restore, empty-record safe deletion, workspace description/photo and parties | Implemented. Some historical/starter/system identifiers are not UUIDs. Preserve legacy IDs through a mapping, rather than rewriting local references. |
| Categories | Workspace-scoped income/expense categories and parent subcategories | Implemented and used by journal/report contracts. Cloud foreign keys must prohibit parent/category references across workspaces. |
| Savings/loans | `savingsGoals.ts`, `savingsLoans.ts`, `loanBook.ts` | Goals reserve existing assets; internal lending has protected balanced journals. Reservation is not expense or an additional asset. Cloud financial activation must wait until these extension events are supported. |
| Reports | `financialReports.ts`, calendar, grouped reports, period comparison, bookmarks and balance checks | Existing synthetic browser/restore tests pass; balance checks do not adjust money. PDF readability owner accepted. Remaining phone feature acceptance is separate. |
| AI | Server-only Gemini adapters, scoped consent, quotas, receipt/voice and guide | Owner confirmed voice form fill and live guide; no journal is posted automatically. Provider key is not in Web/APK. Existing Google bearer validation must be upgraded to Supabase identity deliberately. |
| Notifications | Existing HTTP v1 FCM, keyless Vercel sender, classic push/offline worker, Redis inbox | Owner phone push and retained inbox accepted. No Firebase Auth/Firestore financial database. Supabase persistence/identity migration, quiet hours and additional categories remain. |
| Native security | Java biometric, backup file, media access, Google and print plugins | Native permission/PDF fixes and permanent signing identity retained. A Supabase refresh-token vault and OAuth callback flow need explicit implementation/testing. |
| Sharing | `TeamSharingModal.tsx` truthful setup state | Historical local permission rows retained. Email-hash invites no longer claim verified collaboration. Real invite acceptance, account scope and revocation remain pending. |
| Admin/blog | Verified sole Admin Google account; PostgreSQL adapter and reviewed migration | Source tested; content DB not activated. Announcements are drafts/recipient plans only. Do not add a broad send endpoint during this migration. |
| UI/PWA | Reusable modal/select/DOM date picker, local fonts, bottom navigation, charts, static offline shell | Earlier 430px EN/BN and server-stop/update checks passed. Wide sidebar, comprehensive keyboard audit and new auth/migration screens need work. Do not expose simulators to customers. |
| Build | `.github/workflows/ci.yml`, `build-apk.yml`, signed build scripts | Node 22 checks, full financial tests, API runtime build and Android build. Never substitute CI's debug key for the owner's installed release key. |

## Supabase discovery and isolation boundary

The owner explicitly selected `PestGurd — Development Test`:
`sfzitbasxrpmtmldujbm`, organization `plzaxlijqrlctmbsyeqf`, Singapore,
PostgreSQL 17.11, ACTIVE_HEALTHY. This is an existing shared development project,
not an empty dedicated Hisab project: public DeshPath tables (including 65 place
rows), PestGurd internal schemas and migration history already exist.

No application records were read. Metadata/security advisors only were queried.
Do not rename the project, replace existing public/Auth/Storage policies, alter
other applications, or claim this is a dedicated production backend. Initial
Hisab DDL/testing must stay in separately named schemas with explicit RLS and
grants. Record an existing-schema fingerprint before/after additive changes.
If shared project identity/configuration cannot safely support Hisab, use a
dedicated project after an owner decision; do not create paid branches.

The earlier Neon Free installation was accepted by the owner, but its database
was not created. Empty private Blob `store_tPpoO206OSv9XgGK` was created, is not
connected to this app, and holds no financial data. Both provisioning flows are
paused under the new Supabase decision; no automatic deletion is authorized.

## Data preservation and activation gates

1. Keep local schema 5, storage keys, original IDs, outbox, signed APK and Drive
   operations intact during foundation work. New cloud code starts inactive.
2. Export a checksum-verified recovery snapshot and exercise real import/reload
   on an isolated copy before migrating an owner's dataset. Existing synthetic
   recovery tests are a baseline, not proof that the owner's current data was
   backed up or restored by the agent.
3. Supabase UUID and Google legacy subject hash are distinct identities. A
   server-verified Google identity, intended dataset, owner confirmation,
   migration manifest and explicit legacy-ID mapping must bind them.
4. Show counts, exact balances, pending operations, media hashes and conflicts
   before linking. Never merge on email alone, on `user_metadata`, or merely
   because a login succeeded. Preserve local data when anything fails.
5. Separate cloud acknowledgement/cursor from Drive's uploaded status. Do not
   acknowledge the existing outbox based on an unverified HTTP success/realtime
   event. Only commit-bound confirmations may move a durable cursor.
6. Retain immutable journals; corrections append reversal/replacement records.
   Sequence catch-up, duplicates, missed events and concurrent conflicts need
   explicit replay tests. Old clients must not write concurrently to a new
   independent authority after the authority cutover.
7. Only after isolated restore and Android→Web→Android verification, switch
   each approved dataset's authority. Keep independent exports/Drive recovery.
   Never prescribe uninstall/clear-storage as a synchronization repair.

## Security risks and phased implementation

- Every new table needs explicit grants and RLS; deny anonymous access. Journal
  writes must be atomic, balanced, immutable and permission checked by the DB.
- Current Google tokens, Supabase sessions and FCM token ownership cannot be
  substituted for one another. Existing AI/push/Admin routes need a coordinated
  identity transition, rather than accepting any bearer token or supplied role.
- Shared project Auth settings affect other apps. Do not silently change Google
  provider settings, redirect allowlists or existing Firebase sender trust.
- Private receipts require owner/workspace policies, real byte hashes and
  bounded uploads. Financial records never go to Analytics/Crashlytics payloads.
- No service-role/secret credentials in clients, source, Notion or logs.
  Real client-side encryption/key recovery is required before any E2EE claim.

| Phase | Concrete output | Exit evidence |
| --- | --- | --- |
| 0 | This audit, discovered project, baseline and preserved source branch | 293 regressions passed before remote DDL; shared-project baseline captured |
| 1 | Additive isolated PostgreSQL foundation, RLS, atomic journal RPC, private storage policy design and tests | Actual SQL allow/deny for two subjects + anonymous, precision/balance/immutability/idempotency/rollback and unchanged unrelated schemas |
| 2 | Supabase Google Auth adapter, Web PKCE/native callback, secure refresh/logout and ownership binding | Distinct-user/session/callback/account-switch tests; owner Google provider setup where needed |
| 3 | New durable operation protocol, commit/cursor catch-up, reviewed legacy migration manifest | Three-device synthetic sync/offline/conflict/restore, then separately approved owner migration |
| 4 | Map existing accounts/categories/groups/savings/loans/budgets without regressions | Exact balances and reports; no duplicated savings assets |
| 5 | Supabase inbox/token metadata and current FCM sender identity migration; opt-in Crashlytics | Real supported-device delivery/rotation/logout and privacy evidence |
| 6 | Bangla-first coherent responsive design using the owner's UI/UX reference | Small/large Android, desktop, keyboard and contrast checks |
| 7 | Verified shared memberships, acceptance/revocation and account-level roles | Distinct real identities; negative RLS and coordinated financial write tests |
| 8 | Upgrade/restore, release security/performance review and rollback | No critical failures; owner-approved production release only |

Official documentation reviewed: Supabase changelog, RLS/testing, native deep
linking and Storage access controls. The 10 November 2026 TLS cipher retirement
requires testing supported Android/Web TLS; do not disable TLS verification.
The UI/UX Pro Max reference explicitly excludes pure backend work; apply it
when Phase 6 changes the interface, not as a database framework dependency.

## Phase 1 delivery evidence

- Applied only to owner-selected development project `sfzitbasxrpmtmldujbm`:
  `20261029152851_hisab_cloud_foundation.sql` and
  `20261029154151_hisab_private_storage_guards.sql`. Files were generated with
  Supabase CLI 2.122.0, then aligned to the actual hosted migration versions.
- Seven new tables in non-public `hisab_cloud`; helpers in `hisab_internal`.
  RLS is enabled/forced, anonymous table access is denied, ownership/financial
  fields have restricted column grants, and posted journals are immutable.
  The RPC derives its actor from `auth.uid()` and commits only a complete,
  balanced journal. Retry reuses a matching operation; changed payload conflicts.
- This first RPC supports opening/income/expense/transfer only. Legacy
  corrections/reversals, reservations/loans, operation cursors and legacy-ID
  mapping are activation gates, not silently omitted imported records.
- Exact unscaled numeric integer constraints prevent even raw SQL inserts from
  rounding fractional paisa. The local tests also exercise large amounts beyond
  JavaScript safe integers, fee/savings totals, cross-workspace references,
  archived wallets and incomplete deferred transactions.
- Existing `deshpath_edge_only_storage` is permissive for buckets other than
  its own two names. A new private bucket alone would therefore NOT isolate
  Hisab. Six additional Hisab-only read/insert/update/delete guards now protect
  `hisab-receipts-v1` and `hisab-workspace-images-v1`; no old policy was replaced.
  Objects are owner/workspace/path checked and immutable to clients. Both new
  buckets are private, accept JPEG/PNG/WebP and cap each file at 2 MB. They are
  empty; no actual file upload/download is claimed by SQL metadata tests.
- Local PGlite is a development-only PostgreSQL test runtime, not a replacement
  for Android SQLite or a claimed hosted Auth integration. The same rollback
  verification script passed on actual hosted Supabase PostgreSQL. It creates
  synthetic subjects and tests policies/RPCs, then rolls back ALL Auth, finance
  and Storage metadata fixtures. No real Google user login was simulated as
  completed. Hosted Storage's extra SQL delete guard was respected, not disabled.
- Read-back: 0 Hisab workspaces/journals/lines/objects and 0 leftover synthetic
  users. Before/after fingerprint of 1,441 ORIGINAL public/Auth/Storage/PestGurd
  catalog signatures: `2febbee242323358cd57f387cf0bc538`. Only the expected newly
  named Hisab policies are excluded from the after comparison.
- Full local suite: 304/304 PASS; browser/API TypeScript, Web build and compiled
  Node ESM API runtime PASS. No native/client code changed in this phase; hosted
  Android CI is recorded separately after commit. The app remains on Drive.
- Security advisors show no Hisab findings and no new findings. Existing shared
  project notices remain: 29 informational RLS/no-policy items, one executable
  security-definer warning and disabled leaked-password protection. They are
  outside the new schema and were not changed on behalf of another app:
  [function advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
  [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
  This is not a production security clearance for the entire shared project.
- Public Auth settings confirm Google is enabled. Dashboard redirect settings
  require owner sign-in in the browser; plugin access alone cannot reveal or
  safely change that shared configuration. Next: secure Google PKCE/native
  session/callback implementation, then explicit ownership migration and sync.
