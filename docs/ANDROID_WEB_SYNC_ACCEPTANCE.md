# Android and Web: shared records acceptance

The Android APK uses SQLite and the Web app uses IndexedDB. Both use the existing journal, owner identity and Google Drive appData sync protocol. Hosting on Vercel does not create a shared SQL server. Local edits remain available offline; sync runs while the app is active, online and authorized. Background/closed-app continuous sync is not promised.

## Web hosting preparation

`vercel.json` configures Vite, `npm ci`, `npm run build`, output `dist`, and the SPA fallback described in [Vercel's Vite documentation](https://vercel.com/docs/frameworks/frontend/vite). `.vercelignore` excludes native sources, tools, signing material and local QA output from CLI uploads. The unused development reference ZIP was moved from public assets into `docs/reference/` so it is no longer shipped in the Web bundle or APK. Configuration is prepared locally; a hosted deployment has not been made.

Use a stable HTTPS test origin. Add that exact origin to the existing Google Web OAuth client, in the same Google Cloud project as the Android OAuth client. Use `VITE_GOOGLE_CLIENT_ID` for the public Web client ID and leave `VITE_ENABLE_SYNC_SIMULATION=false`. Never add OAuth client secrets, tokens, signing material or database backups to Vercel build variables or public assets. Review deployment output before publishing.

New origins have separate browser storage. Before switching away from localhost, sync and download a verified backup. Connect the same Google account on the hosted origin and wait for recovery, or import the backup. Changing a Google Cloud project can also change access to existing appData; export and verify recovery before such a change.

## Physical acceptance checklist

Use test records in a clearly named test workspace. Record journal UUIDs, operation IDs, account balances, entry counts and pending status before/after each case. Do not record tokens or private financial contents in shared logs.

- [ ] Connect Android and Web using the same Google account; owner hashes agree.
- [ ] In Android, add a unique test income; wait for sync, then verify the UUID, amount and balance on Web.
- [ ] In Web, add a unique expense; verify the UUID, amount and balance in Android.
- [ ] Offline on Android, add a record and restart the app. It remains locally and is pending; after reconnect it reaches Web exactly once.
- [ ] Repeat manual sync/reload. Record counts and balances remain unchanged.
- [ ] Refresh/reopen Web and resume Android. Reconnect explicitly if Google permission expires; local records remain intact.
- [ ] Reject a different Google account without merging owners or replacing local records.
- [ ] Download a Drive recovery backup and verify restore in an isolated test browser session with the original account.
- [ ] Install a higher-version APK signed with the same permanent key over the first APK, without uninstall or clear-data. Test offline before reconnecting; original UUIDs, balances, pending entries and lock settings remain intact.

Web login, reload retention and downloaded-backup import were confirmed by the owner. Actual Android OAuth, cross-platform record parity, hosted Web acceptance and replacement APK acceptance are pending until observed on the test phone.
