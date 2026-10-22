# 07 — ANDROID DEVELOPMENT IMPLEMENTATION PLAYBOOK (FIRST)
**Scope:** Implement and validate Android to release quality **before** starting the Web app. Default dev hardware Windows + Android SDK/Gradle or actual emulator/device. macOS not required for Android.

## Stage A0: Repository and toolchain
- [ ] New GitHub repository (do not touch any existing unrelated production app).
- [ ] Select latest compatible stable releases of Node LTS, npm/pnpm, React, Vite, Capacitor, Android Studio/JDK, Kotlin/Gradle and SQLite bridge; **pin lockfiles**. Do not use untested bleeding-edge versions.
- [ ] Set up `packages/domain`, `packages/contracts`, `packages/storage-sqlite`, `packages/sync-core`, `packages/google-drive`, `packages/design-system`, Android shell. Mobile screens in one shared React UI package.
- [ ] Choose final unique application ID (example placeholder `com.hisabdekhtechai.app`; check Google Play availability and app signing); maintain it across updates.
- [ ] Configure lint, strict TypeScript, unit tests, build checks, CI, conventional commits and changelog.
- [ ] Create .env.example with safe public OAuth identifiers only; **never commit developer signing keys, access tokens, refresh tokens, private secrets**.
- **Exit gate:** clean fresh checkout → deterministic install, typecheck, tests, Android debug build.

## Stage A1: Core design and navigation
- [ ] Build original blue/white theme, icon set, Bangla fonts, scalable screen sizes, safe area, navigation and empty states.
- [ ] Welcome, fake/demo login placeholder clearly not functional yet, dashboard skeleton, workspaces, ledgers, accounts, categories, add transaction, history, reports, settings, sync status.
- [ ] All interactive buttons route to functional forms (even if development fake local data); no decorative save/sync interactions in production.
- **Exit gate:** Android emulator and physical phone screenshots; navigation and accessibility smoke pass.

## Stage A2: Offline SQLite and accounting engine
- [ ] Implement schema/migrations + encrypted DB support feasibility check; durable local account partition.
- [ ] Implement workspace/ledger/accounts/categories CRUD and double-entry posting for income/expense/transfer+fee.
- [ ] Build history/filter/search and reports from journal; account balance is **derived**, never separately editable aggregate.
- [ ] Each local mutation atomic: journal+outbox+device sequence; optimistic UI after actual commit success only.
- [ ] App fully usable in airplane mode after first setup; restart, force-stop and low-storage tests.
- **Exit gate:** all financial invariant tests, crash injection and offline Android demo PASS.

## Stage A3: Google login and consent (developer config once)
- [ ] Create Google Cloud project + OAuth consent app, enable Google Drive API; configure signed Android SHA and package name.
- [ ] Implement native Google sign-in/identity, stable subject checks, authorize `drive.appdata` separately as required, handle scope denial.
- [ ] Android first-run requires Internet. After initial authorized identity, returning device supports offline protected access to matched local profile.
- [ ] Token/consent lifecycle handled without app-provided secret or reentering customer email; test revocation and reauthorization.
- [ ] No Recovery Key/password/custom API screen in production.
- **Exit gate:** two test Google accounts remain isolated and nobody sees other's local history.

## Stage A4: Real Google Drive sync
- [ ] Implement `DriveAdapter` with `appDataFolder`: create, list, page, upload, get/download, changes feed/cursor if proven compatible; verify across devices.
- [ ] Implement immutable device-sharded operation batches, durable per-device outbox, verified remote receipts, idempotent replay, conflict UI.
- [ ] Implement reliable foreground sync then test native WorkManager background jobs with network requirements and retry/backoff. Do NOT assume Capacitor JS persists when closed.
- [ ] Add checkpoint/backup, new-device reconstruction, account mismatch, quota/HTTP error states.
- **Exit gate:** 2-device offline concurrent test, process-death test, Drive quota test, new-device restore with exact balances all PASS.

## Stage A5: Updates and migration safeguards
- [ ] Produce Android alpha schema v1 golden DB fixture with offline pending outbox.
- [ ] Build signed upgrade from earlier app version, migrate with recovery snapshot and integrity verification.
- [ ] Test offline upgrade, new schema read, pending upload retry, restore after forced failure, app update on older Android device.
- [ ] No schema auto-drop or import that replaces a newer local dataset.
- **Exit gate:** all historical released-schema upgrade paths (at minimum v1→current) pass data invariants and recovery proof.

## Stage A6: Accessibility, performance and offline app lock
- [ ] Fast one-hand transaction entry; loading, error and warning language Bangla + English optional.
- [ ] Add optional PIN/biometric lock without creating a mandatory password/recovery key.
- [ ] Verify UI on low-end Android devices, screen rotation/resume, accessibility scale, thousands of transactions.
- [ ] Budget and alert settings, deterministic recurring schedules (offline correctness, duplicate due-date prevention), calendar/bookmarks, basic reconciliation and CSV/XLSX/PDF export.
- [ ] Receipt attachment local import, hashed immutable cloud-blob sync, size/type/failed-blob tests before marking feature complete.
- [ ] CSV export from local data (works offline) and OS save/share; formula-injection sanitization.
- **Exit gate:** release UX acceptance suite, benchmark record navigation on realistic dataset with measured numbers (do not invent metrics).

## Stage A7: Android quality, Play internal/closed testing & production preparation
- [ ] Release AAB signed with secure Play App Signing, proper versionCode, correct `applicationId` and icons.
- [ ] Re-check Google Play latest target API requirement; **as of 2026-10-22 new submissions target Android 16/API 36 or higher** unless an official exception applies.
- [ ] Fill Data Safety/Privacy Policy accurately and Google OAuth brand verification as required.
- [ ] Test production signing SHA against OAuth Google Sign-in (debug SHA alone is not enough).
- [ ] Internal/closed testing including applicable new personal account testing requirements, Play pre-launch report and real customer staged release.
- [ ] Document rollback policy: do **not** downgrade DB schema destructively. Use forward-fix releases or a supported read-only recovery path.
- [ ] Store release only after owner's explicit approval.
- **Exit gate:** all `09_QA_ACCEPTANCE_RELEASE.md` mandatory tests PASS with evidence; Android is considered feature complete.

## Stage A8: Freeze reusable contracts for later Web
- [ ] Freeze stable `domain`, `contracts`, `sync-core` and remote operation format.
- [ ] Export Android golden test fixtures, canonical JSON and SHA256 examples; document Google account/Drive cross-client scope spike.
- [ ] Tag stable Android release and handoff Web team.
- **Automatically begin the Web implementation **after A7/A8 gates are genuinely PASS**; owner approval is required separately for public Play Store / Web production deployment.**

## Task-level proof template
Every task must include: **Task ID**, requirements reference, code changes/commit, command run, screenshot or test output, simulated input, expected vs actual result, bugs/risks, status (`NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `PASS`), next action. Never mark PASS without actual test evidence.

## Example dev commands — adapt to pinned versions / actual repo
```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
npx cap sync android
npx cap open android
# Gradle build commands only once Android project checked in:
cd android && ./gradlew assembleDebug testDebugUnitTest
```
**Commands are illustrative**, not evidence that an app or Android binary exists.
