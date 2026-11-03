# Agent document priority (READ FIRST)

**Effective:** 2026-11-03  
**Audience:** Codex, Claude Code, Antigravity, Cursor, and any coding agent

## Single source of truth for NEW work

1. **`docs/PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md`** — binding for architecture, cloud, sync, API/Webhook/MCP, and milestones.
2. Live **source code** under `src/` — do not assume docs already match implementation; inspect the repo.
3. Finance invariants still bind even if an older doc conflicts:
   - integer BDT paisa (no float money math)
   - balanced immutable journal
   - atomic local write + outbox
   - offline-first after device is initialized
   - non-destructive schema migrations
   - Bangla-first minimal blue/white UI

## Superseded / historical only (do NOT implement as current requirements)

These files remain for history and QA evidence. **Do not** follow them when they conflict with the handover above:

| File | Status |
|------|--------|
| `05_GOOGLE_DRIVE_SYNC.md` | **Deprecated.** No Google Drive sync or backup. No production users. |
| `12_GOOGLE_DEVELOPER_SETUP_AND_PLAY_RELEASE.md` | Historical Drive OAuth notes only. Login may still use Supabase Auth (optional Google IdP). Not Drive storage. |
| `00_README_START_HERE.md` (pre-2026-11-03 “No Supabase” rules) | Superseded by handover for cloud/sync. |
| `10_AGENT_MASTER_PROMPT.md` / `AGENT_COPY_PASTE_PROMPT.txt` (old “No Supabase”) | Replaced — use the copy-paste block inside the handover, or the updated files on this branch. |
| `MASTER_DEVELOPMENT_DOCUMENT.md` | Archive snapshot; not the active agent contract. |
| `03_ARCHITECTURE.md` Drive-as-only-cloud sections | Superseded. Keep local-first layering ideas. |

## Explicit owner decisions (2026-11-03)

- Cloud host now: **Supabase Postgres**
- **No** Google Drive backup/sync path
- Schema must stay **portable** to owner Postgres / VPS (`pg_dump` + plain SQL migrations)
- Multi-customer capable
- Keep core ledger features; add speed, animations, Public API, Webhooks, MCP

## If two docs conflict

```
PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md  >  00_AGENT_PRIORITY.md  >  live code behavior  >  older numbered docs
```

Stop and ask the owner only when the handover is silent **and** a finance invariant would be at risk.
