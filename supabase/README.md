# Hisab SQL history and portable deployment

Only development project `sfzitbasxrpmtmldujbm` is bound to this app. Other
projects and `public.deshpath_*` objects are outside scope.

The first two SQL files are byte-preserved from the existing feature branch
and already applied on that project. Do not reapply or squash them:

- `20261029152851_hisab_cloud_foundation`: owner RLS, exact numeric integer
  checks, balanced immutable journals and idempotent posting.
- `20261029154151_hisab_private_storage_guards`: **Supabase Storage adapter**,
  scoped restrictive policies and two private media buckets. Not stock-Postgres
  financial core; skip on a host without the Storage service.

PR-2 adds `hisab_portable_money_media`: validated signed-int64 amount limits
without rounding/retyping existing amounts, a deferred opening-direction
constraint and private portable media-object references. All changes target
Hisab objects only. No table/data reset or client financial sync activation.

Fresh stock Postgres: first install the guarded
`db/adapters/stock-postgres.sql` identity-context adapter, then replay foundation
and the new forward migration. Never run that bootstrap on Supabase. It is an
identity anchor/context interface, not a login server.

See [DB_PORTABILITY.md](../docs/DB_PORTABILITY.md) for restore ordering, identity,
gateway restrictions, media-copy boundaries and recovery checks. Tests:
`npm run test:sql` (isolated PGlite by default); native PG17 and actual scoped
`pg_dump/pg_restore` also run in GitHub CI. Native scripts refuse non-loopback
or non-test databases and never drop a database.
