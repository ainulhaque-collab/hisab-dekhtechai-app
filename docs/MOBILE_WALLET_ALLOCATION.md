# Mobile-first wallet allocation — owner-approved 2026-11-05

Source baseline: installed/accepted `af63493148fb1272261bebbf73bc887ad9be398f`, Android code23. Work in `codex/mobile-wallet-allocation`; original checkout, signing identity and existing ledger remain preserved. No Production promotion or real-data cloud cutover.

## Approved product rules

- Android customer UX first; general customer Web UX after mobile publication. A separate protected **Web-only Admin** is the exception, for manual BDT1 payment verification, single-use redeem codes, timed access and app-specific block/unblock. No Admin panel in Android. External API/MCP deferred.
- Personal is the first customer workspace. **All wallets** lives in the first Personal workspace. Create the physical Cash/Bank/bKash/Nagad/etc. record there; generate an owner-scoped stable code. Other workspaces attach an allocation account using that code.
- A physical wallet is not another copy of cash. Existing workspace accounts remain allocation ledgers; each keeps its opening balance, income/expense and spendable funds. Overall physical balance is the sum of the linked allocations, including archived balances. No same-name/number auto-merge.
- Workspace screens show only their own allocation/spendable amount. Only the owner opens the Personal All wallets view: per-wallet total, workspace breakdown, income/expense and goal reservations. A goal reserve is already part of cash and must never be added a second time. Employee grants do not imply global-wallet access.
- Cross-workspace transfers atomically post both balanced sides and one immutable link; retry cannot duplicate either side. Same physical wallet reallocates ownership without changing physical cash. Different wallets move the tracked amounts between those wallets. This is accounting, not a bank/payment instruction. Salary/payroll/draw classification is distinct from a plain allocation transfer.
- Existing Goal/Loan history and policies remain. Goal reserve reduces only that allocation's spendable funds. Personal or Business can receive a loan; repayment uses only the chosen borrower's available allocation, never another workspace's or goal's funds. Interest stays simple daily monthly-rate/30, reminders Asia/Dhaka 19:00, partial repayment.
- Bangla-first simple mobile navigation, large labelled controls, clear taka amounts, Light/Dark/System themes, accessible contrast, reduced-motion support. Preserve income/expense/transfers, reports/PDF, AI/media, notifications, security and recovery.

## Delivery and acceptance

1. Immutable wallet registry/link projection, allocation isolation and protected paired transfers; additive local schema guard and verified recovery/restore. Synthetic exact-paisa, replay, concurrency, failure and owner isolation tests.
2. Android Personal All wallets screen: create/code/link, explicit legacy-account linking with a before/after balance preview, per-workspace breakdown and cross-workspace transfer UI. Existing old accounts stay unlinked until explicitly selected.
3. Complete mobile theme/navigation/onboarding polish with the same finance services. Real small-screen/Bangla/dark/light QA and same-key in-place update retention.
4. Finish new Auth alignment and Postgres command/gateway/adoption/restore gates before promising cloud parity. No silent legacy owner UUID reassignment.
5. Web-only owner Admin and server-authoritative redeem/access module. Existing owner and customer-data recovery must not be accidentally locked out. Read-only/export after expiry; cached offline entitlement at most 7 days or remaining license, whichever is shorter; a newly imposed block reaches an offline device on reconnect. No app-wide Supabase Auth ban in the shared project.

Status: implementation started. No claim that mobile redesign, cloud sync, Admin/licensing, or public release is complete. Keep separate reviewable milestone PRs and evidence; do not tick owner acceptance from code/build success.

## First local milestone — implemented; History/page accepted on device

- Immutable wallet create/link metadata and protected paired allocation journals. Exact integer paisa, atomic local write/outbox, stable retry IDs, one allocation per workspace per wallet, owner isolation, missing-reference spending guard, physical shortfall cap and archived-balance inclusion.
- First Personal **All wallets** is a dedicated mobile page, with Cash/bKash/Nagad/Bank totals, wallet codes, per-workspace available/reserved funds and date-filtered income/expense. Link existing accounts only after an explicit balance preview; no name-based matching or automatic customer-data changes.
- Income/expense editing and deletion retain immutable correction history. Linked allocations cannot overspend via an edited entry, a stale edit/delete, a repeated delete or a transfer. Failed entry validation does not consume a device sequence.
- Goals keep reserves inside total physical cash, outside spendable funds. Goal loans can go to Personal or Business; repayment retains the existing partial/daily simple-interest policy and respects allocation and physical-wallet limits.
- Local schema **6** records a pre-migration raw recovery copy and a verified recovery point before advancing a schema-5 dataset. The signing workflow records the reader version and refuses to build a reader downgrade after schema 6. Recovery is a compatible forward fix or a separately verified restore, never a data clear, uninstall or forced downgrade. Existing finance/identity maps must remain unchanged during this migration.
- `VITE_WALLET_ALLOCATION_ENABLED` defaults to **false**. It is enabled only for this local Android candidate. Customer Web preview aliases and Production remain unchanged. The current Supabase-Auth local mode labels local storage honestly; the portable cloud command adapter is not mounted.

### Verified local evidence

- TypeScript checks pass. Full suite: **389 tests, 388 pass, 1 native-Postgres-only skip, 0 failures**. Separate isolated SQL/RLS suite: **11/11 pass**. Compiled AI API runtime verification and web bundle build pass. These generic SQL checks do **not** establish portable wallet-command support.
- Fifteen wallet tests cover exact large paisa, isolated spending/reserves, paired transfers, retry/conflict, durable-write rollback, concurrent requests, owner/tampered-leg rejection, missing references, legacy adoption/reload/backup, schema-5 retention, Personal goal loans/partial repayment, stale corrections, legacy physical deficits, fees and period filters.
- Actual 390×844 Bangla UI: create a synthetic bKash with BDT10,000; link a zero Business allocation; transfer BDT6,000; post one BDT100 Personal expense. Result: Personal BDT3,900, Business BDT6,000, physical bKash BDT9,900; only Personal expense BDT100. Page/back/footer and contextual picker labels checked. No Google sign-in or real-data upload in this test.
- Screenshots and raw tool logs remain in ignored `build/qa/`; only synthetic examples may be shared. Same-key `1.0.23-rc3/code24`, source `fe2c4fb`, installed in place: schema5→6, native media, normal launch and exact old-finance/outbox retention pass. Owner confirmed old History and All wallets both appear. APK SHA-256 `CBEB14E3C6FB3D9107A149800D58465F129734A1C45D85BE797C08EF6ECDEADF`. Explicit real-wallet linking and publication acceptance remain separate. Next UI milestone is documented in `MOBILE_APPEARANCE_NAVIGATION.md`.

### Still open before release

Complete theme/navigation/login/onboarding redesign; Web-only Admin/redeem/entitlement enforcement; new Auth alignment with AI/push; portable wallet/clearing commands, server authorization and two-client replay; explicit legacy adoption, independent restore/key recovery; native owner acceptance and publication. Plain allocation transfers are implemented; salary/owner-draw classification and a guided reconciliation flow are later work. Client actor strings are only a local-device guard; they are never a substitute for server JWT/owner authorization.
