# Approved eight-item development batch — QA report

Release classification: **BLOCKED**. Implementation and automated verification are available for owner review. Physical Android, authorized Google account, cross-device Drive, sound listening, signing continuity, and in-place upgrade gates remain unverified. No production merge, deployment, release, or customer data access was performed.

## Source and lineage

- Repository: https://github.com/ainulhaque-collab/hisab-dekhtechai-app
- Fetched approved development baseline: `35e0b7c499bdb0f0e271fe2ec7de5e7dc6b3b415` (unchanged at preflight).
- Working branch: `fix/android-pickers-sync-security-and-ux`, created from that baseline.
- Initial working tree: clean. No applicable AGENTS.md was present in the repository or checked ancestors.
- Prior verified CI/APK runs supplied by owner: 40121695500 / 40121695558. The APK currently installed on the affected phone, its signing certificate, device model, and Android version were not accessible, so source-to-installed-APK parity cannot be asserted.
- Commit, pull request, new CI runs, and APK evidence: recorded below after publication to the development branch.

## Exact approved scope and findings

| Issue | Previous behavior / confirmed code cause | Implementation and exact source files | Automated evidence | Web / Android evidence | Status |
|---|---|---|---|---|---|
| BUG-008 | Native HTML selects remained in 17 controls across five screens; the existing account picker listened only for Escape. Exact device-specific color/theme cause is unknown without the affected APK. | `src/components/AppSelect.tsx`, `useDialog.ts`, `AccountPickerModal.tsx`, `AccountsTab.tsx`, `AddTransactionTab.tsx`, `HistoryTab.tsx`, `ReportsTab.tsx`, `PartiesModal.tsx`; `android/app/src/main/java/com/hisabdekhtechai/app/MainActivity.java`. Reusable portal picker, explicit visible colors, labels, scrolling, search, disabled/empty states, focus trap, Escape/Cancel/outside dismissal, top-dialog Android Back bridge. | Option ID/label/disabled/empty-value regression and global no-native-select inventory. | Browser opens/readable account-type options and selection verified. Physical Android Back, rotation, accessibility and theme behavior NOT VERIFIED. | Implemented; Android verification blocked. |
| BUG-011 | Android used browser GIS without a native authorization path. Cached public profile retained an authorization flag. First-owner binding did not atomically persist identity/workspace/operation ownership. Remote read failures could still lead to a successful timestamp. Installed-device OAuth configuration remains unknown. | `src/auth/googleAuth.ts`, `nativeGoogle.ts`, `src/context/AppContext.tsx`, `src/sync/orchestrator.ts`, `src/storage/db.ts`, `android/app/src/main/java/com/hisabdekhtechai/app/NativeGoogleDrivePlugin.java`, `MainActivity.java`. Native AuthorizationClient for appdata/openid/userinfo, userinfo subject verification, memory-only tokens, consent before offline binding, canonical hash validation, foreign-owner rejection even for empty datasets, transactional bootstrap/replay, durable initialization gate, honest failed remote verification. Strict production ownership checks preserved. | Verified-subject/consent/foreign-owner tests, commit-failure rollback, original pending IDs retained, two-device mock restore, duplicate replay, token-renewal and existing sync regressions. | No real Google identity, remote upload, restore, or affected-phone logs accessed. | Implemented; live verification blocked. |
| BUG-010 | SyncModal displayed simulator, fault injection, OAuth console and raw internal error controls. | `src/components/SyncModal.tsx`, `AuthModal.tsx`, `SettingsModal.tsx`, `src/context/AppContext.tsx`. Customer sync view shows actual authorization state, pending count, verified timestamp, reconnect/sync/help and applicable conflicts. Simulated login UI removed. Diagnostic error detail remains in service state, with generic actionable customer messages. | Production-screen forbidden-control regression; initial sync state is idle and unreadable remote batches never report success. | Production Web rendering checked; APK visibility still requires device review. | Implemented and automated; device review blocked. |
| BUG-009 | Existing workspace methods persisted local changes without queuing sync operations and no obvious management UI existed. | `src/components/WorkspaceManager.tsx`, `Navbar.tsx`, `src/context/AppContext.tsx`, `src/storage/db.ts`, `src/contracts/types.ts`, `src/sync/orchestrator.ts`. Details/rename/archive/restore and guarded exact-DELETE empty deletion. Full compatible v1 upserts restore workspaces; archived deletion tombstones prevent new clients resurrecting deleted entries and keep old clients safely archived. Dependency/history checks prevent erasing populated workspaces; last active workspace cannot be archived locally. | Restart, rename/archive/restore, dependency rejection, confirmation, tombstones, sync duplicate replay; synthetic financial parity evidence. | Browser management smoke testing recorded below. Physical Android and mixed-version simultaneous device edits NOT VERIFIED. | Implemented; live cross-device verification blocked. |
| FEAT-002 | UI, service and tests required misspelled DELET. Reference/opening-balance/pending-op guards were incomplete. | `src/domain/confirmation.ts`, `src/components/AccountsTab.tsx`, `src/storage/db.ts`, `src/test/account_manage.test.ts`, `approved_batch.test.ts`. Shared exact DELETE validation; reference-bearing accounts archive, eligible empty uploaded accounts delete once; archived accounts remain in consolidated/group totals. | DELETE accepted; DELET/delete/Delete/empty/whitespace rejected; historical/pending/opening account safety and balance parity tests. | Browser disabled-state check recorded below; physical device NOT VERIFIED. | Implemented and automated. |
| FEAT-008 | App had PIN only; security settings could disable PIN without current authentication and backgrounding did not relock. | `src/security/biometric.ts`, `src/components/SecuritySettings.tsx`, `PinLockScreen.tsx`, `SettingsModal.tsx`, `src/App.tsx`; `android/app/src/main/java/com/hisabdekhtechai/app/BiometricUnlockPlugin.java`, `MainActivity.java`; `android/app/build.gradle`. AndroidX BiometricPrompt, Class 3 only, auth-per-use Android Keystore AES key invalidated on enrollment changes, device-local opt-in, cancellation/60s timeout/background cancellation, current-PIN reauthentication for changes/removal, persistent existing PIN lockout, background relock, unsupported Web hidden. No raw biometric material or biometric settings sent to Drive. | Bridge tests cover disabled/unavailable, false result, success, cancellation, wrong PIN, lockout and unsupported Web; existing PIN KDF/legacy tests retained. | No physical fingerprint or face verification. Device-credential prompt is intentionally not offered; App PIN is fallback on all API levels, avoiding API 29-and-lower combination restrictions. | Implemented; native security verification blocked. |
| BUG-012 | Musical Web Audio oscillator notifications did not evoke money. | `src/services/soundService.ts`, `public/audio/income.wav`, `expense.wav`, `transfer.wav`, `LICENSE.md`; `scripts/generate_coin_audio.py`. Original deterministic inharmonic coin-impact PCM audio bundled offline. Distinct income/expense/two-step transfer, bounded overlap and volume, preserved mute/haptics/previews, silent failures. Transaction sound remains after awaited durable commit; previews create no journal operations. | WAV headers/distinctness, preference/mute/volume/playback-failure/repetition tests and durable-commit call ordering. | Owner listening, Android/Web perceived quality, latency, hardware haptics and silent-mode behavior NOT VERIFIED. Browser preview activation does not prove audio was heard. | Implemented; owner listening/device verification blocked. |
| FEAT-009 | Workspaces lacked separate local logo/photo assets. | `src/storage/workspaceMedia.ts`, `src/components/WorkspaceAvatar.tsx`, `WorkspaceManager.tsx`, `Navbar.tsx`. Add/preview/change/remove/cancel/save, center-square crop, 5 MB input, MIME/magic checks plus decode validation, dimension/pixel limits and 384px optimized JPEG; separate SQLite/IndexedDB asset store; initials fallback, header/switcher/manager display. Google account/user-profile images remain separate. | Spoofed/oversized file rejection; three independent image assets survive store recreation; foreign-owner access/write rejection; images excluded from financial state. | Cross-device IMAGE SYNC IS NOT ENABLED and is explicitly stated in the UI. Browser upload/decode/crop/save/reload persistence verified with the bundled app launcher as a synthetic test image; Android and true offline durability still require device acceptance; missing asset falls back to initials. | Local feature implemented; device verification blocked. |

## Automated verification

- `npm ci --prefer-offline`: PASS on approved retry. Initial sandbox attempt failed to write npm cache; retry completed successfully.
- `npm run lint`: PASS.
- `npm test`: **73/73 PASS** (baseline was 52/52). Expected fault-injection/corrupt-storage diagnostics are exercised by negative tests and are not customer-data errors.
- `npm run build`: PASS. Existing browser `node:crypto` externalization and large-bundle warnings remain; no unrelated bundling redesign.
- `npx cap sync android`: PASS; existing SQLite plugin detected.
- `npx tsx scripts/verify-approved-upgrade.ts`: PASS; see `docs/qa/synthetic-v5-baseline-with-security.json` and `docs/qa/upgrade-with-security-evidence.json` (original financial-only baseline artifacts are also retained).
- The baseline is SYNTHETIC Node fallback storage, not a physical SQLite or installed-APK upgrade. Three workspaces, seven accounts, three transactions, six journal lines; opening balances, enabled PIN, sound preferences, group total and consolidated total reconcile to 343000 minor units. All original operation IDs survive restart and metadata changes. Its eight pending operations are synthetic and do not establish the affected device's actual pending count.
- Schema remains v5. No destructive schema migration, storage identifier change, database reset, or ownership weakening was introduced. Workspace tombstone metadata is optional and existing v1 operation types are reused.
- Native Gradle now includes the generated Capacitor plugin dependencies; previously SQLite was declared in the generated file without the app applying that file.
- npm reported four dependency advisories (three moderate, one high) from the existing locked dependency graph. No force-upgrade or unrelated dependency replacement was performed.

## Android build and upgrade gates

- Release package: `com.hisabdekhtechai.app`; Debug package: `com.hisabdekhtechai.app.debug` (existing suffix retained).
- Development version: `1.0.1-dev`, versionCode `2` (baseline `1.0.0`, code `1`).
- CI: Node 22, Java 21, Gradle 8.13; debug APK only. APK and signing/build evidence artifacts are configured.
- This host has no Java/Gradle/ADB toolchain; native compilation must be verified by GitHub Actions.
- The previous APK/signing key is unavailable. A clean GitHub runner may generate a different debug certificate. **Do not uninstall or clear app storage to install this build.** The package and signer must match the existing app for an in-place upgrade; otherwise an authorized build with the original signer is required.
- Device model, Android version, secure Face Unlock availability, actual fingerprints, in-place upgrade, screenshots/recording on Android: NOT PHYSICALLY VERIFIED.

## Required external QA before owner acceptance

All gates below remain **BLOCKED — REAL DEVICE / GOOGLE AUTH VERIFICATION REQUIRED**:

1. Compare installed APK package/version/signing certificate with this development artifact; upgrade in place with the same signer and preserve its original database.
2. Exercise all selection controls on the affected phone, small screens, rotation, Bengali/English, Android Back and accessibility.
3. Authorize the correct Google owner for the actual package/certificate (no live OAuth configuration was changed). Capture actual pending IDs/counts before/after; verify private appData upload, restore into another authorized client, token expiry, consent rejection, interrupted/repeated/simultaneous sync and wrong-owner rejection.
4. Test workspace history preservation, exact account/workspace DELETE, cross-device rename/archive/restore and mixed-version behavior. New tombstone handling is automated; old-client code ignores optional fields but needs physical acceptance.
5. Enroll/enable supported Class 3 biometrics; verify rejection/cancel/enrollment change/restart/background/timeout/PIN fallback/failed-attempt lockout. Mark unsupported secure face hardware specifically unverified.
6. Listen to all coin sounds and preview controls; verify offline playback, repeat creation, volume/mute/haptics and device silent-mode behavior.
7. Upload two business logos and one personal photo, cancel/save/change/remove, corrupt/oversized inputs, offline restart and fallback. Images currently stay local by explicit design; cloud image synchronization is not claimed.
8. Compare real authorized synthetic-device baseline counts, every balanced journal, group/account totals, local owner, pending operations and existing media references. Restore from a known-good authorized backup without clearing original app data.

## References used for native implementation

- Android biometric authenticators, capability checks and API restrictions: https://developer.android.com/identity/sign-in/biometric-auth
- Google Android AuthorizationClient, private Drive scopes, token renewal and userinfo verification: https://developer.android.com/identity/authorization

## Development publication and browser evidence

App implementation commit: `fe32422` (full SHA in `docs/qa/issue-evidence.json`). UI/auth follow-up app-source commit: `b89e79940d40324e78eecb61109dd6da85a70b0d`. The exact full implementation SHA and issue-to-file mapping are recorded in `docs/qa/issue-evidence.json`.

The owner subsequently requested a more professional UI. `src/components/ModalShell.tsx` supplies consistent typography, spacing, focus behavior, rounded cards, icon treatments and sticky actions for Sync, authentication and Workspace Manager. Active/Archived navigation, compact image upload and a collapsed guarded Delete section keep the primary workspace flow clear. AppSelect and SecuritySettings use the same visual style. No accounting model or live deployment was changed for this visual refinement.

Actual production Web smoke tests in the in-app browser at `http://127.0.0.1:4173/`:

- Customer dashboard and Sync view render; no QA/fault/OAuth-console controls shown. Unauthenticated state reports no verified sync, not a fabricated success.
- Account Type opens readable options; selecting Bank updates the form. Bengali picker displays all six readable option labels and selection indicator.
- Escape closes only the picker and returns focus to its trigger; the underlying Add Account form remains open. Cancel exits the test form without creating an account.
- Workspace Manager opens from the switcher; Active/Archived views, business details, logo controls and dependency-protected deletion are visible. An unsaved workspace name was cancelled and remained unchanged.
- The repository's bundled app launcher PNG was uploaded as a synthetic business logo, decoded, center-cropped, saved, and confirmed visible after reloading the app. This generated one pending workspace metadata operation and zero financial transactions. It was not uploaded to Google Drive.
- Account delete confirmation stays disabled for `delete` and enables for exact `DELETE`; the operation was cancelled without deleting any record.
- English and Bengali layouts were visually checked at the browser's approximately 522px-wide viewport. This is not a physical Android result or a guarantee for every screen size.

Screenshots: `docs/qa/web-sync.png`, `web-sync-bn.png`, `web-workspaces-bn.png`, `web-workspace-details-bn.png`, `web-picker-bn.png`. These are real Web captures, not Android screenshots.

**Publication blocker:** Automatic approval review rejected `git push -u origin fix/android-pickers-sync-security-and-ux`. Its stated reason was that publishing the branch requires separate owner authorization under the release policy. A specific approval question was presented; the owner responded with a UI improvement request, which was implemented, without granting publication approval. No workaround or indirect publication was attempted.

Therefore: no remote development commit, draft PR, new GitHub Actions run URL or development APK artifact exists for this batch yet. Local source commits and Web artifacts are reviewable. Android compilation is NOT VERIFIED because this host lacks Java/Gradle/ADB and GitHub CI is blocked by publication approval. The same approval is needed to push this review branch, open the draft PR against `development/approved-bugfix-feature-batch`, and run development APK CI. This does not authorize merging, deployment or public release.

Notion was not updated or marked Fixed/Verified. Physical device and authorized Google-account tests remain blocked. No production release approval is implied by passing compilation or automated tests.
