# Supabase automatic recovery — owner Android candidate

The owner requested a cloud copy that survives uninstall. This milestone adds
automatic **whole-dataset recovery backups**, not the incomplete Postgres operation
sync engine. It preserves the legacy ledger namespace without silently converting
Google hashes, fixed starter IDs or feature metadata into cloud UUID ownership.

## Behavior

- Settings → Backup & recovery → Supabase automatic backup. Enable explicitly
  while signed into the intended verified Supabase customer account.
- The local binding records that customer UUID, a random dataset UUID and a
  random backup-device UUID. Linked Google identities with the same verified
  customer share recovery access. Email strings are never authorization.
- Local writes stay offline and atomic. A foreground worker debounces local
  changes, checks every 30 seconds while visible/online, and resumes after online
  or foreground. Closed-app/unsent offline changes cannot be recovered remotely.
- Upload the complete versioned backup: immutable journals/outbox, metadata,
  wallet lifecycle, goals, loans, report annotations, workspace images, receipt
  blobs and existing finance preferences. Recovery binding is excluded. Auth
  tokens, vault secrets and device PIN/biometric credentials are not in this
  financial database/export. Local recovery snapshots are excluded to avoid
  recursive growth.
- Before upload and after download, exercise the existing isolated backup
  import/ledger validation. Compare the exact SHA-256 and downloaded text. A
  readback failure, logout or identity switch cannot mark the copy verified.
  If another save occurs during upload, the UI stays pending until it too is
  backed up. Ordinary outbox entries are not falsely acknowledged.
- On reinstall, sign in to the same linked account, find cloud copies and choose
  Restore on the fresh installation. Only untouched starter databases can restore.
  The original ledger identity stays intact; the new installation keeps its own
  device identity and gets a new backup-device UUID. Existing nonempty ledgers
  cannot be overwritten by this path. File backup remains available.
- Each device uploads its own generations. There is no timestamp last-writer-wins
  financial merge, cross-device journal replication or automatic adoption of a
  different existing dataset.

## Database scope, limits and privacy

Plain PostgreSQL migration adds only `hisab_recovery.snapshots` and three narrow
`public.hisab_recovery_*` RPCs on the already bound project. RLS and FORCE RLS use
verified `auth.uid()`; anon/PUBLIC execute is revoked. Functions are security
invoker with empty search_path. No existing exposure lists, buckets, Auth settings,
other-app objects or finance tables are changed. The client has no privileged key.

Each complete backup is at most 40 MiB. Retain three generations per dataset/device,
at most 30 rows and 128 MiB per customer through the RPC. Owner-scoped transaction
locks serialize retention; size/quota errors roll back and retain older copies.
These are application RPC limits, not a promise of unlimited free service or a
replacement for host quotas. No paid plan is enabled. Database capacity/service
failure must remain an error, never a success badge. Backups use TLS/account access,
not end-to-end encryption. Do not log backup bodies, user credentials or real rows.

## Portability and release gates

Uses built-in PostgreSQL SHA-256, JSON, RLS and advisory locks. Stock Postgres
needs the existing trusted Auth context adapter; future gateway/JWT validation
must replace the hosted PostgREST/Auth boundary. Scope pg_dump to hisab_recovery
plus required identity anchors; exclude other apps/shared Auth secrets. Test restore
in an isolated destination before switching hosts. Never drop populated recovery
tables or downgrade the APK as rollback.

Client rollout is explicit `VITE_CLOUD_RECOVERY_ENABLED=true`; signed owner APK
uses `Build-SignedAndroid -CloudRecovery -WithoutAI`. AI remains off. Customer Web
rollout, full ledger sync, production release and billing are outside this change.

Local tests, hosted synthetic isolation/readback, signed in-place retention and
owner-device cloud upload/recovery must be recorded separately. Neither code nor
HTTP success alone proves the owner's data is recoverable. Do not uninstall the
real app as a test. Use synthetic/fresh isolated receivers and retain a separate
file backup before any owner acceptance step.

Official references: [Auth getUser](https://supabase.com/docs/reference/javascript/auth-getuser),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[database functions](https://supabase.com/docs/guides/database/functions).
