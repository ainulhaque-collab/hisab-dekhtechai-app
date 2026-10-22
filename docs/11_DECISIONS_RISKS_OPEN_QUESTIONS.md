# 11 — DECISIONS, FEASIBILITY SPIKES & RISK REGISTER

## A. Locked user decisions (do not reconfirm)
| ID | Decision |
|---|---|
| D01 | Name: Hisab DekhteChai / হিসাব দেখতে চাই |
| D02 | Android FIRST; Web AFTER Android; no native Windows |
| D03 | Minimal blue-white Bangla-first design; outline icons |
| D04 | First Google sign-in is the only customer identity step; no technical API setup |
| D05 | User's own Google Drive used for automatic two-way syncing |
| D06 | No Supabase/Firebase financial DB or proprietary hosted finance backend |
| D07 | No mandatory Recovery Key in V1 |
| D08 | Android works offline after initial authenticated setup |
| D09 | App updates may not intentionally wipe existing data |
| D10 | Customer financial data protected; limitations explained accurately |

## B. Engineering decisions in this blueprint
| ID | Choice | Why |
|---|---|---|
| E01 | One owner Google subject per finance dataset in V1 | No server-side role authority in customer-owned Drive |
| E02 | Immutable per-device operation batches | Avoid global mutable manifest races and silent overwrite |
| E03 | Derived double-entry balances | Reconciliation across devices after offline work |
| E04 | `drive.appdata` as preferred storage | Narrowest sync-specific Drive access, no customer API setup |
| E05 | No cloud E2EE assertion in V1 | No Recovery Key or trusted cross-device escrow |
| E06 | Offline-first local SQLite, not Drive as primary DB | Fast writes, protects offline transactions |
| E07 | TypeScript finance core with platform adapters | Reuse when Web starts |
| E08 | No auto deletion/remote log compaction in V1 | Unknown late-offline devices may need history |

## C. Feasibility spikes before claiming 'fully supported'
1. **Cross-client appDataFolder visibility:** Android OAuth and later Web OAuth from one Google project can read same own account app-data files with appropriate published OAuth scope. Test with *real* test account; do not assume it.
2. **Android Native background auth:** WorkManager obtains Drive authorization without insecure token persistence; if silent access unavailable, surface foreground requirement honestly.
3. **SQLite plugin encryption and migration:** Verify current Capacitor/Gradle/Kotlin support, 64-bit paisa transport without precision loss, transaction boundaries and backup consistency.
4. **Drive format scale:** Max file counts, listing pagination, checkpoint, quota, retention; no per-transaction file explosion.
5. **OAuth consent verification:** Determine whether verification/brand ownership steps apply; they are developer-side once, never per customer.
6. **Play release compliance:** API target, Google Play Console test requirements, Data Safety and identity/privacy obligations current at release.
7. **Missing phone vs missing unsynced data:** A failed cloud sync means recent local-only operations cannot be retrieved from a destroyed phone. Display warning prominently.

## D. Deferred choices needing owner approval only when encountered
- Final unique package name, app icon/logotype and public domain, if not decided in project materials.
- Visible Drive export instead of hidden appDataFolder automatic sync: optional later. Don't switch cloud location without migration plan.
- Budgets, recurring, calendar and XLSX/PDF are targeted for complete Android V1; receipt sync is V1 only after an explicit attachment proof gate. If a dependency blocks any feature, surface it to owner; never silently omit.
- Optional app PIN/biometric lock, offline sign-out wipe semantics, accounting account negative-balance policy.
- Collaborative team accounts or approval/reject system: requires trustworthy roles/audit and a new explicitly approved architecture.
- Advanced encryption with customer-held recovery secret: user explicitly deferred to future version.

## E. Key risks and mitigation
| Risk | Severity | Mitigation |
|---|---|---|
| Google Drive not realtime; web closed | Medium UX | Clear sync status, eventual consistency messaging |
| Two-device concurrent corrections | High integrity | immutable operations, explicit conflict resolution |
| Outbox wiped by app update | Critical | atomic journal+outbox, migrations+backups, tests |
| Cloud version replaces newer local data | Critical | stage verify merge; never replace blindly |
| Google account takeover | High privacy | scoped OAuth, no E2EE claims, user security guidance |
| New phone lacks unuploaded offline change | High availability | warn pending backup, opt-in local export strategy |
| OAuth token revoked/expires | Medium UX | safe local use and interactive reauthorization |
| User deletes appDataFolder | High recovery | verified local data, versioned backups, export instructions |
| Large history slows Drive listing | High scale | batch immutable ops, cursor + periodic checkpoint, load tests |
| Browser storage eviction | High availability | warn pending local edits, sync during active sessions |
| Claiming multi-user roles without backend | Critical security | explicitly V1 single owner; do not fake shared roles |

## F. Status as of documentation creation
- Requirements: drafted, ready for owner review.
- Android code: **not created in this task**.
- Real Google integration: **not tested in this task**.
- Financial and cloud tests: **not run in this task**.
- Play Store/Web deployment: **not performed in this task**.
