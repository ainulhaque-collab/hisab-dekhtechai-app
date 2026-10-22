# 01 — PRODUCT REQUIREMENTS DOCUMENT (PRD)
**Name:** Hisab DekhteChai / হিসাব দেখতে চাই  
**Tagline:** আপনার সব হিসাব, এক জায়গায়।  
**Product category:** Offline-first personal and single-owner small-business finance / expense ledger. Not a banking, payments, or money-transfer provider.

## 1. Users / use cases
- Personal user records salary, food expenses, bills, transfers, budgets, cash/bank/wallet balances.
- Small business owner creates separately labeled Personal, Business A and Business B **workspaces**. Each workspace may contain ledgers and asset accounts (Cash / bKash / Nagad / Rocket / Bank) with independent reports.
- The same individual later uses a second Android phone or Web browser, signs into **the same Google Account**, and obtains eventual synced balances without manual file import.
- User upgrades Android app from store while offline, retaining unuploaded transactions.
- User changes phone, signs into the same Google Account, and the app safely reconstructs available synced financial history.

**Single-user ownership in V1:** V1 does not offer other staff accounts, permission-based collaboration, review/approval or a central team ledger. Historical concept screens for team approval should be marked *Future / not implemented*, not dead buttons in first production release.

## 2. Success criteria
- User can add income, expense, transfer offline without spinner/network calls; transaction and outbox are one atomic local commit.
- After Google auth and Drive consent, background/foreground sync reconciles changes between two Android devices; **no lost or duplicated operations** under staged concurrency/failure tests.
- Customer does not configure Google Cloud, API credentials, recovery phrase or second app password.
- Every posted account-to-account transfer preserves consolidated funds except explicit fees.
- UX labels distinguish **Saved on device**, **Waiting to sync**, **Synced to Drive**, **Sync requires attention**, **Conflict needs review**.
- Version update preserves record IDs, account totals, queued operations, and migration integrity.
- Android accessibility: 48dp-ish touch targets, scalable fonts, keyboard/screen-reader labels and good contrast.

## 3. Platforms and release boundaries
| Release | Core promise | Don't deliver yet |
|---|---|---|
| Android Alpha | Local finance engine, offline-first UX, local migrations | public store, web |
| Android Beta | real Google Identity + Drive sync, second-device restore, safety suite | production Android, web |
| Android v1.0 | QA-gated Play Store version, audit/report/export | staff accounts / backend / E2EE |
| Web v1.0, later | React shared UI/business core, browser local DB, Google Drive pull/push while active | offline background sync with browser closed |
| Future | recurring, budgets, receipts, team approval if re-architected, optional stronger encryption/key recovery | no promise of dates |

## 4. Android V1 functional scope — must ship
1. Welcome, Google sign-in, Drive scope consent, first-run onboarding with BDT and language.
2. Personal/business workspaces for **one Google owner**; workspace switching; user-confirmed workspace create, rename, archive.
3. Ledgers and ledger groups (view classification, not security principals).
4. Asset accounts: Cash, Bank, bKash, Nagad, Rocket, Other; opening balances.
5. Categories/subcategories with defaults and custom entries.
6. Fast entry: Income, Expense, Transfer (optional fee), relevant date, note, workspace/account; validate inputs.
7. Transaction history, details, reversible correction, archive filters, search and period filters.
8. Dashboard: per-workspace total account balance, income, expense, net movement, top categories, recent transactions; no conflation of balance and profit.
9. Reports: day/week/month/custom date, by account/ledger/category; CSV export; no currency mixing (V1 BDT only).
10. Sync dashboard: sync state, last successful verification, pending count, last error category, manual Retry, Pause sync, Drive account identity.
11. Automatic local update-safe DB migrations; local recovery snapshots; cloud checkpoint/backups; restored history validation.
12. Settings: Bangla/English UI, dark mode optional, app lock PIN/biometrics optional, logout with clear explanation about local data and unsynced records.
13. Budget management (monthly/weekly/category cap), spending progress and locally scheduled alert state.
14. Recurring income/expense templates with deterministic `(rule_id, due_date)` occurrence identity, no double-post across offline devices; safe preview/confirmation policy.
15. Financial calendar, bookmark/archive, basic reconciliation, XLSX/PDF export (or owner-approved documented deferral if library/security constraints block).
16. Receipt attachment: local import/view, content-size/type validation, separate immutable Drive blob replication + referenced operation with delayed-attachment UI; implement if attachment protocol passes Drive quota/load testing, else label blocked rather than pretending attachments sync.
17. Error/empty/loading/offline/account-mismatch/conflict/recovery flows. Never leave empty screen or silent failures.

## 5. P1 / postponed (do not fake by showing unusable UI)
- Multi-currency, advanced accounting reconciliation, cross-ledger comparison, sophisticated recurring automation beyond tested local-first rule execution.
- Approval, team roles, multi-user accounting and permission logs require a new shared identity/authorization model; **not part of V1**.
- Banking integration, monetary transfers via payment providers, payment processing, lending, OCR, ads, paid subscription and native Windows/iOS not required.

## 6. UX rules and phrasing
- Bangla-first, international standard numeral display via settings, BDT currency `৳`.
- Blue primary `#1D4ED8`, navy `#1E3A8A`, white `#FFFFFF`, blue-muted `#DBEAFE`, background `#F8FAFC`, slate text `#0F172A`; green/red solely semantic, not dominant.
- Lucide outline icon pack, one icon stroke weight; skeletons only on loading, avoid resource-heavy animation.
- Backups never automatically overwrite unsynced local edits during restore.
- Google Drive `appDataFolder` hides system sync files from Drive UI; "my Google Drive" is honest but not "visible folder". Offer user-visible manual export later via Drive file picker / local download.

## 7. Behavioral rules
- Google OAuth is not needed for each transaction; local device retains authenticated ownership marker after initial sign-in.
- Cannot create brand-new cloud-backed identity offline; existing initialized Android accounts can perform local work offline.
- Account switch requires verified online Google identity and inspection of pending outbox; never reuse another account's local DB.
- If Drive consent is denied/revoked, allow local use on already initialized device, show "Backup paused"; do not say synced.
- Sync is on app foreground/open, network regained, periodic permitted Android worker, and manual retry. Background scheduling is advisory, not exact or immediate.

## 8. Definition of done
**Android finished** only when actual signed builds on representative Android devices pass the release matrix, second-device sync verification, restore and migration, Google OAuth consent flows, privacy/Play checks; QA artifacts committed and release approved. Then begin Web phase.
