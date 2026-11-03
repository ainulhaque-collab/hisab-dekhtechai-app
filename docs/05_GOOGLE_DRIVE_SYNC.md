# 05 — Google Drive Sync (DEPRECATED)

> **Status: DEPRECATED — 2026-11-03**  
> Owner decision: **do not implement Google Drive sync or backup.**  
> There is no production release and no real users.  
> Active contract: [`PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md`](./PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md) and [`00_AGENT_PRIORITY.md`](./00_AGENT_PRIORITY.md).  
> Historical Drive protocol text was removed from the active path so coding agents do not implement it. See git history on `main` before this branch if you need the old design notes.

## Replacement

- Local-first SQLite + durable outbox (unchanged finance rules)
- Remote sync target: **Postgres** (Supabase now; portable to own Postgres / VPS later)
- Do not add new code under `src/drive/` for product features
