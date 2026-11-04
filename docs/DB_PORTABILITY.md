# Hisab database portability — PR-2

2026-11-04. Scope: portable SQL/RLS foundation and restore evidence, not live
financial sync, account migration or a public release. Parent: PR #11.

## Existing hosted schema and forward migration

Development project: `sfzitbasxrpmtmldujbm`, `hisab-dekhte-chai`, Postgres 17.
The two deployed migration files are imported unchanged from the existing
feature branch. The forward migration adds only Hisab constraints, one private
media-reference table and a deferred opening-direction trigger. It never
modifies `deshpath_*`, shared Auth/provider settings or existing Storage rules.
An out-of-range existing amount makes migration validation fail and roll back;
no journal is truncated, rounded or overwritten.

Amounts remain scale-free `numeric` with integer, nonnegative and signed-int64
maximum CHECKs. This deliberately preserves the deployed representation:
Postgres casts `1.5::bigint` to `2`, whereas the existing integer CHECK rejects
the original fraction. Wire amounts remain canonical decimal strings and use
bigint in the domain. Exact aggregate totals can exceed an individual amount's
int64 limit; sum arithmetic remains exact numeric/bigint, not floating point.

Opening capital now additionally enforces asset debit/equity credit at commit.
Reversal/correction, savings/loan groups, employee authorization and all other
command handlers remain later cutover gates; four-kind posting is not a claim
that every existing app command already has a cloud implementation.

## Auth interface on Supabase versus stock Postgres

The financial SQL uses two small interfaces: `auth.users(id uuid)` for stable
identity foreign keys and `auth.uid()` for the current verified subject. These
names are supplied by Supabase Auth on the hosted project. On a fresh stock
Postgres, `db/adapters/stock-postgres.sql` supplies plain SQL equivalents:

- A minimal **server-managed UUID anchor** table. No passwords, OAuth secrets
  or client-supplied email/metadata become authorization data.
- A stable invoker function reading a transaction-local verified subject.
- Unprivileged NOLOGIN `authenticated` and `anon` roles. The bootstrap refuses
  existing Auth/Hisab schemas and privileged/login roles, and requires explicit
  `hisab.bootstrap_mode='isolated-stock'` before it runs.

This context adapter is not an authentication service or cryptographic JWT
verifier. A trusted API gateway must verify issuer, audience, signature, expiry
and account/session state **before** setting `hisab.actor_id`. Use parameterized
`set_config(..., true)` inside BEGIN/COMMIT, SET LOCAL ROLE authenticated, and
never expose arbitrary SQL, GUC-setting RPCs or DB credentials to users. Do not
give users a LOGIN role able to impersonate this context. Transaction-local
settings prevent identity leaking through a pooled connection. Keep a separate
migration/backup principal; the API must not use a superuser/BYPASSRLS role.

Preserve each user's verified UUID through a server-controlled identity map
when changing issuer. Matching an email or Google subject hash is insufficient.
Clients must reauthenticate after host/issuer changes. The future concrete Auth
adapter/gateway still needs integration; portability does not mean the current
staged Supabase client can be pointed at an arbitrary hostname today.

## Server configuration and SQL replay

Future API configuration: server-only `DATABASE_URL`, trusted Auth issuer and
audience, and private object-storage credentials. Never put database/admin
credentials in VITE variables, an APK, source control or logs. Clients use the
narrow provider/Auth ports from PR-1; shared finance rules stay unchanged.

On a fresh own-Postgres test database (Postgres 17 recommended):

1. Install the guarded stock Auth adapter as a migration administrator.
2. Replay `hisab_cloud_foundation` and `hisab_portable_money_media` in order.
3. Skip the historical Supabase Storage migration. Configure a private S3/disk
   adapter separately and keep object keys from `hisab_cloud.media_objects`.
4. Run SQL/RLS and recovery checks before connecting any client or real data.

Existing Supabase projects keep their Auth and Storage adapters; apply only
unapplied forward migrations through the approved migration workflow. Do not
recreate tables, replace policies of another app, or alter exposed schema lists.

## Scoped backup and restore runbook

This is a prepared runbook, not authorization to export real records. Use an
isolated destination, compatible PostgreSQL tools, a quiesced source and private
backup files. Native CI performs these operations with synthetic fixtures only.

```sh
pg_dump --format=custom --no-owner --schema=hisab_cloud --schema=hisab_internal --file=hisab.dump "$SOURCE_DATABASE_URL"
pg_restore --exit-on-error --no-owner --section=pre-data --dbname="$DEST_DATABASE_URL" hisab.dump
pg_restore --exit-on-error --no-owner --section=data --dbname="$DEST_DATABASE_URL" hisab.dump
# Seal source-cluster creation transaction markers before immutable triggers exist:
psql "$DEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'UPDATE hisab_cloud.journal_transactions SET creation_tx=-1;'
pg_restore --exit-on-error --no-owner --section=post-data --dbname="$DEST_DATABASE_URL" hisab.dump
```

Before pre-data restore, install the destination's Auth interface and import
**only the required verified UUID anchors** referenced by Hisab profiles and
workspace owners. The archive intentionally excludes the shared project's
`auth.*`, `storage.*`, `public.*`, foreign projects and roles. It preserves ACLs
targeting the precreated unprivileged roles. Never copy every shared Auth user
or use `--clean`/DROP/CASCADE against an existing database.

The `creation_tx=-1` step changes only a local ingestion guard marker. Source
transaction IDs are cluster-specific and could otherwise collide with a later
destination transaction, enabling a late line append. Run it only during the
isolated pre-data/data/post-data recovery sequence, not on a live immutable
ledger. All journal amounts, IDs, timestamps and request payloads remain equal.

Verify table counts and exact server-side fingerprints (excluding only that
marker), RLS for two identities and anonymous access, balance validation on
every restored journal, mutation/late-append rejection and idempotent new posts.
Do not open the destination until every check passes. Keep the source and local
outbox unchanged for rollback; host promotion requires owner approval.

## Files and binary media

`hisab_cloud.media_objects` stores owner/workspace, kind, canonical private key,
SHA-256, MIME and byte count. Owner+workspace foreign keys, FORCE RLS, path/MIME
checks and the 2 MiB cap are enforced; clients cannot update/delete references.
Metadata insertion does not prove upload, MIME sniffing or digest verification.
The later Storage adapter must verify bytes before acknowledging a reference.

A database dump does **not** contain Storage object bytes, OAuth configuration,
push identities, issuer secrets, or the device's unuploaded outbox. Copy media
through authorized Storage/S3 APIs, verify content hashes and private access,
and retain stable keys. This PR transfers no real files or records.

## Test scope, rollback and inherited findings

The same SQL tests run in isolated PostgreSQL WASM locally and native PG17 in
CI. Native CI additionally tests concurrent idempotent retries and a real
pg_dump/pg_restore to a separate empty database. Fixtures include a synthetic
foreign table which must survive forward migration and stay out of the archive.
The hosted verification script always rolls back its synthetic Auth/ledger/media
fixtures and forces deferred validation before rollback.

Rollback before any client activation: revert the application PR; retain the
backward-compatible constraints/table. Do not automatically drop a populated
media table or weaken money constraints. A later SQL rollback requires a
separate reviewed migration and preservation of all references. Historical
migrations remain immutable; never rewrite migration history to undo a release.

The shared project already had unrelated security advisories before PR-2:
default-denied private tables, an unrelated executable definer function and
password-protection configuration. These remain outside Hisab scope; see the
[function advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
No project-wide “all clear” claim is made.

Official references: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[platform restore boundaries](https://supabase.com/docs/guides/self-hosting/restore-from-platform),
[Postgres pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html),
[Postgres pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
