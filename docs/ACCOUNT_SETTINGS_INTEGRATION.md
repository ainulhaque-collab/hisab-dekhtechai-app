# Account settings integration — 2026-11-04

Settings → Account & sign-in now mounts PR14 identity management behind `VITE_SUPABASE_AUTH_ENABLED`. Postgres financial sync and adoption of existing data remain disabled.

## Feature preservation

- Identity baseline: `3982edc4d8357a22f003d40619897ca51c18ffc3` (PR14).
- Published feature baseline: `be716428568abc339bdfe61a28eb8981971bc7bf`; preservation merge: `014f81e`.
- PR10–14 lacked published goals, loans, AI, notifications, media, PDF and native SQLite fixes. This merge preserves them, accounting for its size.
- The unpublished `75dde82` navigation/theme redesign was excluded. Only its native CloudSessionVault R8 keep rule was needed.
- Root checkout, local storage names, Android package and signing material are unchanged.
- Historical Drive source remains for the older rollout only. This account preview disables its worker, authorization, token provider, backups and sign-in route. No new Drive work.

## Mounted behavior

- Settings and the header open one account panel. Callback navigation opens it automatically.
- Verified account UUID remains the identity; email/phone strings never select a dataset or rewrite ownership.
- PKCE callback codes leave the address/history before rendering. Native callbacks close the browser; listeners detach on sign-out/failure.
- Startup/refresh/actions coalesce. Logout fences late callbacks, reads, contact changes and browser navigation.
- Offline/error display retains earlier verified details without claiming fresh verification. Local finance stays usable.
- Bengali/English labels and fixed errors; no raw provider messages, tokens or UUIDs in UI. Profile contact number is distinguished from verified phone sign-in.
- Email-change and Google link/unlink controls are implemented behind default-off `VITE_ACCOUNT_CONTACT_CHANGES_ENABLED`. Last-login and primary-email guards remain in Auth.
- Phone OTP stays off: owner has no SMS provider. No paid service was enabled.
- Explicit preview copy: this login does not migrate or upload existing local records.

## Shared Auth review (read only)

Project `sfzitbasxrpmtmldujbm` still shares Auth with other apps.

- Google/email enabled; phone/anonymous sign-in disabled.
- Confirm email and Secure email change enabled.
- **Manual identity linking disabled**; no global change made.
- Custom SMTP configured, but dashboard warns that its personal-email SMTP host can affect deliverability. No credential read/replaced, no verification email sent, no delivery PASS claimed.
- Site URL belongs to another app. All seven redirect URLs, including the three authorized Hisab callbacks, remain unchanged.
- Reuse the existing Hisab Supabase Preview alias; no new redirect wildcard, public exposure or Production change.

## Finance compatibility

Preserved journals contain UTC creation timestamps and occurrence timezone offsets; category edits also enqueue. The strict Postgres codec now accepts optional audit fields without changing integer-paisa money semantics.

New forward migration `20261104162102_hisab_sync_audit_metadata.sql` is **not applied remotely**. It validates metadata, delegates to the unchanged money command, and retains the complete original hashed envelope in the sync log. Replica replay keeps audit fields; invalid offsets/dates fail atomically.

Financial provider mounting, authenticated gateway, legacy adoption, remaining goals/loans/media commands and cross-client acceptance remain separate milestones. No real ledger uploaded.

## Verification

- Clean `npm ci`: 408 packages; reconciled lockfile.
- `npm run lint`: frontend/API TypeScript pass.
- `npm test`: 370 total, 369 pass, 0 fail, 1 native-Postgres-only skip.
- `npm run test:sql`: 11 pass in isolated PostgreSQL WASM.
- `npm run test:api-runtime`: compiled server starts with AI safely disabled; pass.
- `npm run build`: pass; existing large main-bundle warning. Account panel/Auth remain lazy chunks.
- Account tests cover duplicate submit, offline behavior, logout races, UUID-pinned reauthentication, pending verification, redaction/translation, one-use callback capture.
- Browser: desktop English and 390×844 Bengali; Settings/header routes; local PWA update prompt loads the new build without clearing data.
- React review: hooks before early returns, external-store subscription, lifecycle cleanup, lazy Auth/panel, semantic labels/status/errors, inline unlink confirmation, reduced-motion spinner. No SQL/finance writes in UI.
- Screenshots: [desktop](qa/account-settings/desktop-en.jpg), [mobile Bengali](qa/account-settings/mobile-bn.jpg).
- Native PostgreSQL17 restore, Android build and real hosted Google login are tracked in the PR; local mocks/builds are not those acceptance checks.

## Rollback and next acceptance

Disable this branch's Auth flag or restore the Preview alias's preceding deployment. No remote migration or real-data conversion to undo. Never reset storage or install debug APK over the signed app.

Before contact changes: review a concrete shared-project/manual-linking plan, confirm transactional-email delivery, then test both inbox confirmations and unchanged UUID using owner-provided accounts. Owner handles credentials/verification. SMS provider selection is separate.
