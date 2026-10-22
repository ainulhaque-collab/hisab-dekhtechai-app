# 04 — SQLITE DATA MODEL, INVARIANTS, MIGRATION STRATEGY

## 1. Goals
Exact offline financial integrity, independent workspaces under a single Google owner, stable UUIDs across devices, deterministic application of immutable sync operations, never destructive upgrade.

## 2. Data model
| Table | Key fields | Constraints/notes |
|---|---|---|
| `local_identity` | id, google_subject_hash, account_display_hint, created_at | device-only, subject match guards dataset |
| `device_identity` | device_id, counter, created_at | random UUID; counter durable and monotonic |
| `workspaces` | id, owner_subject_hash, name, kind, currency='BDT', archived_at | distinct local contexts, single owner |
| `ledger_groups` | id, workspace_id, name, icon, archived_at | display grouping |
| `ledgers` | id, workspace_id, group_id, name, archived_at | display/accounting grouping |
| `accounts` | id, workspace_id, ledger_id, name, kind, opening_balance_minor, archived_at | Cash/bKash/Bank are asset accounts; debt optional later |
| `categories` | id, workspace_id, parent_id, kind, name, archived_at | expense/income classification |
| `journal_transactions` | id, workspace_id, type, occurred_at_utc, effective_local_date, note, original_of, reversal_of, created_op_id | posted immutable event |
| `journal_lines` | id, transaction_id, account_id, debit_minor, credit_minor, category_id | `CHECK` nonnegative and exactly one positive side |
| `sync_operations` | op_id, owner_hash, device_id, device_seq, type, payload_json, schema_version, payload_hash, created_at | immutable source of data, unique `(device_id, device_seq)` |
| `sync_outbox` | op_id, uploaded_status, remote_file_id, retry_count, last_error, next_attempt_at | local durable queue and receipt |
| `applied_operations` | op_id, applied_at, source_device | uniqueness for dedupe |
| `sync_device_heads` | device_id, contiguous_seq, updated_at | incoming contiguous prefix per device |
| `sync_cursor` | drive_space, cursor, last_scanned_at | optimization, never trust cursor alone |
| `conflicts` | id, entity_id, base_version, contender_op_ids_json, status, resolution_op_id | never silent last writer wins |
| `local_snapshots` | id, db_schema_version, path, hash, verified_at, created_at | migration recovery only; protected local area |
| `backup_checkpoints` | id, cloud_file_id, format_version, per_device_heads_json, hash, verified_at | verified cloud checkpoints |
| `schema_migrations` | from_version, to_version, checksum, applied_at | migration ledger |
| `budgets` | id, workspace_id, category_id, period, limit_minor, alert_thresholds_json, revision | synced business entity |
| `recurring_rules` | id, workspace_id, template_json, due_rule, timezone, auto_post_enabled, revision | locally processed rule |
| `recurring_occurrences` | id, rule_id, effective_date, transaction_id, status | UNIQUE(rule_id, effective_date), merge-safe |
| `receipt_blobs` | sha256, local_path, content_type, byte_length, cloud_file_id, upload_status | content-addressed attachments; private platform files |
| `app_preferences` | key, value_json | language, theme, sync policy etc. |

The shared financial schema may also need true chart-of-accounts classifications for sales/expense/equity and journal balancing; implement at **domain layer** and validate at **SQLite boundary**. Transactions should never directly set an account balance aggregate as source of truth.

## 3. Financial invariants
- Currency V1 BDT only. All values **integer paisa** and safe validated serialization; JSON amounts are decimal strings.
- Every posted transaction has >=2 lines with `sum(debit_minor) === sum(credit_minor)`.
- Income: debit asset (Cash), credit revenue account; Expense: debit expense, credit asset; Transfer: debit destination asset, credit source asset; fees: debit fee expense additionally.
- Cash/bKash/bank balances derive from journal + controlled opening balance entries; transfers never counted as income/expense.
- A correction creates reversal + replacement **atomically**, references original ID, and retains audit provenance. Concurrent replacement attempts from same base require a conflict record.
- Category/ledger rename must not alter historic monetary amounts. Tombstones (archived/deleted) are synced; delete financial history only by a separate approved data deletion policy.
- Each user operation generates **one** immutable `op_id` and durable local outbox record in same SQLite transaction as state change. No committed transaction without queued sync intent.
- All new records carry `workspace_id`. Cross-workspace transfer not supported as a silent single transaction; require explicit transfer mapping/design if added later.

## 4. Conceptual SQLite schema excerpt (agent must review and implement migrations)
```sql
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  owner_subject_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('personal','business')),
  currency TEXT NOT NULL DEFAULT 'BDT',
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS journal_transactions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('opening','income','expense','transfer','reversal','correction')),
  effective_date TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  note TEXT,
  reversal_of TEXT REFERENCES journal_transactions(id),
  created_op_id TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS journal_lines (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES journal_transactions(id),
  account_id TEXT NOT NULL,
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK(debit_minor >= 0),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_minor >= 0),
  CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
);
CREATE TABLE IF NOT EXISTS sync_operations (
  op_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  device_seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  UNIQUE(device_id, device_seq)
);
CREATE TABLE IF NOT EXISTS applied_operations (
  op_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_outbox (
  op_id TEXT PRIMARY KEY REFERENCES sync_operations(op_id),
  uploaded_status TEXT NOT NULL DEFAULT 'pending'
);
```
*This is **illustrative partial DDL**, not all tables or a complete banking-grade posting implementation. Add account/category FK references, indexes, audit metadata, and migration tests. Do not use SQLite `REAL` for money.*

## 5. Atomic local post pseudocode
```text
POST_FINANCIAL_EVENT(command):
  validate active owner, workspace, amount >0, valid account ownership
  journal = domain.buildBalancedJournal(command)
  assert journal.debits == journal.credits, no unsafe JS number conversions
  op = makeOperation(uuid, deviceId, counter++, baseRevision, journal)
  BEGIN IMMEDIATE TRANSACTION
    insert journal transaction and all lines
    insert sync_operations(op)
    insert sync_outbox(op.id)
    insert applied_operations(op.id)
    update durable device counter
  COMMIT
  return SavedLocally with pending-sync indicator
```
**Crash proof:** injection after every write step must leave either 0 rows or entire committed event + outbox.

## 6. Non-destructive migrations
1. Track `PRAGMA user_version` and explicit migration metadata. SQL migration scripts `001_init.sql`, `002_...sql` append only.
2. Before upgrade: obtain consistent DB snapshot (SQLite backup/checkpoint semantics, including WAL), confirm readable, checksum, preserve outbox and identity.
3. Apply migration transactionally; all tables accessible; invariant totals and count of posted journal records and pending ops cannot mysteriously shrink.
4. After migration, ensure device app can read new schema, restore previous consistent snapshot if necessary; do not auto-upload unknown/corrupt migration results.
5. Hard fail safely if database version is newer than app version (downgrade): show read-only recovery and offer update, don't rewrite file.
6. Keep past DB format golden fixtures and migration unit tests for **every** supported released version.
7. Never use destructive migration, delete/recreate app database on ordinary update, or reset sync cursors by wiping operations.

## 7. Timestamp model
- Store all system timestamps in UTC ISO-8601. Store user's transaction **effective date** separately (YYYY-MM-DD) in workspace timezone `Asia/Dhaka` default, not derived from midnight UTC at render time.
- Date-range filters use effective date. Export includes both effective date and full UTC timestamp when relevant.

## 8. Bootstrap / checkpoint rehydration
On empty local DB, import verified complete checkpoint to a temp DB and replay **all** op segments above stored per-device contiguous heads. Never mark restore complete if required segments are missing/unverified. If no checkpoint, replay entire immutable log. The implementation must prove that no late-offline-device operations are pruned prematurely.

## 9. Recurring & attachment correctness
- Recurring transactions cannot post twice when both offline devices run the same rule. Derive a deterministic *occurrence identity* from `(rule_id, effective_local_due_date, rule_generation)` and require uniqueness during replay. If rule timing changed concurrently, preserve competing versions and resolve.
- Notifications should not imply a financial posting occurred. If auto-post is enabled, same exactly-once journal/outbox guarantees apply and due-date must be deterministic in workspace timezone.
- Receipt attachments are independent hashed immutable blobs with operation references; if blob unavailable on new phone, preserve the transaction, show `Attachment pending download`, retry, never silently erase its link.
