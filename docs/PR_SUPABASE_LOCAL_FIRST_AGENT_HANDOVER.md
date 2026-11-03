# Hisab DekhteChai — Agent PR / Handover (short)

**Repo:** `ainulhaque-collab/hisab-dekhtechai-app`  
**Supabase project_id ONLY:** `sfzitbasxrpmtmldujbm` (`hisab-dekhte-chai`, `ap-southeast-1`)  
**Also:** `docs/AGENT_PR_SHORT.md`, `docs/14_SUPABASE_PROJECT_BINDING.md`

---

## Do
- Local-first: UI reads/writes **local DB first**; sync is background only
- Money = **integer paisa** (bigint); **balanced immutable journal**; **atomic outbox**
- Cloud SQL: prefix **`hisab_` only**; plain SQL + RLS; later movable to own Postgres/VPS
- Small PRs; real tests; no fabricated PASS
- MCP / API / webhooks = adapters over the same domain use-cases

## Don't
- Touch **`deshpath_*`** tables or policies (already on this Supabase project)
- Google Drive sync or backup
- `service_role` or secrets in client / git
- Float money math; silent last-writer-wins on journals

## Work order
1. Inventory live `src/` (docs ≠ code)
2. Domain ports + `SyncProvider`: `LocalOnly | Postgres`
3. `hisab_*` schema + RLS via Supabase MCP `apply_migration` on `sfzitbasxrpmtmldujbm`
4. Outbox → Postgres sync
5. Performance (virtual lists, optimistic UI) + light motion
6. Public API → webhooks → MCP tools
7. Remove Drive code when tests green

## Reply after each step
Status · files · migration names · tests · financial integrity · risks · next

## Copy-paste system prompt
```text
Hisab DekhteChai lead eng. Read docs/PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md.
Supabase MCP project_id=sfzitbasxrpmtmldujbm ONLY. Never touch deshpath_*. New tables hisab_* + RLS.
Local-first, integer paisa, balanced journal, atomic outbox. No Drive. No secrets in git.
Small PRs. After each step: status, files, tests, next.
Start: inventory src/ then hisab schema migration.
```
