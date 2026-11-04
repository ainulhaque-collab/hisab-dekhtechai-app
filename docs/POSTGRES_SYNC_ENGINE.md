# PR-3a — durable outbox / PostgreSQL replay engine

2026-11-04. Stacked on PR-2 (`a043a3046b843bc168d9f1a04387df2c527358b0`).
This is an **unmounted development engine**, not a live mobile/web cutover.
The new SQL migration is replayed in disposable test databases only. It has not
been applied to the hosted development database by this PR.

## What runs

`LocalDatabase` → `DatabaseSyncStore` → `PostgresSyncEngine` → bounded authenticated
`SyncRpcTransport` → private `sync_push` / `sync_pull` → PostgreSQL tables.
The supplied HTTP transport takes an authenticated fetch adapter; it contains no
token, privileged database key, SDK session, or production login implementation.

The integration test uses **two real SQLite files**, a loopback HTTP server and
PostgreSQL (WASM locally, native PostgreSQL 17 in CI). Its bearer identities are
synthetic test fixtures only. The HTTP fixture commits PostgreSQL before replying,
and can deliberately lose the reply. This is not proof of a Capacitor bridge,
Supabase login/session lifecycle, or real phone acceptance.

## First command slice

| Command | Supported payload |
|---|---|
| workspace.create | New BDT workspace, bound verified UUID owner, unarchived |
| account.create | New ungrouped asset wallet, zero opening balance |
| category.create | New income/expense category, optional same-kind top-level parent |
| journal.post | Balanced opening/income/expense/transfer; no receipt/party/correction |

The protocol retains complete immutable envelopes, including optional display
metadata. Derived nominal-account UUIDs are server-private; clients use the shared
reserved nominal-account identifiers. Money is an exact decimal **paisa string**,
validated as a nonnegative signed-int64 value per posting side. Amounts are never
converted through floating-point currency math.

Other commands are **not silently acknowledged**. They remain pending with a
rejected/conflict disposition or a mapping error. `caught_up` means the current
scoped supported outbox/page is drained, not that every feature or binary receipt
has a verified recovery backup. Unknown workspace mappings fail closed.

Two existing storage changes are deliberate: queue a newly created category in
the outbox, and clone queued metadata payloads so a later local edit cannot rewrite
an older create event. Existing baseline tests cover compatibility. These changes
do not complete the legacy category edit/archive or other advanced command paths.

## Durability, replay and ordering

- Save remains local first. Journal and outbox use the existing local transaction;
  there is no network request in Save. Wire envelopes/hashes, dispositions, seen
  hashes, quarantined conflicts and cursor live inside the existing database
  snapshot, not a second financial store.
- SHA-256 covers the canonical complete envelope (excluding its hash). There is
  no fallback hash. PostgreSQL independently recomputes the same digest. Protocol
  keys are ASCII; Unicode string values are preserved. Unsafe JSON numbers and
  fractional posting amounts are rejected.
- Only a reply matching request, owner, workspace and **every** operation ID/hash
  can acknowledge. The local transaction rechecks the current cached envelope
  against the pending immutable operation. Timeouts, a lost reply, a stale reply
  and HTTP success without a valid acknowledgement keep local entries pending.
- An operation ID accepts one immutable envelope. A duplicate returns duplicate;
  changed content or another operation reusing an existing journal ID conflicts.
  There is no last-writer-wins replacement. Incoming incompatible pages roll back
  and are quarantined; the cursor does not advance.
- Workspace-scoped transaction advisory locks serialize cursor allocation with
  commit order. A PostgreSQL identity sequence alone would let a later transaction
  commit first and put an unread event behind a client's cursor. Native CI tests
  this with separate writer connections and a reader while the first commit waits.
- Cursors are `h1:<owner>:<workspace>:<sequence>`, never a timestamp or JS number.
  The local adapter verifies consecutive event positions and the exact next
  cursor. A whole page and its cursor commit atomically with a cursor comparison.
- Runs are coalesced per engine. Logout/cancel fences delayed responses. Requests
  have a bounded timeout even for a transport that ignores AbortSignal. Retries
  use bounded exponential delay; each run/batch/page is bounded.

## Security and portability

The new `sync_heads` and append-only `sync_log` tables have owner RLS and FORCE
RLS. SQL functions are security invoker, fixed empty search path, revoked from
PUBLIC/anon, explicitly granted to authenticated. Nothing adds a schema to the
Supabase Data API or exposes arbitrary SQL/helper functions to clients.

The future gateway must verify JWT issuer, audience, subject and session policy;
then set transaction-local identity and call **only** the two bounded functions.
It must not expose the schema/tables or accept an actor ID supplied by a client.
The stock-Postgres Auth shim is a trusted-gateway context contract, not a JWT
verifier. No secret/service-role key belongs in the browser/APK.

Migration replay uses stock PostgreSQL primitives. The native dump/restore test
now includes tables without an `id` column, comparing all financial and sync
rows/cursors by canonical row fingerprints. Historical transaction markers are
sealed as documented in [DB_PORTABILITY.md](DB_PORTABILITY.md).

Official guidance consulted: [database functions](https://supabase.com/docs/guides/database/functions),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[PostgreSQL transaction advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS).

## Test commands and evidence

```
npm ci
npm run lint
npm test
npm run test:sql
npm run build
```

`npm test` includes the complete HTTP/SQLite/SQL pipeline in PostgreSQL WASM and
the existing suite. Its native-only concurrent commit-order test is explicitly
skipped locally. The disposable native CI job additionally runs `test:sql`,
`test:sync`, then `test:sql-restore`. See
[qa/postgres-sync-evidence.json](qa/postgres-sync-evidence.json) for actual outcomes;
an unexecuted native check is not a PASS.

Tests cover SQLite reopen after offline save; A→Postgres→B and B→Postgres→A;
exact balance; lost acknowledgement/replay; failed SQLite page commit/reopen;
stale acknowledgement/hash/cursor rejection; duplicate runs/logout; immutable
conflict preservation; another owner/foreign cursor; malformed JSON/HTTP errors;
timeouts ignoring cancellation; canonical hash parity; and immutable metadata
snapshots. No customer data or API key is used.

Verified source `bb22c438d40d717a35c46eaac8ac1b9917715a98` passed
[CI 93](https://github.com/ainulhaque-collab/hisab-dekhtechai-app/actions/runs/41823476666):
96 app tests passed (one native-only test skipped in the WASM job), 11 WASM SQL
tests, and native PostgreSQL 17 SQL (12) plus HTTP/SQLite sync tests (12, no skips).
The 10-table scoped dump/restore preserved finance/sync fingerprints, then proved
a restored cursor can push, replay a duplicate and pull the next event. The
initial CI found a missing `@types/pg`; it is now an exact pinned dev dependency
with its lockfile entry, and the clean Node 22 type check passed.

## Required before App activation / PR-3 completion

1. Reconcile the advanced feature branch (`75dde8280ed492083cbf40f8964f8458fa42c740`)
   before replacing an APK: goals, savings loans, AI, PDF, inbox/push and the native
   SQLite connection fixes must be preserved. This main-based branch predates them.
2. Implement the remaining metadata, correction/reversal, budget/recurring,
   receipt, employee, goal and loan commands over shared validated domain paths.
   A server must never accept an event that an initialized client cannot project.
3. Add verified Supabase Auth/gateway adapters and workspace discovery; test token
   refresh, revocation, owner switch, logout during disk commit and re-login. Real
   subject UUIDs must not be guessed from emails or legacy Google hashes.
4. Design explicit, backed-up UUID/legacy-data adoption with user confirmation;
   prove non-destructive upgrade with existing local records and all pending ops.
5. Share one application-wide local write arbiter (including synchronous metadata
   writers), and IndexedDB multi-tab lease/fencing. This adapter serializes its
   own writes only; the Node SQLite test does not prove those UI race conditions.
6. Apply/reconcile the forward migration only after review; perform hosted
   rollback-only synthetic RLS checks/advisors/foreign-object fingerprint check.
   Then mount behind an explicit development gate and verify Android + browser
   offline, restart, concurrent edits, conflict UX, acknowledgement and restore.
7. Remove deprecated Drive code after the replacement passes those gates.

## Rollback

Keep the provider unmounted (current behavior). Reverting this PR removes its
additive modules/tests and the two storage fixes; it needs no data reset, phone
uninstall, hosted rollback or Production change. Once a migration is deployed,
retain accepted logs and use a forward migration instead of dropping financial
or sync tables. Never downgrade a device over newly adopted user records.
