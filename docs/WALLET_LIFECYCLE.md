# Wallet editing, archive, restore and permanent removal

All wallets now offers Active / Archived lists and actions on each wallet card.

- Edit changes the wallet name and linked workspace account names atomically.
  Wallet code, kind, opening balances and all financial postings are retained.
  Existing per-workspace account aliases can still be edited separately.
- Delete from Active requires exactly `DELETE` and moves the wallet to Archived.
  Archived funds stay in physical totals. Every linked allocation is unavailable
  for new entries, transfers, goal funding and loan movements until restored.
- Restore reactivates the registry without unarchiving allocations that were
  independently archived earlier.
- Delete permanently from Archived requires `DELETE` again. Every linked
  allocation must have zero balance, no goal reservation and no outstanding
  loan. Offsetting positive/negative workspace shares cannot bypass this check.
  A retained tombstone hides the wallet from both lists; journal, allocation,
  loan and audit history remains available to reports and backup validation.

Lifecycle commands are append-only workspace metadata with command IDs and
expected revisions. A stale/forked revision is rejected; missing revisions are
pending, never silently resolved by time. Each command and its outbox entries
commit in one local transaction. Archive is a derived view over accounts, so
restoring cannot erase an earlier independent account archive flag.

The local schema stays 6; no financial migration, ownership adoption, remote
schema change or Drive work. Backups containing these new wallet commands need
this reader or newer; old APKs must not be installed as a data rollback.

Regression covers wrong confirmations, multi-workspace balances, blocked
spending/funding/linking, idempotent retries, ownership, stale and concurrent
edits, durable rollback, partial/unordered history, permanent tombstones,
outstanding loans, reservations, reload and isolated file-backup restore.

The APK continues to ship with AI disabled. Public release and financial cloud
cutover remain separate gates.
