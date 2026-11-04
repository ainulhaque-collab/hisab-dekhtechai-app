# Hisab DekhteChai requirements reconciliation — 26 October 2026

This is an audit and planning update requested before notification implementation. It does not implement push delivery, publish an APK, activate a service, or change financial storage. Current application baseline: signed Android version 7 / `1.0.6-test`, source `7f5ddd4`; latest owner-acceptance note before this audit: `deb0575`.

## Canonical plan and search coverage

The existing [Bug Fixing & Feature Tracker](https://app.notion.com/p/403bf836a600815a8dcccec4ca26eda9) now starts with a consolidated current-status matrix, notification requirements and execution order. Historical reports, issue IDs and child pages remain intact. The root and the three supporting pages link to that current plan instead of becoming separate current trackers.

Searches covered 23–26 October using the available created-date filter, plus Hisab, হিসাব, Dekhte, Android, Google Drive and SaaS keywords. Four relevant content pages and the project root were found and read. This is accessible search coverage, not a claim to enumerate unshared pages. The root predates the requested interval and was included as project context.

- [Project root](https://app.notion.com/p/401bf836a6008017a233c5cf06087680).
- [Historical 24 October selection](https://app.notion.com/p/403bf836a600813f9e50d372ac446a57): selected scope is not completion evidence.
- [Historical backlog](https://app.notion.com/p/403bf836a600812d9fdad4838a38902d): Blog and customer API/MCP remain planned.
- [FEAT-010 SaaS proposal](https://app.notion.com/p/404bf836a600818ba71df50c8e143557): no billing or central financial mirror is running.

The similarly named DekhteChai travel/map architecture hub and its empty Web and Apps Development page belong to a different project; their requirements were excluded.

## Reconciled implementation findings

| Existing IDs | Current evidence and remaining work |
| --- | --- |
| BUG-001/008 | Shared AppSelect and account picker implemented; global physical picker/Back/rotation coverage remains. |
| BUG-002/005 | Header/safe-area cleanup, one sync badge and hamburger implemented; full small-screen/accessibility acceptance remains. |
| BUG-003 | Migration safeguards and signed replacement install demonstrated; seeded pending-record/PIN/media/financial parity upgrade proof remains. |
| BUG-004/006/011 | Expense save, basic Android-to-Web and Web-to-Android propagation, sync timestamp and displayed verified-backup timestamp owner-confirmed. Exact parity, Android-to-Android, offline replay, isolated restore and account-isolation acceptance remain. |
| BUG-007 | Local 124-test/typecheck/Web/native-build evidence exists; it is not a current remote GitHub CI run. |
| BUG-009 | Safe workspace manage/description/archive/restore/empty deletion implemented; full physical and metadata-sync acceptance remains. |
| BUG-010 | Customer QA controls removed; production inventory review remains. |
| BUG-012 / FEAT-004 | Bundled original coin audio/settings implemented; owner listening/silent-mode approval remains. |
| FEAT-001 | Group management/summaries implemented; detailed group reports and transfer parity need acceptance. |
| FEAT-002 | Exact DELETE, account edit/archive/restore implemented; native regression remains. |
| FEAT-003 | Local grants and role checks only. TeamSharingModal hashes `employee:${email}`; this is not a verified employee Google subject. Authenticated cross-user sharing transport and identity binding are incomplete. |
| FEAT-005/006 | Blog and per-customer scoped API/MCP not implemented. Preserve admin-only V1 blog publishing and customer integration isolation requirements. |
| FEAT-007 | Profile/menu/grouped settings/font/motion work implemented; full UX acceptance remains. |
| FEAT-008 | Native biometric and PIN fallback implemented; actual enrolled/unsupported/cancel/enrollment/background tests remain. |
| FEAT-009 | Workspace images are local-only; private cross-device image replication and backup inclusion remain. |
| FEAT-010 | SaaS/billing/central mirror remains a proposal with unresolved cost, consent and retention choices. |
| FEAT-011 | New transaction notifications and owner/admin announcements: specified in Notion, not implemented. |

## Source gaps behind historical blanket PASS claims

- `src/components/AddTransactionTab.tsx` assigns `receipt-sha256-mock`; receipt selection is not evidence of durable content-addressed attachment storage and replication.
- `src/storage/workspaceMedia.ts` explicitly separates workspace images from finance snapshots and Drive batches.
- `src/domain/recurring.ts` has occurrence/due-date helpers and ReportsTab stores rules; no production caller of the due-date/occurrence helpers was found for scheduled posting. Full recurring automation is incomplete.
- Budget evaluation/storage/progress exists, but native/Web scheduled notification delivery is absent.
- No public service worker, Web App Manifest or service-worker registration was found in the inspected Web entry/public files. IndexedDB is not an offline cached app shell.
- Reports export CSV/XLSX. Full PDF/calendar/bookmark/reconciliation behavior is not established; the current Calendar section displays recent cashflow entries.
- Android declares POST_NOTIFICATIONS, but no runtime notification permission flow, push receiver/client, Web push worker, inbox or admin sender was found.

Source audit uses current code and prior test/build evidence; no application code changed and no new test run is claimed for this documentation update. Older reports describe their own point in time, not current release readiness.

## FEAT-011 implementation contract

1. Notify only after durable commit. Financial rollback/failure never creates a success event. Use operation/event and recipient IDs for durable deduplication across retries, restore and remote replay.
2. Separate immediate local feedback/inbox from cross-device background delivery. Offline-origin events cannot reach other devices until reconnection. Push cannot become financial ledger authority.
3. Android needs contextual runtime permission/channels and foreground/background handling; Web needs supported-browser checks, user opt-in, HTTPS production origin and a service worker coordinated with future PWA caching.
4. Register device tokens to a server-verified identity, isolate tenants, rotate/revoke/unbind tokens on sign-out/account switch, and keep private transaction details out of default lock-screen payloads.
5. Add transaction/security/announcement preferences and safe authorized deep links. Permission denial must not block finance saves or Drive sync.
6. Owner/admin sender requires server-side role checks, drafts, preview, test delivery, explicit final-send action, target restrictions, audit, rate limits and campaign deduplication. Accepted, received and opened are different delivery states.
7. A small authenticated Node/TypeScript sender and metadata queue with FCM Android/Web transport is proposed. Full central financial mirroring and subscriptions are not prerequisites. Provider/hosting/configuration and privacy implications must be resolved before enabling delivery; no paid signup or service activation occurred.
8. Keep server credentials out of APK, Web bundle, Git, Notion and chat. A claimed email/hash or a Drive access token is not proof of admin authority.

Official references checked: [FCM trusted server](https://firebase.google.com/docs/cloud-messaging/server-environment), [Web client setup](https://firebase.google.com/docs/cloud-messaging/web/get-started), [Android notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission).

## Execution order recorded in Notion

Release-safety acceptance → notification foundation and real sender/admin delivery → receipt/media/recurring/budget gaps → Web PWA/HTTPS/OAuth/distribution → secure employee/blog/API extensions → separately budgeted SaaS/billing/managed backups.

Existing accounting remains SQLite/IndexedDB plus private Google Drive. No Supabase, database wipe, duplicate cloud authority, public broadcast, financial-record mutation or production deployment was introduced by this audit.
