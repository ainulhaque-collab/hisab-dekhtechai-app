# Hisab cloud development foundation

Owner-selected project: `sfzitbasxrpmtmldujbm` (`PestGurd — Development Test`).
This is a SHARED DEVELOPMENT project, not an isolated production project.
Read [the migration audit](../docs/CLOUD_MIGRATION_AUDIT.md) before changes.

## Applied migrations

| Hosted version | File | Scope |
| --- | --- | --- |
| 20261029152851 | migrations/20261029152851_hisab_cloud_foundation.sql | New `hisab_cloud` tables and `hisab_internal` invoker helpers; owner-only RLS and immutable atomic journals. |
| 20261029154151 | migrations/20261029154151_hisab_private_storage_guards.sql | Two new private buckets and additional policies confined to those bucket names; existing permissive policies retained. |

The files were initially created with official Supabase CLI 2.122.0 and their
versions aligned to the successful hosted migration history. Existing remote
migrations belong to other apps: do not replace that history, reset the shared
database, or blindly run `db push` with this repository's partial history.
Use reviewed, additive migrations on the explicit project only.

## Guarantees tested in this phase

- Caller subject comes from `auth.uid()`, not an owner/role supplied to the RPC.
- Foreign keys bind accounts, groups, categories and lines to the same owner
  and workspace. Categories support one subcategory level without cross-kind
  parent references. Anonymous financial access and client DELETE are denied.
- Financial inserts require exact integer paisa. Journal and line amounts use
  unscaled numeric with integer/range checks, avoiding decimal typmod rounding.
- `post_journal` handles opening/income/expense/transfer atomically, validates
  balanced totals and account/category semantics, and deduplicates exact retries.
  Altering a reused operation conflicts. Headers/lines cannot be edited/deleted;
  new lines cannot be appended after the creating SQL transaction commits.
- Storage path is `<Supabase subject UUID>/<workspace UUID>/<sha256>.<ext>`.
  Reads require that owner/workspace; writes also require an active workspace.
  Clients cannot overwrite, rename or delete these immutable objects. Buckets
  accept JPEG/PNG/WebP up to 2 MB. Actual byte validation remains required at
  the later application upload boundary, not inferred from a filename.
- An unrelated existing permissive anonymous Storage policy cannot override
  the new restrictive guards. Other buckets retain their previous behavior.

## Verification

```powershell
node --import tsx --test src/test/cloudFoundation.test.ts
npm run lint
npm test
npm run test:api-runtime
npm run build
```

The test runs real isolated PostgreSQL via development-only PGlite. Its Auth
subject fixture is not a hosted Google login. It also runs the same
`scripts/sql/Verify-HisabCloudFoundation.sql` used on hosted Supabase. That script
intentionally rolls back every synthetic Auth, journal and Storage metadata row
and checks that counts are unchanged. It does not upload or restore file bytes.
Never disable hosted Storage's SQL deletion guard to run tests.

## Not activated

No runtime application import, new financial authority, owner upload, legacy
dataset reassignment, API schema exposure, Google provider/redirect change,
Firebase identity change, paid resource or Production deployment is included.
The existing Android/Web app continues using its current local and Drive code.

Before activation: verified Google/Supabase ownership binding and PKCE sessions,
explicit migration manifest/confirmation, legacy-ID mapping, corrections and
loan/goal event support, commit-ordered cursor catch-up, bounded file uploads,
real file read-back, two-user HTTP/RLS and Android→Web→Android restore tests.
Do not treat the current SQL-only subject simulation as any of those results.
