# Signed account candidate — 2026-11-04

Branch `codex/android-account-upgrade`, based on PR15 `fe78cf0`. This is a signed release **candidate for owner testing**, not acceptance of a public production release or a Postgres financial cutover.

## Changes

- Build from the isolated feature-preserving worktree, using `-LocalResourcesRoot` to reuse existing tools/signing in the original workspace. Private signing material is never copied into the worktree, logs, app, Git or cloud.
- Firebase preparation reads validated public config from that resources root and stages only the Android client config into the build workspace. Target package/project validation remains mandatory.
- Add opt-in instrumentation to compare read-only SQLite finance/outbox fingerprints and counts before/after upgrade. It opens the existing file READONLY, starts no Activity, sends no network requests, prints no entries, balances, identities or credentials. Test companion installation/data access requires the owner's explicit permission; do not substitute another method if declined.
- Permanent package `com.hisabdekhtechai.app` and certificate preserved. Candidate version code must exceed installed 21; no uninstall/clear-data/downgrade.
- Owner approved manual identity linking in shared Supabase project `sfzitbasxrpmtmldujbm` and contact-change controls only for Account Preview on Nov 4. Secure Email Change stays ON; phone OFF; old redirects unchanged. Actual second-account linking and inbox verification require owner-controlled accounts; no credentials in source/evidence.

## Dependency security

Runtime audit initially reported 8 high-severity findings, including inherited transitive counts. Patched `@vercel/oidc` to exact 4.0.6, pinned the Firebase transitive `@grpc/grpc-js` override to 1.14.6 and installed SheetJS 0.20.3 from its official vendor tarball. No `npm audit fix --force` or Firebase downgrade.

- [SheetJS official installation](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)
- [gRPC security advisories](https://github.com/grpc/grpc-node/security/advisories)
- Package lock records exact artifact integrity. `npm audit --omit=dev`: 0 reported findings after patching. This is a point-in-time advisory scan, not a claim of absolute security.
- XLSX regression now reads the actual generated workbook: Bengali labels, exact large paisa converted to BDT text, and formula-like notes retained as text. Source journal remains unchanged.

## Gates

- Installed v21 APK was copied read-only and its certificate SHA256 matched the permanent signing identity. Phone storage/data directory was not changed.
- Same-signature test probe build passed (Android release instrumentation).
- Focused XLSX/Firebase/sender tests: 13 passed. Signed build runs lint, complete regression suite, web build, native compile/R8, package/version, certificate and HTTPS service-origin checks before archiving.
- Real retention, native Auth, media bridge and owner acceptance must be recorded separately; build success alone is not PASS.
- Existing hosted Google login/reload passed in PR15. Contact-controls Preview deployment: `dpl_A9QQD5fsmTjtgryyb5tujfLHpiMA`, same previously authorized callback alias. Do not publish a temporary authenticated sharing URL or weaken protection to test it.

## Production blockers

Remaining Postgres commands, authenticated gateway, backed-up explicit legacy UUID adoption, multi-client/restore acceptance, key recovery backup and final owner acceptance remain open. Old data must not be uploaded or silently reassigned to bypass these gates. Keep release HOLD until the required checks pass. No Production website promotion, paid service or public release is part of installing this owner candidate.

## Sign-out privacy correction — 2026-11-05

The owner found that signing out of Account settings left the hamburger displaying the legacy Google name, photo and Gmail. The menu now subscribes to the same account session as Account settings. It shows only the primary verified email of that session, explicitly labelled; signed-out, loading and error states never fall back to the legacy profile. Linked Google identities remain in Account settings, and the owner chose to keep both without changing the primary email.

Logout removes displayed identity immediately, fences concurrent refreshes and attempts both current and legacy credential cleanup. The mounted app supplies its existing legacy auth instance; push-disable errors cannot prevent local credential clearing. A confirmed empty account read also clears an old Google session left by a previous app version. Device-only editable profile details are separately labelled; profile drafts/photos reset when the profile is cleared or reopened. No journal, local financial identity or outbox ownership is changed.

Focused regressions cover pending/offline/failed logout, late callbacks, menu/panel privacy and independent cleanup failures. Lint and all 13 account settings tests pass. The next signed candidate must use code 23 or higher and repeat read-only retention comparison, native bridge/cold-launch checks and owner sign-out/menu acceptance before this correction is recorded as device-verified.
