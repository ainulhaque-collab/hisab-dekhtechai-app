# Deletion, live synchronization and recovery

Normal add/edit/archive/delete commits are queued locally and shared while the account is connected, online and the app is visible. Offline commits catch up on reconnect. Recovery snapshots never restore themselves merely because connectivity returns; the live canonical dataset is authoritative on a fresh online installation.

Wallets and savings goals have an archive/restore stage, followed by permanent deletion with exact `DELETE` confirmation and finance-specific guards. Permanent tombstones are retained in immutable operation history and cannot be restored as active records. Posted transactions use balanced reversals/corrections and retain an audit trail; their existing UI is not a universal two-stage archive/permanent-delete workflow. Referenced/nonzero legacy accounts must remain archived rather than physically disappear.

## Fixed old-file resurrection

An unused legacy account was removed from the account map, but importing a pre-delete file could reinsert its old row despite retaining `account.delete`. The fix derives permanent account IDs from validated retained deletion operations during file merging, hydration and live reconciliation. A stale metadata edit cannot resurrect the ID. A later financial posting against that deleted account causes a conflict rather than silently dropping the posting or reactivating the account.

The existing owner-scoped `hisab_live_put` RPC now rejects an account row whose retained history contains its permanent deletion, including requests from older clients. No new API, table, privilege, Auth setting or data purge is added. Applied migration: `20261107115625_hisab_deletion_guards`; its source is `server/recovery/003_deletion_guard.sql`. The CLI generated the initial local migration file; its filename was aligned to the version actually assigned by the hosted migration tool.

Backups can retain historical pre-deletion data. A connected account with current deletion history keeps those deletions when importing an older file. An entirely fresh offline installation holding only an old file cannot know later cloud deletions: sign into the account and load current live data first. A conflict pauses synchronization; it does not automatically choose a backup or overwrite current records. Manual conflict-resolution UI and two-real-phone acceptance remain separate pending work.

Verification includes two durable SQLite clients, offline stale rename/deletion, old file import/reload, wallet/goal archive/restore/permanent deletion, journal correction/void and a simultaneous independent entry. The actual hosted guard was exercised with rollback-only synthetic data; the owned canonical copy stayed unchanged and anonymous execution remains denied. No real customer entry was created or deleted for these tests.
