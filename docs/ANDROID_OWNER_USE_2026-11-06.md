# Android owner-use candidate — AI deferred

The owner deferred AI on 6 November 2026 and requested a usable Android APK first.
This candidate uses the existing permanent signing key and schema 6. It is an
in-place update, not a public/customer release or financial cloud cutover.

## Included

- Manual income, expense, transfer, receipt attachment and transaction history.
- Workspaces, master-wallet codes, separate workspace allocations and transfers.
- Savings goals, protected reserved money and existing savings-loan accounting.
- Reports, local summaries, PDF/export and local backup/recovery controls.
- Existing Google sign-in, linked identities, PIN, language and light/dark themes.

## Deferred

The Android build uses `-WithoutAI` (`VITE_AI_FEATURES_ENABLED=false`). AI entry,
voice/receipt extraction, budgeting guide, AI privacy controls and AI permission /
redeem-code panel are hidden. Client extraction/guide calls fail before reading
identity, media or network. No saved provider secret or consent is deleted.
Existing Web/Admin Preview configuration is independent and unchanged.

Financial records remain local. Google login does not yet enable Postgres
financial sync or upload/adopt the existing dataset. No Drive sync is restored.
Loan repayment is manual: automatic repayment requires verified financial sync
and is unavailable here. New loans do not default to a non-running automation;
existing stored settings are retained and the UI states that they are not running.
Public distribution, broader subscription enforcement and independent recovery
acceptance remain separate release gates.

## Validation and delivery

1. Run the full suite, TypeScript checks and Web/Android release build.
2. Verify package, increasing version code, permanent certificate, APK checksum
   and the packaged `native-features.json` (`aiEnabled: false`).
3. Capture fresh read-only storage fingerprints; install with `adb install -r`.
4. Compare finance/identity/preferences/outbox and package retention before,
   after installation and after normal initialization. Stop on any mismatch.
5. Check manual entry, Account, History, wallets and reports on the physical phone;
   verify AI controls are absent. Never save a synthetic entry into the owner's
   actual ledger merely to test navigation.
6. Give the owner the signed APK and record remaining acceptance honestly.

Build: `scripts/Build-SignedAndroid.ps1 -VersionCode 28 -VersionName 1.0.27-rc7
-ManagedAIAccess -WithoutAI -LowMemory -AIServiceOrigin <approved-existing-origin>`.
The existing origin is retained as public routing configuration; this build does
not call the AI service or use a provider key.
