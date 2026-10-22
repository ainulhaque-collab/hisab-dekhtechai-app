# Hisab DekhteChai — Android-first Developer Handoff
**Release plan:** Android complete → Android QA & beta → Web App → production Web release  
**Document baseline:** 2026-10-22 | **Package:** v1.0 / design-approved specification | **Implementation status:** NOT STARTED

> **Product:** Hisab DekhteChai (হিসাব দেখতে চাই) — a Bangla-first, minimal blue/white, offline-first finance tracker. The customer logs in with Google, works offline after initial setup, and syncs automatically to **their own** Google Drive when conditions permit. No Supabase/Firebase database, no custom central finance backend, no native Windows app, no recovery key in V1.

## DOCUMENT ORDER — Coding Agent must follow
| Order | File | What to implement/decide |
|---|---|---|
| 1 | `01_PRODUCT_PRD.md` | Immutable product requirements, scope, acceptance criteria |
| 2 | `02_CUSTOMER_FLOWS_UI.md` | Exact customer journeys, navigation, screen states |
| 3 | `03_ARCHITECTURE.md` | Monorepo, runtime boundaries, offline lifecycle, interfaces |
| 4 | `04_DATA_MODEL_FINANCE.md` | Data model, immutable financial journal, migration policy |
| 5 | `05_GOOGLE_DRIVE_SYNC.md` | Durable outbox, append-only segment format, two-way eventual sync, bootstrap |
| 6 | `06_SECURITY_AND_PRIVACY.md` | Google OAuth consent, threat model, data protection and limitations |
| 7 | `07_ANDROID_DEVELOPMENT.md` | **Build this FIRST**; exact ordered Android milestones and release gates |
| 8 | `08_WEB_DEVELOPMENT_LATER.md` | **Do not implement until Android gates PASS**; web reuse plan |
| 9 | `09_QA_ACCEPTANCE_RELEASE.md` | Test matrices, CI, disaster simulations, Play Store preparation |
| 10 | `10_AGENT_MASTER_PROMPT.md` | Copy-and-paste instructions to Claude/Codex/Coding Agent |
| 11 | `11_DECISIONS_RISKS_OPEN_QUESTIONS.md` | Locked decisions and engineering spike gates |
| 12 | `12_GOOGLE_DEVELOPER_SETUP_AND_PLAY_RELEASE.md` | Exact one-time OAuth/Drive developer steps and Play policy |
| 13 | `13_FLOWCHART_REFERENCE.md` | Concise Mermaid diagrams |

**Other included materials:** `MASTER_DEVELOPMENT_DOCUMENT.md` (all documentation in a single file), `MILESTONE_CHECKLIST.md` (track task status). Earlier user-journey notes are superseded by the decisions in this package whenever they differ.

## Hard requirements that override any previous plans
1. Android **first**, Web second **automatically after all Android development/QA gates PASS**; do not create native Windows/iOS apps in V1.
2. **No server-owned financial database.** Google Drive is the user's own transport/storage for sync; Google Cloud is configured once by the **developer**, never by the customer.
3. V1 onboarding: **Continue with Google** and Google's necessary authorization prompts only; **no customer API keys, custom password, or Recovery Key**.
4. After first online sign-in, Android must record, show, filter and report data **fully offline**. A local write must never wait for Drive.
5. Two-way **eventual** synchronization: Android device A ↔ own Drive ↔ Android B / future Web. *Not* instant realtime. Background delivery is best-effort.
6. No silent deletion, overwrite or destructive migration of financial records during sync, app upgrade, restore or account switch.
7. Enforce **single Google owner identity per dataset** in V1. Personal/business ledgers are separate *within the same owner's app*. Team membership and approvals are **deferred**, as user-owned Drive cannot safely implement shared role-based access without further design.
8. The UI is **minimal blue and white** with consistent **Lucide-style outline icons**, Bangla primary, English optional, accessible, responsive.
9. Financial computations use **integer BDT minor units (paisa)**. Post balanced ledger entries transactionally; no JavaScript floating-point money arithmetic.
10. Every milestone includes proof: screenshots, code diffs, tests, passing evidence, unresolved issues, and next steps. No fictitious "PASS" statuses.

## Out-of-scope claims that must NOT be made
- "100% secure", "instant sync", "Google cannot read cloud data", "encrypted end-to-end" — NOT established in V1.
- "Automatic Web sync while the browser is closed" — cannot be guaranteed.
- "Google sign-in without Internet on a fresh device" — initial connection required.
- "All sync conflicts can be silently merged" — conflicts require safe review.
- "APK update cannot possibly lose data" — risk reduction and tested recovery required, not absolute guarantee.

## Initial implementation deliverables (not yet produced)
- Git repository with pinned, tested dependency versions, Android build and preview release, deterministic local database migrations, Google Identity authorization, real Drive-to-Drive multi-device proof, automated tests, CI, user-facing privacy policy, release checklist and recorded beta test.
- Work **sequentially** through Android phase milestones before beginning Web implementation. Stop before production releases unless owner authorizes.

## Important prerequisites — one-time developer actions
- Create Google Cloud project with Drive API enabled, OAuth consent screen, Android app OAuth client (package + signing SHA), later Web OAuth client (authorized origins). Submit Google verification if applicable.
- Reserve/verify Android application ID and brand usage, configure Play Console, configure developer-keystore security.
- Ensure exact Android SDK/Google Play target SDK level is rechecked at release time.

## Verified official documentation used
- Drive scope options: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Hidden app data folder: https://developers.google.com/workspace/drive/api/guides/appdata
- Drive change feed: https://developers.google.com/workspace/drive/api/guides/manage-changes
- Drive quota/errors: https://developers.google.com/workspace/drive/api/guides/handle-errors
- Android DB migrations: https://developer.android.com/training/data-storage/room/migrating-db-versions
- Google Play target SDK: https://developer.android.com/google/play/requirements/target-sdk
