# Hisab — Agent contract (short)

**Repo:** ainulhaque-collab/hisab-dekhtechai-app  
**Supabase project_id ONLY:** `sfzitbasxrpmtmldujbm` (hisab-dekhte-chai, ap-southeast-1)

## Do
- Local-first: UI R/W local DB first; sync background
- Money = integer paisa (bigint); balanced immutable journal; atomic outbox
- New SQL: prefix `hisab_` only; plain SQL + RLS; portable to own Postgres later
- Small PRs; real tests; no fake PASS

## Don't
- Touch `deshpath_*` tables/policies
- Google Drive sync/backup
- service_role or secrets in client/git
- Float money math; silent journal overwrite

## Order
1. Inventory live `src/`
2. Domain ports + SyncProvider LocalOnly|Postgres
3. `hisab_*` schema+RLS via MCP `apply_migration`
4. Outbox→Postgres
5. Perf + light motion
6. API → webhooks → MCP tools
7. Remove Drive code when tests green

## Reply each step
Status · files · migration names · tests · risks · next
