# Workspace, settings and backup follow-up

Date: 2026-10-26. Local development changes on `fix/android-pickers-sync-security-and-ux`, based on `bf729ce`. The existing Play Services and CI commits were preserved.

## Implemented behavior

- Untouched default workspaces can be deleted, including the final unused one. Workspace tombstones and child records are retained; real journals, custom records and financial references still require archiving. Empty starter-only recovery points no longer block deletion. The empty app screen provides a create-workspace action.
- Optional workspace descriptions, limited to 500 characters, persist and replay through existing workspace operations.
- Accounts have explicit Active and Archived lists with counts, restore controls, archive undo, durable save/error handling, and unchanged consolidated/group balances.
- Settings centralizes profile, workspace management, language, sounds/haptics, security, backup/recovery and privacy. The header retains sync status and workspace navigation.
- Bundled Inter and Noto Sans Bengali variable fonts work offline, including Bengali digits. Font licenses are in `public/fonts`. Modal, settings navigation and selector animations respect reduced-motion preferences.
- Backup files are versioned JSON with real UTF-8 SHA-256 checksums, bounded size, owner checks and ledger validation. Restore adds missing records without discarding newer records or pending operations. Conflicting financial records are rejected. Fresh installations replace untouched starter metadata with the restored names/opening balances and enqueue recovered metadata for sync. Recovery points exclude previous snapshot payloads, preventing recursive growth.
- File export remains possible after an internal storage write failure without hiding that failure. Active transactions cannot be exported as committed records.
- Web backup uses browser downloads and file input. Android uses an app-local Capacitor plugin with the system document picker; no broad storage permission is requested. Files contain financial data in plain JSON. Workspace photos and device PIN/biometric settings are outside these backups, as stated in the UI.
- Google sign-in is invoked inside the original tap. LAN HTTP receives specific guidance instead of a generic failure. Manual sync errors propagate to visible recovery controls. Cloud uploads are read back before pending operations are acknowledged, and restored operations keep their original device/sequence identity.

## Verification

- `npm run lint`: PASS.
- `npm test`: **89/89 PASS**, including 16 follow-up regression cases plus the existing suite. The previous snapshot test now asserts preservation of newer accounts/outbox entries.
- `npm run build`: PASS; existing large JavaScript chunk warning remains. The former browser `node:crypto` externalization is removed by the shared SHA implementation.
- `cap sync android`: PASS. Generated bundle output was verified, then the previously tracked generated files were restored to their original repository versions to avoid including build artifacts in the source diff. Rebuild and run Capacitor sync before producing an APK.
- At 390×844, the settings/backup screens and optional Bengali workspace description were inspected. A synthetic empty account was archived, found in Archived, and restored on a separate loopback test origin; user financial records were not modified by that test.
- A backup was actually downloaded from the LAN preview. Its `hisab-backup` v1 envelope and SHA-256 checksum were independently checked with .NET SHA-256: PASS. The financial backup itself is private in the user's Downloads folder and is not included in the repository.
- Screenshots: `docs/qa/settings-bengali-mobile.png`, `backup-file-mobile.png`, `archived-account-mobile.png`, and `workspace-description-mobile.png`.

## Remaining device acceptance

Java/Gradle/ADB are unavailable on this host. Native Java compilation, SAF save/open/cancel on a physical phone, reinstall/in-place upgrade, real Google OAuth consent and cross-device Drive verification have not been performed. A native APK must be built before these native changes can be tested; an already installed APK does not update from the browser preview.

For web testing, open `http://192.168.1.108:3000/` on the same network and refresh. File backup is under Menu → Settings → Backup & recovery → Backup files & restore. Google OAuth cannot run on a raw LAN HTTP origin; use USB port forwarding to an authorized localhost origin, an authorized HTTPS origin, or an appropriately configured Android build. Do not clear app storage to resolve backup or sign-in errors.

No remote publication or release was performed for this follow-up.
