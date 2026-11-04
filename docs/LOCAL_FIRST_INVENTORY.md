# PR-0 — Local-first inventory and safety freeze

Audit date: 2026-11-04 (Asia/Dhaka). Active contract:
[agent handover](PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md) and
[document priority](00_AGENT_PRIORITY.md). This inventory distinguishes inspected
source from tested behavior and does not activate financial cloud sync.

## Source baseline and preservation boundary

| Source | Exact inspected commit | Meaning |
| --- | --- | --- |
| GitHub `main` | `ede7e03ec9b168a2fc79f3b65260e4a969a2b9d8` | Handover and cleanup PRs #7/#8 merged; current PR-0 base |
| Remote `codex/supabase-firebase-cloud-v1` | `be716428568abc339bdfe61a28eb8981971bc7bf` | Additional finance/platform work plus staged Auth adapters; PR #6 is separate |
| Local `codex/supabase-firebase-cloud-v1` | `75dde8280ed492083cbf40f8964f8458fa42c740` | Further Cloud account UI/theme work exists locally; not the remote branch tip at audit time |
| Original working directory | `antigravity`, `0cdc3560545279d9694dfb98bb4a2a4dc10c5624` | Older Android experiment; left untouched |

PR-0 uses a separate Git worktree. Existing attachments, signing identity,
Firebase configuration, local environment files, APKs and original worktree
are retained. No customer database was opened or migrated by the audit.

**Do not build a replacement from `main` and install it over the tested APK.**
Main lacks features present in the feature branch and installed test release.
Reconcile the feature branch before producing the next application update.
Do not silently merge, reset or discard any of these branches.

## Features found in source

“Present” here is an inventory result, not a hardware/cloud acceptance claim.

| Capability | Main | Additional feature-branch evidence to preserve |
| --- | --- | --- |
| BDT minor-unit money, income/expense/transfer/fee/opening | `domain/money.ts`, `domain/journal.ts` | Transaction-time handling and report projections |
| Reversal/correction audit trail and local outbox | `storage/db.ts`, `contracts/types.ts` | Receipt attachment and strengthened validation |
| Workspaces, accounts/groups, categories, parties | Present | Workspace descriptions/images and recovery-safe deletion |
| History/search/filter and reports/CSV/XLSX | Present | Detailed reports, PDF/native printing, report metadata |
| Budget and recurring rules | Present | Preserve alongside savings reservations and loan accounting |
| Savings goals and internal business loans | Absent | `domain/savingsGoals.ts`, `domain/savingsLoans.ts`, `storage/loanBook.ts`, both savings modals |
| AI receipt/voice entry and budgeting guide | Absent | `ai/`, `server/ai/`, media permissions and native bridge |
| Firebase notifications/inbox | Absent | `notifications/`, `server/notifications/`, native FCM configuration |
| Local recovery and offline shell | Partial local snapshots | `storage/backup.ts`, receipt/media recovery, PWA shell |
| PIN/biometric lock | Present | Preserve current lock and back navigation |
| Supabase Auth | Absent | Pinned SDK, PKCE and encrypted session adapters; local tip also mounts a staged account screen |
| Postgres financial sync | Absent | Schema foundation exists; no completed cursor-sync/client cutover |
| Versioned public finance API/webhooks/MCP | Absent | Existing AI/content/push endpoints are not a public ledger API |

Google Drive is legacy code, not an implementation target. Main and feature
branch still import it from AppContext. Retain it only while replacement tests
are built; do not advertise a completed Postgres replacement or add Drive work.

## Financial integrity review

- Domain journal builders use bigint minor units and assert balanced lines.
  Preserve reversal-plus-replacement; never use journal last-writer-wins.
- `LocalDatabase.commitJournalWithOutbox` writes journal, operation, pending
  outbox and dedup state inside its local transaction boundary. Existing
  storage fault-injection tests exercise rollback. These tests do not prove
  actual SQLite or IndexedDB crash durability on a phone/browser.
- Main's SQLite initialization/transaction handling predates feature-branch
  fixes. Main's IndexedDB setter resolves on request success; the feature
  branch waits for transaction completion. Preserve the stronger implementation.
- Number-taking money helpers still round numeric inputs. The Postgres wire
  contract must accept validated integer strings and reject unsafe/fractional
  inputs; do not infer exactness from a TypeScript alias alone.
- Permission-sharing UI/types exist, but they do not prove server-authorized
  employee sharing. Default-deny ownership and server-side authorization remain
  required before any shared cloud access.

## Bound hosted development project — read-only inspection

Only `sfzitbasxrpmtmldujbm`, now named `hisab-dekhte-chai`, region
`ap-southeast-1`, was inspected. Supabase reported `ACTIVE_HEALTHY`, Postgres
17.11.0.003. PR #9 also documents this binding but was still open at audit time.

- Seven existing tables in `hisab_cloud`: profiles, workspaces, account_groups,
  accounts, categories, journal_transactions and journal_lines. All seven have
  RLS **and FORCE RLS** enabled, as verified from the server catalog.
- Existing migrations: `20261029152851_hisab_cloud_foundation` and
  `20261029154151_hisab_private_storage_guards`. Do not apply a duplicate initial
  schema or rename these objects blindly to match a newer naming proposal.
- `hisab-receipts-v1` and `hisab-workspace-images-v1` are private; each allows
  JPEG/PNG/WebP with a 2 MiB file limit.
- Seventeen `public.deshpath_*` tables also exist. No foreign table, policy,
  function, Auth setting, bucket or row was modified during this audit.
- Existing money columns are `numeric` minor units, not bigint. Review the
  original precision/integer constraints and transport limits before deciding
  on an additive compatibility migration. A numeric column alone proves neither
  floating-point use nor a completed integer-money contract.

Catalog checks above are not a fresh two-user RLS test, Storage upload test or
multi-client sync proof. This milestone applies **zero migrations**.

## Verification and reproducible install

Initial `npm ci --ignore-scripts --no-audit --no-fund` failed with EUSAGE: the
committed lockfile was missing optional platform packages and still described
the pre-cleanup package/dependencies. The lockfile is reconciled with current
package.json, retaining versions and integrity hashes of every retained package.
Removed lock entries are dependencies already removed by the merged cleanup,
not removal of runtime source or current declared dependencies.

Fresh install, lint, test and build outcomes are recorded in
`qa/local-first-baseline.json`. Logs remain under ignored `build/pr0/` in the
isolated worktree. Local Node is 26.13.0/npm 11.20.0; CI uses Node 22. Do not
describe the local run as Node 22 or CI validation.

## Device boundary

The connected TECNO CM6 reports package `com.hisabdekhtechai.app`,
`versionName=1.0.20-test`, `versionCode=21`, and the existing application data
directory. No APK was installed, no financial entry was created and no app data
was cleared for PR-0. Device UI/boot results, when checked, are separate from
source tests. A missing/locked device must never be reported as a device PASS.

## Next milestones and acceptance gates

- [x] PR-0: inspect the active contract, reconcile source baselines, inventory
  hosted metadata and identify installation/preservation hazards.
- [ ] PR-1: provider-neutral `LocalOnly | Postgres` and narrow sync/Auth ports;
  validated wire envelopes, owner/workspace scope, operation IDs and explicit
  acknowledgements. Local save must not depend on any network/provider.
- [ ] PR-2: reconcile existing Hisab SQL with portable core migrations and a
  separate Supabase Auth/Storage adapter. Document `auth.uid()`/`auth.users`
  replacements in `DB_PORTABILITY.md`; replay on stock Postgres and run two-user
  plus anonymous isolation tests. Do not touch DeshPath.
- [ ] PR-3: durable outbox push/pull, idempotent retries, conflict quarantine,
  cursor commit atomic with local merge, and two-client offline/restart tests.
- [ ] PR-3b: tested schema/data/media export and restore on an isolated VPS-like
  Postgres. A database dump does not transfer Storage object bytes or OAuth
  provider configuration.
- [ ] PR-4/5: measured large-history performance and lightweight reduced-motion
  animations after the financial path passes.
- [ ] PR-6/7/8: versioned API, signed/retried webhooks, authenticated read-first
  MCP over the same use cases. No broad fan-out/public writes in this milestone.
- [ ] PR-9: remove unused Drive paths only after the replacement and feature
  preservation gates pass.

Rollback for PR-0: revert its documentation and lockfile commit. No financial
schema/data rollback, remote resource cleanup or APK downgrade is required.
