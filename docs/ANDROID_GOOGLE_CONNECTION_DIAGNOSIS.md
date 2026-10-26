# Android Google connection investigation — 2026-10-26

The owner reported that signed APK `1.0.2-test` immediately shows the generic sync error after tapping Continue with Google, without an account chooser. Screenshot shows the local-record retention message. Initial process-filtered error logs did not contain a crash or explain the rejection. A silent native grant is possible when permission already exists; the absence of a chooser alone does not identify the failing stage.

## Confirmed code defects and changes

- The installed native SQLite SDK's `run()` defaults to starting its own transaction. The durability driver called it inside the explicit transaction used by bootstrap/owner binding and journal commits. The SDK rejects nested transactions with `Already in transaction`, and its automatic rollback can also end the outer transaction. Writes/deletes now join the explicit transaction; standalone writes retain their automatic transaction.
- Native bridge errors may arrive as objects containing `code`/`message`. Error presentation now reads both safely and returns static actionable messages for integration availability, Android OAuth configuration and SQLite transaction failures. Raw tokens, owner identifiers and response bodies are not displayed.
- Native authorization logs now contain only fixed stage names, plugin-registration availability and numeric Google status codes. They never log account data or tokens. A missing native Google integration is checked before invoking the plugin.

Focused regression tests exercise the installed SDK's strict transaction contract through the real driver, LocalDatabase and sync bootstrap. They verify durable owner retention after reopening, rollback after injected write failure, standalone writes/deletes and sanitized native error objects. All three focused tests and TypeScript passed before rebuilding. Physical confirmation of the screenshot's exact failure remains pending until the corrected APK is tested.

Version 4 (`1.0.3-test`) finished building before this correction and was preserved but not installed. The corrected candidate uses a higher version and the same permanent package/signing identity. Existing app data must be retained with replacement installation; never uninstall or clear-data to diagnose this issue.

## Corrected candidate and physical update

- Source: `d81c9780095a13f7a30898f4b79d96ba4214292f`.
- All 122 tests, TypeScript, Vite production build, native Java compilation, release lint and R8 passed; 127 Gradle tasks completed successfully.
- APK: `build/test-apks/hisab-1.0.4-test-v5.apk`; actual manifest package `com.hisabdekhtechai.app`, versionCode `5`, versionName `1.0.4-test`.
- APK SHA-256: `C504AED82FB98213CAB39BE1ABF8FA6A9055A5CF7D28B72EEFA2C2194A48EEE1`; signing certificate matches the permanent identity.
- TECNO CM6 / Android 16: replacement installation over version 3 succeeded and launch returned `Status: ok`.
- Primary-user first installation time remains `2026-10-26 19:17:09`; data directory remains `/data/user/0/com.hisabdekhtechai.app`; last update time became `2026-10-26 19:55:59`. This confirms replacement installation, not financial-row parity.
- Fixed native diagnostic after launch: `Google plugin registered=true`. Google retry and record/sync acceptance remain pending owner feedback.

## Version 5 result and confirmed connection-lifecycle root cause

The owner reported that Google connection still failed and saving an expense displayed `Transaction already in progress.` Restarting only the app process exposed the first failure: `BeginTransaction: No available connection for database hisab_dekhtechai_db`.

Each durable store previously constructed its own `SQLiteConnection`. The workspace image store opens `hisab_workspace_media_v1`; its fresh, empty JavaScript connection dictionary calls `checkConnectionsConsistency()`. The installed Android SDK explicitly calls `closeAllConnections()` when that dictionary is empty, closing the already-open financial database. The old driver's stale handle then fails transaction begin. LocalDatabase also set its in-memory lock before native begin and did not release it if begin rejected, blocking later journals.

All native stores now share one connection manager, with consistency checked once and database opening serialized/deduplicated. Existing database names/files stay unchanged. Failed store opening can retry without closing another store. Transaction begin waits for storage initialization and releases only its own local lock on rejection; the bridge's original storage error is preserved. No data deletion or silent fallback is used.

Five focused tests and all 124 tests plus TypeScript passed. New regressions cover opening media while retaining the ledger connection, failed media-open retry, native begin failure and a successful later transaction retry. Physical confirmation of expense saving and Google/Drive sync remains pending; version 5 did not satisfy those checks.

## Version 6 build and replacement installation

- Source: `db17bfff34fa31616266f9a85e25d668099df256`.
- All 124 tests, TypeScript, Vite production build and native release build passed. Gradle completed 127 tasks in 10m 6s.
- Preserved APK: `build/test-apks/hisab-1.0.5-test-v6.apk`; manifest package `com.hisabdekhtechai.app`, versionCode `6`, versionName `1.0.5-test`.
- APK SHA-256: `B7BA4D76049DFE5E43EEDA7F0AA7B0E5A08A7B5A6959C60D620A09E5833011B8`; signature matches the existing permanent identity.
- Replacement installation over version 5 succeeded on the owner's TECNO CM6. Cold launch returned `Status: ok`; installed package reports version 6 / `1.0.5-test`.
- Primary-user first installation time remains `2026-10-26 19:17:09`, data directory remains `/data/user/0/com.hisabdekhtechai.app`, last update time is `2026-10-26 20:25:36`. No uninstall or clear-data was performed. These installation facts do not establish financial-row retention or successful sync.
- Owner confirmed that saving the previous BDT 120 test expense succeeded on version 6 before connecting Google. This is physical confirmation of the expense-save correction. Google connection, cross-device parity, persistence after a later restart/update and backup verification remain pending.

## Unreadable offline-ownership confirmation

After saving the first expense, the owner saw a native Cancel / OK dialog with no readable message. The only confirmation before Google authorization in this path is AppContext's offline ownership binding prompt: link this device's existing offline records to the selected Google account, using only the owner's account. This prompt is required once a new unbound installation has financial records; it is not a Google authorization error. No consent is bypassed.

Capacitor's installed BridgeWebChromeClient implements this prompt with `android.app.AlertDialog.Builder(view.getContext())`. The app combines a DayNight base theme with a forced white window surface. An explicit platform light alert-dialog theme now sets dark primary/secondary text and a blue accent, inherited by the activity's launch theme. This applies to other native backup/sign-out confirmations too. Native resource compilation and physical readability remain to be verified in the next signed candidate.

The first version 7 build passed all 124 tests, TypeScript, Web build, native resource compilation and release lint, but the JVM crashed during R8. Its crash header explicitly reports insufficient native memory (`malloc` failed for 1,510,896 bytes) on this 8 GB host, with a 2 GB Java heap. No new APK was preserved or installed. The signed-build script now offers `-LowMemory` (1 GB heap, two JVM processors, one Gradle worker), targeting only `:app:assembleRelease`; all validation/signature gates remain required.

## Version 7 low-memory build and installation

- Source: `7f5ddd4afa551576995cb6a3d70f784dc141d176`. All 124 tests, TypeScript, Web build and native release build passed. Gradle completed 118 tasks in 9m 38s using `-LowMemory`.
- Preserved APK: `build/test-apks/hisab-1.0.6-test-v7.apk`; verified package `com.hisabdekhtechai.app`, versionCode `7`, versionName `1.0.6-test`.
- APK SHA-256: `B9B4BE759656A94B9878D4CE44663106A52520EC4907E852205DD999494FDDAA`; signature matches the permanent signing certificate.
- Replacement installation over version 6 succeeded. Cold launch returned `Status: ok`; installed package reports version 7. Primary-user firstInstallTime remains `2026-10-26 19:17:09`, dataDir remains `/data/user/0/com.hisabdekhtechai.app`, lastUpdateTime is `2026-10-26 20:58:25`.
- No uninstall/clear-data was performed. Owner has been asked to check the previously saved BDT 120 expense, confirm dialog readability, and then test Google connection/sync. These functional acceptance checks are pending; install timestamps alone do not prove financial-row retention.

## Owner feedback after version 7

The owner reports that Continue with Google now proceeds directly to syncing, without displaying the earlier confirmation. This confirms the owner's observed connection/sync flow now works; the exact account, successful-sync timestamp and verified-backup timestamp have not yet been independently checked. Existing Google authorization and a previously bound dataset can explain why account selection/ownership confirmation no longer appears. The absent dialog does not establish that its readability fix has been visually verified.

The owner has been asked to check that the BDT 120 expense remains after the replacement update, that the correct Gmail and successful-sync time appear, and that the phone-created expense arrives in the same-account Web app. Cross-device parity, verified Drive backup and full update retention acceptance remain pending.

The owner subsequently confirmed that a sync timestamp is displayed and the phone-created expense has arrived in the Web app. This establishes owner-observed Android-to-Web record propagation on version 7. It does not establish exact UUID/count/balance parity, reverse propagation, a verified backup or full upgrade retention.

Next manual check: create one BDT 10 test income in the same workspace on Web, note `Web sync test`, save once and confirm arrival on Android. Also check whether the Google Drive Sync panel shows a Verified Drive backup timestamp. Both results remain pending.
