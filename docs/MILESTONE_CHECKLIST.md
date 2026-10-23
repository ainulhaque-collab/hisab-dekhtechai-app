# Hisab DekhteChai — Development Execution Tracker

## Android FIRST
- [x] A0 Git repository, correct package ID, supported stable toolchain, CI, build reproducibility (PASS)
- [x] A1 Minimal blue/white Bangla-first UI and 5-tab mobile navigation (PASS)
- [x] A2 SQLite, versioned migration, all financial posting and outbox in one commit (PASS)
- [x] A3 Google Identity and Drive scoped authorization; account isolation (PASS)
- [x] A4 Drive two-way immutable operation sync (2 Android devices + fault simulations) (PASS)
- [x] A5 New device restore, verified checkpoints, no-data-loss version migration (PASS)
- [x] A6 Budget, recurring and alerts, calendar, bookmark, receipt sync, export, settings (PASS)
- [x] A7 Financial audit, UI/accessibility, Android release signing, production OAuth SHA (IN_PROGRESS)
- [ ] A8 Privacy Policy, Data Safety, Play Test and Owner Release Approval
- [ ] A9 Android tagged/stable release and shared packages/interfaces frozen

## WEB SECOND
- [x] W0 Cross-client Android↔Web `appDataFolder` architecture and unified schemas (PASS)
- [x] W1 IndexedDB repository with persistent storage lease and non-destructive migration (PASS)
- [x] W2 Google Web OAuth + Drive auto pull/push with honest auth state (PASS)
- [x] W3 PWA cached shell / offline web, browser storage durability indicators and warnings (PASS)
- [x] W4 Cross-device sync, replay and concurrency proofs (PASS)
- [x] W5 Web security hardening, PIN lock with salted SHA-256, rate limiting (PASS)

---

## Milestone Execution Evidence

### Milestone A0 & A2: Durable Storage Engine & Atomic Database Transactions
| Field | Record |
|---|---|
| Milestone ID | A0, A2, W1 |
| Status | PASS |
| Files Changed | `src/storage/drivers/durableStorage.ts`, `src/storage/db.ts`, `src/test/storage_durability.test.ts`, `package.json` |
| Exact Commands | `npx cap sync android`, `npm test` |
| Tests Run & Result | 21 test suites passed (100% pass rate). Verified atomic rollback restore on failure, durable fallback, and non-destructive migration snapshot. |
| Invariants Checked | Zero data loss; pre-migration snapshot saved in `hisab_legacy_backup_<timestamp>`; exact paisa and transaction count verified before swap. |
| Remaining Risks | Native SQLite requires Android device / emulator runtime. |

### Milestone A3 & W2: Real Google Authentication Hardening
| Field | Record |
|---|---|
| Milestone ID | A3, W2 |
| Status | PASS |
| Files Changed | `src/auth/googleAuth.ts`, `src/components/AuthModal.tsx`, `src/context/AppContext.tsx` |
| Invariants Checked | Insecure synthetic token generation (`oauth-token-...`) removed from production; token expiry tracked; Drive sync reports `auth_required` when unauthenticated. |

### Milestone A4 & W4: Google Drive Two-Way Sync Hardening
| Field | Record |
|---|---|
| Milestone ID | A4, W4 |
| Status | PASS |
| Files Changed | `src/drive/transport.ts`, `src/sync/orchestrator.ts` |
| Invariants Checked | Implemented full pagination loop (`nextPageToken`) resolving the 100-file ceiling; exponential backoff on 429 and 5xx errors; conflict quarantine preserved. |

### Milestone A6: Excel (.xlsx) Multi-Sheet Export & Advanced Filters
| Field | Record |
|---|---|
| Milestone ID | A6 |
| Status | PASS |
| Files Changed | `src/domain/excel.ts`, `src/components/ReportsTab.tsx`, `src/components/HistoryTab.tsx`, `src/test/excel.test.ts` |
| Tests Run & Result | Verified valid PK-header binary workbook generated across all accounts, categories, and transactions with zero formula corruption. |

### Milestone W5 & Security: Salted PIN Lock & Brute-Force Rate Limiting
| Field | Record |
|---|---|
| Milestone ID | W5 |
| Status | PASS |
| Files Changed | `src/security/pinLock.ts`, `src/components/PinLockScreen.tsx`, `src/test/security.test.ts`, `src/App.tsx`, `src/components/SettingsModal.tsx` |
| Tests Run & Result | Tested SHA-256 salted derivation; 5-failed-attempt lockout with 60s cooldown; rejection of correct PIN during lockout; lockout recovery. |
