# 14 — Supabase project binding (Hisab DekhteChai)

**Effective:** 2026-11-03  
**Read with:** `00_AGENT_PRIORITY.md`, `PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md`

## Bound project (ONLY this one for Hisab)

| Field | Value |
|-------|--------|
| Dashboard | https://supabase.com/dashboard/project/sfzitbasxrpmtmldujbm |
| **project_id / ref** | `sfzitbasxrpmtmldujbm` |
| Project name | `hisab-dekhte-chai` |
| Region | `ap-southeast-1` |
| DB host | `db.sfzitbasxrpmtmldujbm.supabase.co` |
| Postgres | 17.x |
| Status (verified 2026-11-03) | ACTIVE_HEALTHY |

**Do not** use other org projects (e.g. `jwyfhmjljcolaueksooc`) for Hisab schema or data.

## Critical: shared project, existing tables

As of 2026-11-03 this project already contains **unrelated** tables (prefix `deshpath_*`), e.g.:

- `deshpath_places`, `deshpath_profiles`, `deshpath_journals`, …

### Rules
1. **Never** `DROP`, `TRUNCATE`, `ALTER`, or change RLS on any `deshpath_*` table.
2. **Never** delete or rename existing policies/functions that serve DeshPath unless the owner explicitly orders it in writing.
3. All Hisab objects MUST use prefix **`hisab_`** (tables, indexes, types, functions) or live in a dedicated schema `hisab` if created later.
4. Migrations: use Supabase MCP `apply_migration` with clear snake_case names, e.g. `hisab_init_profiles_workspaces`.
5. Prefer **additive** SQL only.

## MCP usage

Agents with Supabase MCP must pass:

```text
project_id = "sfzitbasxrpmtmldujbm"
```

Typical tools:
- `list_tables` — inspect before changing
- `apply_migration` — DDL only
- `execute_sql` — read checks / non-DDL; avoid destructive DML on foreign tables

## Client env (app — never commit secrets)

```text
VITE_SUPABASE_URL=https://sfzitbasxrpmtmldujbm.supabase.co
VITE_SUPABASE_ANON_KEY=<from Dashboard → Settings → API; anon public key only>
```

- **anon key** may go in client env / `.env.local` (gitignored).
- **service_role** key: server/Edge only; never in the mobile/web client or git.

## First Hisab schema direction (agent)

Create only `hisab_*` tables, e.g.:

- `hisab_profiles` (id = auth.users.id)
- `hisab_workspaces`
- `hisab_accounts`
- `hisab_categories`
- `hisab_journal_transactions`
- `hisab_journal_lines`

Money columns: **bigint** minor units (paisa).  
RLS: default deny; `auth.uid()` owns rows.  
Plain SQL so a later move to VPS Postgres remains possible.

## Owner decisions locked

- Cloud host for Hisab: this Supabase project
- No Google Drive sync path for new work
- Do not mix DeshPath and Hisab tables or policies
