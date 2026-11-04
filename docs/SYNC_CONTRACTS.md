# PR-1 — Provider-neutral financial sync contracts

2026-11-04. Implements the **domain/contracts** milestone of the active
[handover](PR_SUPABASE_LOCAL_FIRST_AGENT_HANDOVER.md). Parent review: PR #10.

## Delivered boundary

- `contracts/financialSync.ts`: `LocalOnly | Postgres`, verified identity/Auth
  port, scoped operation envelopes, push outcomes, opaque pull cursors and a
  local-store port requiring atomic cursor/merge and acknowledgement writes.
- `sync/providers/localOnly.ts`: zero network or database access. Returns
  `local_only`, never a fabricated remote acknowledgement or empty cloud page.
  Selecting Postgres requires an explicit adapter; missing/invalid configuration
  fails closed. There is no Drive provider or automatic provider downgrade.
- `sync/financialSyncBoundary.ts`: validates routing IDs, version, device
  sequence, supported operation kinds, request/result correlation and response
  scope. Only matching accepted/duplicate ID+hash pairs become acknowledgement
  candidates. Conflicts, rejections and retries stay pending.
- `syncMinorUnits`: exact canonical decimal strings within signed Postgres
  bigint range; rejects JSON numbers, fractions, unsafe values and overflow.
  Domain handlers still enforce non-negative debit/credit and journal balance.

These modules are **not imported by App/AppContext**. They do not switch the
currently installed app, change Auth, adopt a dataset or activate Postgres sync.
The earlier feature branches and installed APK remain intact. Current legacy
imports remain until replacement tests pass; no Drive capability is extended.

## Protocol rules

1. Verified identity comes from the Auth adapter. Email, user metadata and the
   legacy Google subject hash cannot grant cloud ownership. Scope is a local
   routing fence, not server authorization. The future server must validate its
   issuer/session and enforce workspace membership/RLS on every request.
2. Local posting uses the existing balanced journal + atomic outbox path first.
   Sync never sits in the user's Save transaction or awaits network to save.
3. Operation IDs are UUIDs, sequences are positive decimal strings (int64),
   strictly increasing within a push batch. Gaps are allowed when filtering one
   workspace from a device's global sequence. Maximum push/page size is 100.
4. A request carries an independently generated UUID. A reply must match it,
   owner, workspace and every submitted operation's ID/hash exactly once.
   Partial, duplicate, unknown or mismatched outcomes reject the **whole reply**
   before any acknowledgement candidate is returned. HTTP 200 alone proves
   nothing. Repeated valid replies remain idempotent candidates, not new posts.
5. The future local store must compare the current owner/workspace binding and
   **current pending operation hash** atomically before clearing an outbox item.
   The returned ID/hash pairs and array are immutable. This milestone does not
   implement a database acknowledgement writer.
6. Pull cursors are opaque bounded strings, not JavaScript numbers, timestamps
   or client-computed maxima. A page must match the requested previous cursor.
   Non-progress pages with changes/hasMore, cursor resets, duplicate events and
   foreign-workspace operations are rejected. Other devices' changes are valid.
7. Validate domain payloads, then merge the complete page and store its cursor
   in **one** durable local transaction with an expected-cursor comparison.
   Validation here writes nothing and cannot advance a cursor on its own.
8. `payload` deliberately remains unknown domain data at this boundary. Its
   schema, dependencies, cryptographic canonical hash, authority and immutable
   journal semantics must be checked by shared use cases/server handlers before
   application. Envelope validation is not proof of a valid journal or access.
9. Current local IDs/owner hashes are not silently rewritten into cloud UUIDs.
   Migration mapping and a normalized immutable wire payload are a later gate.
   Values exceeding signed bigint are retained locally and rejected for upload,
   never rounded/truncated. Existing SQL numeric columns are unchanged.

## Preservation and verification

The PR adds new modules/tests/docs only; no existing App, storage driver,
financial engine, schema, credential or Android source is changed. New tests
cover exact money, foreign/stale/partial replies, duplicates, conflicts, opaque
cursors, routing errors and a real LocalDatabase + synthetic durable-driver
offline journal/outbox reload while fetch is unavailable.

Run `npm run lint`, `npm test`, `npm run build`. Local logs are in ignored
`build/pr1/`. These are local/synthetic protocol tests, **not hosted Postgres
sync, device SQLite crash, two-user RLS or real multi-device acceptance**. The
installed APK is not replaced for this unmounted contract milestone. Current
bundle warnings and earlier feature-branch reconciliation remain separate work.

## Next gates and rollback

PR-2: reconcile the two already-applied Hisab migrations, add/replay portable
SQL and Auth adapters, document `DB_PORTABILITY.md`, run isolation/balance tests
without touching DeshPath. PR-3: implement the remote adapter and local-store
port, domain payload/hash validation, durable push/pull cursors, logout/binding
fences, atomic merges and two-client offline/restart/conflict proof. Only then
mount provider routing, migrate with explicit confirmation and remove Drive.

Rollback: revert these additive files. No remote schema/data or user migration
is performed by PR-1. No new dependency, paid service or Production change.

Official security guidance checked: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
The official changelog was reviewed; this milestone changes no SDK/API call or
TLS configuration. Postgres API/SDK-specific code stays outside these contracts.
