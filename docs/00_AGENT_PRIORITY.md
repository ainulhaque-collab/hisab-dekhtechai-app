# Agent document priority (READ FIRST)

**Effective:** 2026-11-03

## Binding (read these only for new work)

1. `docs/PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md`
2. Live `src/` (inspect code; do not assume docs = implementation)
3. Finance invariants always: integer paisa, balanced immutable journal, atomic outbox, offline-first, non-destructive migrations, Bangla-first UI

## Supabase

- project_id **only:** `sfzitbasxrpmtmldujbm`
- New tables prefix **`hisab_`** — never touch **`deshpath_*`**

## Removed from repo (do not restore without owner order)

Drive-era / No-Supabase specs deleted: `MASTER_DEVELOPMENT_DOCUMENT`, `00_BANGLA_OVERVIEW`, `01_PRODUCT_PRD`, `02_CUSTOMER_FLOWS_UI`, `03_ARCHITECTURE`, `06_SECURITY`, `07_ANDROID`, `08_WEB`, `09_QA`, `11_DECISIONS`, `12_GOOGLE_SETUP`, `13_FLOWCHART`, `MILESTONE_CHECKLIST`, `adr/ADR-001`.

`05_GOOGLE_DRIVE_SYNC.md` remains as a short **DEPRECATED** stub only.

## Keep for reference

- `04_DATA_MODEL_FINANCE.md` — ledger rules still useful
- `05_GOOGLE_DRIVE_SYNC.md` — deprecated notice
- `10_AGENT_MASTER_PROMPT.md`, `AGENT_COPY_PASTE_PROMPT.txt`
- QA evidence reports under `docs/qa/` (historical only)

## Conflict rule

```
PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md > 00_AGENT_PRIORITY.md > live src/ > any leftover docs
```
