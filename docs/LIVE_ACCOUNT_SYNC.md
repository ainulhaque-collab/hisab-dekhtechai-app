# Account live synchronization

## Scope and ownership

Android owner candidate only. AI remains disabled. This change does not release the customer Web app, enable loan automation, change Auth settings, enable billing, or promote a Production website. The transport and merge engine can be reused by the later Web app; a cross-tab write lease is still required before its public rollout.

The account key is the verified Supabase customer UUID, never a display email or phone number. Already linked Google identities share that UUID. SMS login is not enabled. Existing ledger owner namespaces and the phone's device identity remain intact.

## How it works

1. A financial Save commits locally without waiting for a network request. Financial and metadata UI writes use the SQLite transaction guard.
2. A visible, online client checks its authenticated account head. Postgres Changes delivers only owner-scoped revision metadata. A 30-second fallback catches up when the connection is unhealthy or a sync is incomplete. Foreground/reconnection also triggers a check; background delivery while the OS suspends the app is not promised.
3. The client shares a canonical schema-6 financial document: workspaces, accounts, wallet metadata, permissions, categories, parties, journals, operation history, budgets, recurring entries and receipt blobs. Device settings, tokens, local outbox and recovery snapshots are excluded.
4. Per-record SHA-256 baseline hashes support a three-way merge. Separate additions merge. Simultaneously different edits of the same record pause with a conflict. Immutable journal fields, lines and operations cannot be removed or rewritten. Complete derived goal/loan/wallet validation runs before applying a merge.
5. The server accepts a write only for the expected revision, pinned owner and dataset. A per-owner lock makes compare-and-swap atomic. It validates the checksum, balanced integer monetary postings and retained journal immutability independently. It does not implement every finance use case as normalized SQL commands; complete application/domain validation also runs in the client.
6. The client checks the accepted checksum and reads back the stored document. Only verified accepted operations are acknowledged. A short local transaction merges any Save made during the request, stores the baseline, and preserves device settings and pending new operations.

`hisab-live-sync-v1` stores the revision and small common-baseline hash maps. Recovery backups retain that checkpoint for subsequent safe merging. Snapshots are a separate recovery mechanism, not the live dataset itself. Each document is limited to 40 MiB; platform free-tier storage/egress limits still apply.

## Installation and recovery behavior

The existing phone must first enable account recovery backup; the initial live seed requires an owned snapshot for the same dataset. An untouched new installation signed into that same account discovers and loads its live dataset automatically, with a fresh device identity. A nonempty unrelated dataset, different account binding or stale dataset without a common baseline is rejected rather than replaced. One canonical dataset is supported per customer account.

Conflicts preserve the phone and cloud versions. The app explains that review is needed. An interactive manual conflict-resolution screen is not included in this candidate; retain file backups from both devices and do not uninstall or overwrite a conflicting copy.

## Goals and loans

Existing goals, physical-wallet allocations and cross-workspace loan journals are included and validated. A joined account device can manually repay a loan issued by another device. Such repayments use loan metadata event version 2; older version-1 issuer-only events remain readable. Do not downgrade to a reader that predates version 2. Automatic repayment remains gated to the original executor and is not enabled by this change; no legacy verified-sync receipt is forged.

## Hosted resources and access

Approved project: `sfzitbasxrpmtmldujbm`.

- Private tables: `hisab_recovery.live_heads` and `hisab_recovery.live_documents`.
- Authenticated invoker RPCs: `public.hisab_live_head`, `public.hisab_live_get`, `public.hisab_live_put`.
- RLS and FORCE RLS restrict rows to `auth.uid()`. Anonymous execution is revoked. No service-role secret ships in the app.
- Only `live_heads` is added to `supabase_realtime`; full financial documents are not published.
- Migration: `20261107055443_hisab_live_account_state`, identical to `server/recovery/002_live_state.sql`.

Hosted rollback-only fixtures passed compare-and-swap, readback, idempotent retry, anonymous denial and cross-owner isolation. Security advisors reported no new Hisab findings; pre-existing shared-project/Auth notices were left untouched.

## Verification and remaining acceptance

Automated tests use two independently durable SQLite databases and exercise discovery, bidirectional journal changes, offline concurrent additions, lost acknowledgements, wallet metadata, conflicts, transaction barriers, failed commits/restart, stale logout responses, goals and cross-workspace loan repayment. Portable Postgres tests execute the actual migration and check ownership, CAS and immutable balanced postings.

The owner has no second physical phone available now. Two-real-phone acceptance remains pending. Signed APK installation, retention, live connection and hosted owner readback evidence are recorded separately in local QA receipts; do not infer their completion from the architecture or fixture tests.
