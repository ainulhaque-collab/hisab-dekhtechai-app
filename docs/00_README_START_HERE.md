# Hisab DekhteChai — Developer docs index

**Document baseline update:** 2026-11-03

> ## ACTIVE AGENT CONTRACT (read first)
>
> 1. [`00_AGENT_PRIORITY.md`](./00_AGENT_PRIORITY.md) — which docs win on conflict  
> 2. [`PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md`](./PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md) — current architecture & milestones  
> 3. [`10_AGENT_MASTER_PROMPT.md`](./10_AGENT_MASTER_PROMPT.md) / [`AGENT_COPY_PASTE_PROMPT.txt`](./AGENT_COPY_PASTE_PROMPT.txt) — copy-paste prompts  
>
> **Owner decisions (2026-11-03):** Supabase Postgres now; **no Google Drive** sync/backup (no production users); schema must remain movable to own Postgres/VPS; keep core ledger features; add speed, animations, API, Webhooks, MCP.

---

## Historical package (2026-10-22) — superseded for cloud/sync

The text below is kept for history. **Do not** treat “No Supabase” or “Drive-only cloud” as current requirements.

# Hisab DekhteChai — Android-first Developer Handoff (archive notes)
**Release plan (old):** Android complete → Android QA & beta → Web App → production Web release  
**Original package:** v1.0 / design-approved specification (2026-10-22)

> **Product:** Hisab DekhteChai (হিসাব দেখতে চাই) — Bangla-first, minimal blue/white, offline-first finance tracker.

## DOCUMENT ORDER — historical reference only
| Order | File | Notes |
|---|---|---|
| 1 | `01_PRODUCT_PRD.md` | Product requirements (still useful for scope) |
| 2 | `02_CUSTOMER_FLOWS_UI.md` | UI journeys |
| 3 | `03_ARCHITECTURE.md` | Local-first ideas useful; Drive-only cloud **superseded** |
| 4 | `04_DATA_MODEL_FINANCE.md` | Journal/paisa rules still bind |
| 5 | `05_GOOGLE_DRIVE_SYNC.md` | **DEPRECATED** — do not implement |
| 6 | `06_SECURITY_AND_PRIVACY.md` | Review; strip Drive-only assumptions |
| 7 | `07_ANDROID_DEVELOPMENT.md` | Android milestones (adapt to new backend) |
| 8 | `08_WEB_DEVELOPMENT_LATER.md` | Web plan |
| 9 | `09_QA_ACCEPTANCE_RELEASE.md` | QA matrices (adapt) |
| 10 | `10_AGENT_MASTER_PROMPT.md` | **Updated** — points to new handover |
| 11 | `11_DECISIONS_RISKS_OPEN_QUESTIONS.md` | Historical decisions |
| 12 | `12_GOOGLE_DEVELOPER_SETUP_AND_PLAY_RELEASE.md` | Historical Drive OAuth |
| 13 | `13_FLOWCHART_REFERENCE.md` | Diagrams |

## Still-binding product rules
1. Offline-first after the device is initialized; local write must not wait on the network.
2. Integer BDT minor units (paisa); balanced immutable journal; no float money math.
3. No silent destructive migration of financial records.
4. Bangla-first, minimal blue/white, Lucide-style icons.
5. Every milestone needs real tests/evidence — no fictitious PASS.

## Explicitly no longer binding
- “No Supabase / no central finance database”
- “Google Drive is the only sync transport”
- “Single Google owner identity bound to Drive appData”

See `PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md` for the replacement architecture.
