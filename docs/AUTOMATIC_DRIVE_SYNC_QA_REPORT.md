# Automatic Google Drive sync and backup — implementation / QA

Updated: 2026-10-26 (Asia/Dhaka). The owner confirmed live Web login, connection retention after Chrome refresh, and automatic sync. Android/Web exchange and downloaded-backup acceptance remain pending.

## Implemented behavior

- Normal localhost development and production use real Google Drive transport and stable, unique device identities. Simulation requires an explicit development flag and uses a separate database. Existing customer database keys remain unchanged.
- While the app is visible, durable local changes schedule sync after 750 ms. A 15-second foreground poll receives remote changes even without a local edit. Opening, resuming, or reconnecting requests a sync. Retry backoff preserves pending writes. This is eventual synchronization, not a realtime push service or a background execution guarantee.
- Browser timers never open Google consent popups. Expired browser authorization requires a user to reconnect. Android attempts existing native authorization without interaction; a new grant still requires explicit login.
- Refresh recovery: a short-lived AES-GCM token envelope in sessionStorage plus a non-extractable IndexedDB CryptoKey lets the same tab recover an unexpired grant after reload. Before using it, Google userinfo must verify the original subject. No plaintext token enters localStorage, IndexedDB, the ledger or backups. Expiry/revocation/log out remove recovery; unavailable storage retains memory-only behavior. This is not an OS credential vault and does not protect against malicious same-origin JavaScript. Tab/session lifecycle remains controlled by the browser; this is not a permanent login.
- A durable owner-bound last-sync receipt keeps the historical successful timestamp visible after reload, separately from current authorization. Idle receipts are persisted at most once per minute. No historical receipt marks the present connection as synchronized.
- New devices fetch retained cloud operations before publishing starter definitions. Metadata, groups, parties, categories, budgets, rules, journal corrections and reversals are included. Uploaded operations retain original device IDs. Incoming journals validate amounts, balance, immutable IDs and dependencies before atomic application.
- Successful reconciliation creates an immutable complete JSON recovery copy in Drive appDataFolder and downloads it again to verify its bytes, checksum, financial content and owner. Unchanged copies are reused; missing copies are recreated. The UI shows the last verified backup and can save a downloaded copy through the existing file-backup flow.
- Operation logs and older backups are retained. No cloud garbage collection or local customer storage reset is introduced. Tokens are excluded from backup payloads.

## Automated evidence

- Initial automatic-sync change: `npm test` **105 / 105 passed**. Includes 16 new cases for durable notifications, debounce/polling, offline retry, fresh-device reconstruction, metadata, journal correction/deletion, corrupt backups, invalid journals, authorization expiry, device identity migration, dependency ordering, and offline writes to deleted empty accounts.
- Refresh regression: 8 additional tests pass with actual Web Crypto AES-GCM and structured-cloned non-extractable keys, using an injected in-memory key store. They cover new-manager restoration without a popup, concurrent restore deduplication, subject/origin/client mismatch, tampering, expiry/revocation, logout during verification, temporary network failure, unavailable storage and historical sync receipts. This tests crypto and auth behavior, not a real browser IndexedDB implementation.
- Combined refresh verification: `npm test` **113 / 113 passed**, `npm run lint` passed, `npm run build` passed. Separately, the owner confirmed that Chrome remained connected and automatically synchronized after signing in once with the new code and refreshing the same tab. This is owner-reported live acceptance, not an automated browser observation.
- A REST contract test exercises the real Drive transport against synthetic HTTP responses: separate Android/Web tokens, multipart upload, appData listing, quota, read-back verification, backup download and changed-file cache invalidation. This does **not** establish that two real OAuth clients share Google storage.
- `npm run lint`: passed. `npm run build`: passed (existing large-bundle warning remains). `npx cap sync android`: passed, including SQLite plugin discovery. Generated assets are rebuilt by CI and are excluded from this source change.
- Browser visual QA for the new sync panel was unavailable: access to the local browser page was denied by the browser security policy. Existing screenshots from earlier work do not validate this change.

## Live OAuth result: tester gate resolved

The owner's first live attempt reported Google's "only developer-approved testers" screen. After the test-user guidance, the owner confirmed that login succeeded. The tester gate is resolved for that account; verified live backup/download and Android/Web exchange are still awaiting confirmation.

The owner then reported that initial sign-in synced but refresh disconnected. Their screenshot showed a retained verified-backup timestamp alongside "Not connected" and "Not synced yet". Code inspection confirmed two causes: memory-only browser authorization was discarded on reload, and the successful-sync timestamp was only in orchestrator memory. After the fix in commit `9952952`, the owner confirmed that the same Chrome tab stayed connected after refresh and automatic sync continued. No actual token expiry, browser restart, or Android/Web exchange result is implied by this confirmation.

In the Cloud project that owns the configured Web OAuth client:

1. Open **Google Auth Platform → Audience**.
2. Under **Test users**, choose **Add users**, add the exact Google account used to sign in, and save.
3. Retry **Continue with Google** at `http://localhost:3000`.

Do not publish the app solely to bypass this testing restriction. An owner with access to the OAuth project must update its test-user list. No real account email or token is stored in this report.

Developer configuration: enable Google Drive API; register `http://localhost:3000` as the Web client's authorized JavaScript origin; keep Android and Web clients in the same intended Cloud project. The code's fallback Web client belongs to project number `271505920973`; an environment override can select a different public client ID. Match the actual configured client, not just the app display name. Android OAuth must match the installed package (`com.hisabdekhtechai.app.debug` for debug, `com.hisabdekhtechai.app` for release) and its signing certificate.

## Remaining acceptance / limits

### Backup import regression after same-owner login

The owner reported `BACKUP_CONFLICT` after logging into the clean test browser and importing the downloaded file. A synthetic reproduction of that exact sequence failed before the fix: local operation copies in a backup could have a blank `contentSha256`, while the same operation downloaded through Drive had its computed payload checksum. Strict whole-operation comparison mistook this derived field for changed financial content.

Restore now verifies any populated operation checksum, compares every other operation field exactly, and preserves existing records. New queued operations receive their payload checksum immediately. Legacy blank-checksum backups remain supported; changed payloads, wrong ownership, unbalanced journals and incompatible balances remain blocked. A ledger-validation fixture now recomputes its deliberately modified operation's checksum so it still tests journal balancing independently of checksum rejection.

Verification: **115 / 115 tests passed**, TypeScript check passed, production Web build passed. New regressions cover repeated import after same-owner cloud restore, blank-versus-computed checksum compatibility, altered payloads and damaged checksums with no replacement of current state. The owner was asked to retry the same downloaded backup; real browser import acceptance is pending.

- Live Web login and automatic sync after refresh are owner-confirmed. Still confirm that a verified backup can be downloaded and decoded.
- Build/install the current Android source, log in with the same Google owner in Android and Web, then test both directions with a small entry, offline entries, relaunch, correction and deletion. Compare journal IDs and balances, then restore on a separate clean test profile. Never clear the existing customer's storage for testing.
- Native Java compilation, installed APK behavior and actual cross-client Drive compatibility have not been proven in this environment. Native resume events have been wired, but there is no continuous background worker.
- Complete checkpoints are recovery downloads; initial automatic reconstruction currently replays all retained operation files. Automatic checkpoint-based fast restore and log compaction are not implemented.
- Concurrent metadata edits still use the existing application behavior; a complete revision/conflict policy is outside this change. Stored receipt-blob records can be included, but the existing transaction receipt picker still does not persist real photograph bytes. Workspace image assets remain local.
- During Google Testing, authorizations involving additional scopes expire after seven days. Browser access tokens can expire sooner and require reconnecting. No client secret or refresh-token service is embedded in the app.

Official references:

- [Google Testing audience and authorization lifetime](https://support.google.com/cloud/answer/15549945?hl=en)
- [Drive private app data](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Browser OAuth token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
