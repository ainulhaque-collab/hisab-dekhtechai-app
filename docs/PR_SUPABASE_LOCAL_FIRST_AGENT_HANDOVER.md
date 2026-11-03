# Hisab DekhteChai — Agent PR / Handover Document
**Title:** Local-first finance + portable Postgres (Supabase now, own DB / VPS later) + API / Webhook / MCP

**Repo:** `ainulhaque-collab/hisab-dekhtechai-app`  
**Baseline main SHA (verify before work):** `438d535de670afa5747c28c8a76f36c44200de95`  
**Product:** Hisab DekhteChai (হিসাব দেখতে চাই)  
**Document version:** 2026-11-03  
**Audience:** Coding agents (Codex, Claude Code, Antigravity, Cursor, etc.) and human reviewers

**Also read:** `docs/00_AGENT_PRIORITY.md` (conflict resolution).

---

## 0. How an agent must use this document

1. Read this file completely before writing code.
2. Inspect the **current repo** (do not assume docs = implemented code).
3. Preserve every existing finance feature and invariant listed in §3.
4. Work in **small, reviewable PRs** — one milestone per PR unless owner says otherwise.
5. Never mark PASS without real commands, tests, and evidence.
6. Never delete, reset, or overwrite schema without a reversible migration file. There is no production dataset and no Google Drive requirement.
7. Prefer additive changes. Prefer feature flags / adapters over rewrites.
8. If blocked, stop at the exact blocker and propose safe options — do not invent credentials, PASS statuses, or cloud results.

---

## 1. Goal of this workstream

Build Hisab DekhteChai as a **multi-customer, offline-first** finance app. There is **no production release and no real users**, so do not preserve Google Drive sync or Google Drive backup.

### Must achieve
- **Local-first:** UI reads and writes the local database first; sync is background.
- **Cloud now:** Supabase (Auth + Postgres + Storage + Edge Functions) is the first hosted backend.
- **Portable later:** schema, migrations, and sync protocol must move to **self-hosted Postgres or a VPS** without rewriting the app. Do not lock business logic to Supabase-only APIs.
- App + Web stay **very fast** (optimistic UI, virtualized lists, non-blocking sync).
- Smooth **animations** without jank. Respect `prefers-reduced-motion`.
- **Public API**, **Webhooks**, and **MCP** sit on the same domain layer as the UI.
- Existing finance features in code (income/expense/transfer, workspaces, reports, AI entry, notifications, PDF, etc.) stay unless the owner explicitly drops one.

### Must not do
- Build or keep a Google Drive backup/sync path. Remove or leave unused `src/drive` only when tests still pass; do not design new Drive features.
- Silent last-writer-wins on financial journals.
- Floating-point money math.
- Destructive migrations that cannot be replayed on another Postgres.
- Embed secrets in source, logs, or client bundles.
- Claim E2EE / zero-knowledge unless a proven key-recovery design exists.
- Production publish or paid billing without owner approval.

---

## 2. Current baseline (agent must re-verify)

### Stack (as of baseline)
- Capacitor + React + TypeScript + Vite + Tailwind
- Local: `@capacitor-community/sqlite` (Android), web storage path for Web
- Sync today in repo: Google Drive (`src/drive`, `src/sync`). **Owner decision 2026-11-03: drop Drive.** No production users exist. Do not invest in Drive. New sync target is Postgres.
- Domain already separated under `src/domain`, `src/contracts`, `src/storage`, `src/services`
- UI: Lucide, Motion (`motion` package already present)
- Tests: `tsx --test src/test/*.test.ts`
- Package / Android id historically: `com.hisabdekhtechai.app`

### Important code areas
```
src/
  domain/          # money, journal rules — KEEP & extend
  contracts/       # interfaces — KEEP
  storage/         # local DB adapters
  sync/            # outbox / sync orchestration
  drive/           # legacy — do not extend; remove once Postgres tests pass
  auth/
  services/
  components/
  context/
  security/
  test/
android/           # Capacitor Android shell
docs/              # product + agent docs
```

### Product invariants (non-negotiable)
- Money = **integer BDT paisa** (bigint / safe integer), never JS float for amounts.
- **Balanced immutable journal**: every posted transaction has debit_minor sum === credit_minor sum.
- Corrections = **reversal + replacement**, not silent overwrite.
- Local write + outbox enqueue must be **one atomic transaction**.
- Offline save must work **without network** after the device is initialized.
- Schema migrations must be **plain SQL**, versioned, and runnable on **any Postgres** (Supabase today, self-hosted or VPS later).
- Bangla-first UI; minimal blue/white; Lucide outline icons.

---

## 3. Features that must not be lost

### Core finance
- Workspaces (personal / business)
- Accounts (Cash, Bank, bKash, Nagad, Rocket, Other)
- Categories / subcategories
- Income, Expense, Transfer (optional fee)
- Transaction history, search, filters, archive
- Dashboard totals (balance vs profit must not be conflated)
- Reports + export paths (CSV/XLSX/PDF as present)
- Budgets / savings / loans if present — do not remove

### Platform
- Offline durable local save
- Outbox + idempotent operation IDs
- App lock / biometric hooks if present
- Notifications / receipts / AI helpers if present (consent-gated)

Do **not** treat Google identity or Google Drive as a required feature.

**Rule:** One concern per PR. Do not delete a working finance path in the same change that wires Postgres unless tests cover the replacement.

---

## 4. Target architecture

```
Clients: Android (Capacitor/React) + Web (Vite/React) + Motion animations
        ↓
Local SQLite / web local DB  (source of truth for UI) + durable Outbox
        ↓
Postgres Sync Adapter (thin client)
        ↓
Postgres (portable)
  Now: Supabase (Auth, Storage, Edge, hosted Postgres)
  Later: same SQL on own Postgres / VPS (pg_dump / migration replay)
        ↓
Public API | Webhooks | MCP Server
```

### Layering
| Layer | Responsibility |
|-------|----------------|
| `domain/` | Money math, journal balance, validation (pure TS) |
| `services/` / application | Use cases |
| `contracts/` | Repository / Sync / Auth ports |
| `storage/` | Local DB |
| `sync/` | Outbox drain, merge, provider routing |
| `postgres/` or `supabase/` | Remote adapter; SQL not locked to Supabase-only features |
| `api/`, `webhooks/`, `mcp/` | External interfaces over same use-cases |
| `components/` | UI only — no raw SQL, no secrets |

---

## 5. Postgres portability (mandatory)

Supabase is the **first host**, not permanent lock-in.

1. Ordered **plain SQL** migrations (e.g. `supabase/migrations/` or `db/migrations/`).
2. Avoid Supabase-only features in the finance schema as hard requirements. Document any `auth.uid()` RLS equivalents for self-host.
3. RLS on every finance table; default deny.
4. Client uses a **narrow sync API**; swapping host = `DATABASE_URL` + auth issuer, not a rewrite.
5. With first schema PR, add `docs/DB_PORTABILITY.md`: `pg_dump`, restore, env vars.
6. Auth behind an interface (Supabase Auth fine for v1).
7. Storage object keys in Postgres so a VPS can use S3-compatible or disk later.
8. Secrets only in env.
9. **Do not design Google Drive backup.**

Suggested tables: `profiles`, `workspaces`, `accounts`, `categories`, `journal_transactions`, `journal_lines`, `webhook_endpoints`, `api_keys` (hashed), `mcp_tokens` (hashed). Money = integer minor units.

---

## 6. Performance

| Metric | Target |
|--------|--------|
| Local transaction save | Prefer < 50ms perceived; never block UI on network |
| List scroll (1000+ rows) | Virtualized |
| Dashboard (warm local) | Instant from local cache |
| Animation | Use `motion`; respect `prefers-reduced-motion` |
| Sync | Background only; honest status |

Optimistic UI, indexes on workspace/date/account, no N+1 dashboard queries.

---

## 7. Animations

Minimal blue/white + Lucide. Subtle transitions only. Reuse `motion` before adding libraries.

---

## 8. Public API / Webhooks / MCP

Adapters over the **same domain use-cases**.

- **API:** versioned `/v1`, JWT or hashed API keys, Idempotency-Key on creates, RLS.
- **Webhooks:** signed (HMAC), retry + delivery log, minimal payloads.
- **MCP:** tools only (not raw SQL); auth required; read-only tools first; write tools gated.

---

## 9. Cloud host (no Google Drive)

- Do not implement Google Drive sync or backup.
- Delete Drive-only code when Postgres path is tested.
- Default sync provider: Postgres on Supabase until owner moves host.

---

## 10. Work order (milestone PRs)

- **PR-0** Inventory & safety freeze; add/confirm this doc.
- **PR-1** Domain & contracts; `SyncProvider`: `LocalOnly | Postgres`.
- **PR-2** Portable SQL schema + RLS on Supabase host.
- **PR-3** Local outbox → Postgres; multi-client synthetic proof.
- **PR-3b** `docs/DB_PORTABILITY.md`.
- **PR-4** Performance (virtual lists, local-first dashboard).
- **PR-5** Animation polish.
- **PR-6** Public API.
- **PR-7** Webhooks.
- **PR-8** MCP server (read first).
- **PR-9** Remove leftover Drive code after tests pass.

Each PR: scope, tests, risk, rollback, screenshots if UI.

---

## 11. Testing (minimum)

```bash
npm run lint
npm test
npm run build
```

Also when relevant: journal balance, outbox atomicity, RLS isolation, API idempotency, webhook signature, MCP auth rejection.

---

## 12. PR template

```markdown
## Summary
## Feature preservation
## Financial integrity (paisa, balanced journal, atomic outbox)
## Postgres / security (RLS, portable SQL, no secrets, no Drive)
## Performance / UX
## Test evidence
## Risks & rollback
## Owner actions needed
```

---

## 13. Response format after each agent step

1. Milestone / status  
2. Files changed  
3. Tests run  
4. Financial integrity  
5. Risks / blockers  
6. Next smallest task  

---

## 14. Safety & stop rules

**STOP and ask owner before:** production host cutover; billing; broad webhook fan-out; public MCP write tools.

**Never:** force-push `main`; reintroduce Google Drive backup; log tokens/ledgers to chat; claim sync works without tests; use unreplicable Supabase-only SQL without documenting a stock-Postgres path.

---

## 15. Copy-paste agent system prompt

```text
You are the Lead Engineer for Hisab DekhteChai (হিসাব দেখতে চাই).

Read docs/00_AGENT_PRIORITY.md and docs/PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md; inspect the live repo before coding.

Objectives:
- Keep ALL existing finance features and invariants (integer paisa, balanced immutable journal, atomic outbox, offline-first).
- Do NOT build Google Drive sync or backup. No production users exist.
- Use Postgres. Host it on Supabase first. Schema and sync must move later to the owner's own Postgres or VPS via pg_dump / migration replay. Write docs/DB_PORTABILITY.md with the first schema.
- Keep app/web very fast: local-first reads/writes, optimistic UI, virtualized lists.
- Add polished but lightweight animations (respect reduced-motion).
- Add Public API, Webhooks, and MCP as adapters over the same domain use-cases.

Rules:
- Small PRs. Plain SQL migrations. No secrets in source. No fabricated PASS.
- UI must not wait on the network to save a validated local journal.
- After each step: status, files, tests, integrity, risks, next task.

Start with PR-0 inventory unless the owner assigns a specific milestone.
```

---

## 16. Owner decisions (2026-11-03)

- Cloud now: **Supabase Postgres**
- **No Google Drive** backup or sync
- DB movable to **own Postgres or VPS** anytime
- Fast mobile + web; animations; MCP + Webhooks + API
- No loss of core ledger behavior
- Prefer free/open tools; paid tiers only with approval

---

## 17. Open questions (do not guess)

1. Supabase project id for Hisab dev?
2. Auth: email, Google via Supabase Auth, or both? (login only, not Drive)
3. MCP read-only first?
4. Public API partner-only or self-serve keys?
5. Capacitor/React long-term vs Flutter later?

---

**End of document.**  
Older docs that say “No Supabase” or “Drive is the only cloud” are superseded. Local-first finance rules still bind. Google Drive does not.
