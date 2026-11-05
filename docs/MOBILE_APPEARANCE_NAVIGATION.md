# Mobile appearance and navigation — 2026-11-05

Owner-approved mobile redesign continues from accepted wallet build `fe2c4fb`, `1.0.23-rc3/code24`. The owner confirmed previous History and the All wallets page are both visible. This is a separate UI milestone, stacked on PR #17. General customer Web stays on its current UI; Web-only Admin/redeem implementation and Production publication remain later gates.

## Behavior

- `VITE_MOBILE_REDESIGN_ENABLED` defaults to **false**. Enabled only in the local Android candidate and temporary small-screen QA. It controls presentation, never authorization or a paid-access grant.
- Light, Dark and Follow-phone choices persist in a separate device appearance key. Initial theme is applied before React renders. System appearance changes and Android foreground events refresh the theme. Storage denial retains a session choice; it cannot block local financial records. No ledger preferences, identity, journal or pending operations change.
- Shared surface/text colors cover existing forms, alerts, reports, custom pickers and dialogs. Violet actions, teal savings/income, rose expenses, visible focus and reduced-motion support. Android system-bar icons/background follow the selected theme through a display-only plugin with no new permissions or storage/network access. Existing readable native alert/picker themes remain.
- Header Account and Menu controls have Bangla labels. Bottom navigation has labelled Home/Accounts/Add/History/Reports, visible active state and larger targets. Settings groups identity/workspaces, preferences, security/records and learning, with one appearance chooser.
- Screen-reader language follows the selected Bangla/English UI. The mobile candidate removes the page-level zoom restriction; actual pinch zoom also depends on WebView/browser settings.
- The first-run welcome offers a Personal-first explanation, language/theme controls and optional Google sign-in. It is skipped if any journal, sync operation or nonzero opening amount exists, or after the guide was dismissed. It never creates, adopts, clears or reassigns finance data. Offline entry remains available. Existing sign-in/link/recovery/session logic is unchanged; the signed-out screen has a simpler introduction.
- Android educational content is reader-only. Admin checks, drafts and publishing controls are absent from the mobile UI and cannot be invoked by its content handler. Server authorization is retained; this is not the later server-authoritative Web Admin/redeem system.
- Goal loan labels now include Personal and Business destinations. Loan mathematics and posting rules are unchanged.

## Verification

- TypeScript and web bundle pass. Existing suite: **389 tests, 388 pass, 1 native-Postgres-only skip, no failures**. No financial schema/dependency change.
- Actual bundled Bangla UI at 390×844: Light/Dark welcome, persisted Dark after reload, welcome dismissal, labelled navigation, settings, signed-out account screen, wallet creation, custom picker selection, transaction entry and goal calendar selection. At 320px the account screen has no horizontal overflow.
- Synthetic wallet BDT2,000, one BDT120 expense: balance BDT1,880, expense BDT120. Selecting November12 in the goal calendar updates the displayed date. No real Google login, AI media submission, notification, publication or finance upload in this browser test. Existing preview update banner was used to activate rebuilt assets; native offline-shell registration remains disabled as before.
- Primary white-button contrast: Light 5.74:1 and Dark 5.27:1; dark secondary text 7.96:1. Screenshots/logs stay in ignored `build/qa/`. These measurements cover the primary palette, not a claim that every inherited UI color has been audited.
- Signed Android candidate, native display behavior, unchanged finance/outbox fingerprints and owner acceptance are **pending** until actually tested. Existing code24 remains the accepted installed baseline.

## Next gates

Native owner acceptance of themes/navigation; further screen-level polish where needed; Web-only Admin/redeem entitlement backend; Auth/AI/push alignment; portable wallet commands and explicit cloud adoption/restore. No Production promotion, customer-Web alias change, remote SQL, billing, SMS or credential/permission expansion in this milestone.

Native display references: [Android system bars](https://developer.android.com/develop/ui/views/layout/edge-to-edge) and [WindowInsetsControllerCompat](https://developer.android.com/reference/androidx/core/view/WindowInsetsControllerCompat).
