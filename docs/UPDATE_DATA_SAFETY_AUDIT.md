# Update data retention audit

Date: 2026-10-26 (Asia/Dhaka). Requested before home dashboard chart development. Chart source was not changed.

The owner confirmed that the app has **not yet been distributed to customers**. Signing continuity with a customer-installed version is therefore not currently applicable. Establish a stable customer release package/signing identity before the first distribution; still test replacement installation using two successive test builds.

## Conclusion

Normal updates are intended to retain the existing financial database. The reviewed code contains no update-time delete/reset of customer storage, and production storage names remain unchanged. Synthetic upgrade tests pass. This is **not** proof that an installed Android APK can be upgraded safely: the previous APK, its signing identity and a physical-device replacement install have not been inspected. Do not release on the strength of Web or Node tests alone.

## Findings and corrections

1. **Migration wrote too early.** Version-5 migration captured a recovery point through the normal persistence path before ledger validation, potentially writing migrated data even if the migration later failed. The migration now stages its recovery point in memory, retains a separate original-byte backup, validates the ledger, and only then persists the migrated primary database. A failed migration restores the previous in-memory state and leaves original primary bytes unchanged.
2. **Constructor started asynchronous migration without awaiting it.** Legacy localStorage construction now hydrates existing records synchronously; migration runs only during awaited durable initialization. The original schema is retained until migration succeeds.
3. **Future-schema downgrade was not blocked.** The code previously accepted a higher schema while rebuilding only known collections. Unsupported versions now fail before loading or writing, preserving unknown future data rather than dropping fields.
4. **Legacy migration failure was swallowed.** Initialization now propagates failed migration instead of treating it as a ready database. Read-back compares the complete serialized contents, not only account/journal counts.
5. **Web writes acknowledged before commit.** IndexedDB set/delete now await transaction completion and reject transaction errors/aborts, including failure after an individual request succeeds.

## Evidence and limits

`npm test`: **119/119 passed**. `npm run lint`: passed. `npm run build`: passed (existing bundle-size warning).

New cases verify failed-migration original-byte preservation, refusal of a future schema without overwrite, repeated upgrades retaining identical records and pending UUIDs, and IndexedDB late-abort handling. Existing tests cover v4→v5 account/journal preservation, balanced ledger and recovery copies, corrupted JSON preservation, durable-write/commit failures and backup restore. Fixtures are synthetic; no customer records are accessed.

The upgrade test name now explicitly says synthetic migration: it uses a Node fallback storage driver, **not native SQLite**. IndexedDB event tests use an injected transaction object; no real browser database upgrade is claimed.

## Android release gates still open

| Item | Reviewed state / requirement |
|---|---|
| Production application ID | `com.hisabdekhtechai.app`; keep the installed product's identity stable. |
| Debug application ID | `com.hisabdekhtechai.app.debug`; a separate installation with separate data. It is not an in-place update of the production package. |
| Database | Native SQLite name and production record key remain `hisab_dekhtechai_db`; no rename/reset was introduced. |
| Version | `versionCode 2`, `versionName 1.0.1-dev` are static. Every published successor must have a greater versionCode than the installed release; installed version is unknown. |
| Signing | CI calls `assembleDebug` on a fresh runner without restoring a stable debug keystore. Certificate continuity is not guaranteed. Merely listing a release keystore path in Capacitor config does not configure Gradle release signing. |
| Debug/public distribution | The current workflow can publish a debug APK on a version tag or explicit release input. That path must not be treated as an approved customer update or invoked without owner authorization. |
| Existing APK compatibility | Compare application ID and signing identity/valid signing lineage against the installed APK. If Android rejects the update, **do not uninstall** to work around it. |
| OS backup | Manifest sets `allowBackup=false`; do not rely on Android automatic backup after uninstall. Keep a verified Drive copy and a separately downloaded JSON backup. |
| Native proof | Java/ADB are unavailable in this environment; no native compile, installed-package inspection, or physical upgrade was performed. |

## Required replacement-install acceptance

On a dedicated test phone/profile with the actual older APK, create synthetic accounts, journals, edits/reversals, archived items and unsynced offline operations. Record IDs, counts, balances, owner identity, device sequence, app-lock settings and local media. Keep a separate backup.

Build a newer APK with compatible package/signing identity and increased versionCode, then install it **over** the old app without uninstalling or clearing data. Open it while offline first. Compare all recorded IDs/counts/balances and pending operations; verify ledger integrity and app lock/media. Reconnect and ensure the same pending UUIDs sync exactly once. Repeat a failed/interrupted migration in a disposable test fixture. Preserve signing evidence and results before customer rollout.

## Web retention

Keep the production origin (scheme, hostname and port), IndexedDB name and database key stable. Changing localhost to a LAN IP, switching HTTP/HTTPS, changing domains or moving between Incognito and normal profiles opens a different storage context; this can look like missing data. Incognito closure, clearing site data, browser eviction and app uninstall differ from a normal update and can remove local-only records. Verified cloud sync and an independent exported backup provide separate recovery paths; never clear customer storage as an update troubleshooting step.

## Dashboard charts

No charts were implemented in the storage-audit commit `e3b9ab3`. After its 119 passing tests, two read-only homepage charts were added separately: this month's income versus expense, and a selectable expense-category donut. Both consume existing `DashboardData`; remaining categories and transfer fees are grouped as other expenses so the donut covers the expense total. Amounts remain integer minor units; only display ratios become numbers. Empty states and balance privacy are handled. Historical balance trends were not fabricated from the limited recent-history list. Chart TypeScript and production-build checks passed; live browser visual acceptance is pending. Database identity, schema, signing configuration and financial calculations are unchanged by the charts.

References:

- [Android app signing and update identity](https://developer.android.com/studio/publish/app-signing)
- [Android versionCode requirements](https://developer.android.com/studio/publish/versioning)
