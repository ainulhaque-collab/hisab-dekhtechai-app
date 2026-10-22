# 09 — TEST PLAN, ACCEPTANCE CRITERIA, RELEASE GATES
All tests marked `NOT_STARTED` until someone actually runs them; this document is **NOT** test evidence.

## 1. Test levels / tooling suggestions
- Domain math/property tests: Vitest with randomized safe ledger records and precise integer arithmetic.
- Android adapter tests: instrumented SQLite tests on emulator/real devices; Android native worker tests; package and signing test.
- UI: React Testing Library / Playwright where compatible; Android emulator screenshots and manual a11y checks.
- Integration: **two physical Android devices** or independent emulators each configured with the same test Google Account and distinct device IDs. Separate test Google Account for isolation.
- Network fault injection: airplane mode, connection toggle, throttling, `401/403/429/500`, dropped upload response, slow Drive listing, malformed file, quota-full.
- Web phase: desktop/mobile browser; two distinct profiles/tabs; Android↔Web testing.
- Don't use any real customer financial data in tests. Store mocked ledger fixtures without emails or access tokens in repository.

## 2. Mandatory finance integrity suite
| ID | Test | Pass condition |
|---|---|---|
| F01 | Create income in cash | posted balanced double-entry and cash +amount |
| F02 | Create expense in bKash | posted balanced entry, expense +amount, bKash -amount |
| F03 | Transfer cash→bank | principal not included in income/expense reports |
| F04 | Transfer with fee | only fee is expense; cash/bank combined movement = -fee |
| F05 | Duplicate request/outbox operation | exactly one posted accounting event |
| F06 | Fractional BDT/paisa and upper safe bound | precise integer amounts, no JS float drift |
| F07 | Partial write/process-kill | no half journal, no journal missing outbox |
| F08 | Invalid account/workspace | rejected, no journal posted |
| F09 | Post correction/reversal | old audit retained; balances correct after reversal+replacement |
| F10 | Date boundary in Asia/Dhaka | reporting effective date remains correct |
| F11 | CSV export malicious value beginning `=`/`+`/`-`/`@` | spreadsheet-formula injection neutralized appropriately |
| F12 | Workspace switching | no transaction from workspace A leaks to B report |

## 2A. Full-feature acceptance
| ID | Test | Pass condition |
|---|---|---|
| X01 | Monthly category budget offline | local spending progress matches posted expense journal |
| X02 | Budget changes on Android A and B | versioned sync, no silent override |
| X03 | Same recurring due date generated offline on A and B | exact ONE occurrence/journal posting after merge |
| X04 | Recurring rule edit vs occurrence | deterministic version/causal resolution, no double post |
| X05 | Receipt local photo then cloud re-download on new phone | blob hash matches; finance entry preserved even if blob delayed |
| X06 | Missing receipt blob | show pending/unavailable state; journal stays intact |
| X07 | CSV/XLSX/PDF export offline | totals agree with journal; prevent spreadsheet formula injection |
| X08 | Financial calendar, bookmark/archive | reflected accurately across devices |

## 3. Drive sync/recovery suite
| ID | Test | Pass condition |
|---|---|---|
| S01 | Android A→Drive→Android B | one op delivered and applied once, exact ledger totals |
| S02 | Android B→Drive→Android A | reverse operation delivered, exact totals |
| S03 | Both devices change offline | both sets survive and converge after sync |
| S04 | Duplicate remote file names and repeated op segments | no duplicate transaction |
| S05 | Upload success but local response lost | eventual outbox resolution, exactly once apply |
| S06 | Kill during remote import | import resumes/replays idempotently, no corruption |
| S07 | Different device clock/timezone | no incorrect causal last-writer-wins |
| S08 | Same posted event corrected concurrently | conflict surfaced; neither correction silently overwrites |
| S09 | Google OAuth revoked/expired | local work still saves; honest reauthorization state |
| S10 | Wrong Google account signs in | other account's finance inaccessible; no unsafe merge |
| S11 | Full Drive storage | outbox retained, warning, retry on space cleared |
| S12 | Corrupt/truncated op file | quarantined, no corrupt journal import; status warning |
| S13 | Deleted/renamed cloud file / lost changes cursor | reconcile full remote inventory; preserve local |
| S14 | New Android device restore from checkpoint + later ops | exact counts, balances, verified restore, no recovery key |
| S15 | Pause sync and then resume | pending count remains correct; catches up |
| S16 | Extremely long offline interval | catches up without prematurely deleted remote log |
| S17 | Multiple appDataFolder pages | every page traversed; no skipped operations |
| S18 | Google Drive API rate limiting 429/403 | capped exponential backoff; no busy loop |
| S19 | Cloud destructive action warning | refuses silent cloud data delete |
| S20 | Later Android↔Web cross-client sync | same stable identity and Drive app area, exact totals |

## 4. Upgrade and no-data-loss suite
| ID | Test | Pass condition |
|---|---|---|
| U01 | v1 database→v2 incremental migration offline | journal/accounts/outbox IDs and balances identical |
| U02 | direct older supported release→latest | migration chain works, no wipe |
| U03 | power/process failure during migration | last good snapshot recoverable, no partial schema |
| U04 | app update with unsynced outbox | every pending op remains pending until uploaded |
| U05 | no storage space for snapshot/migration | update blocked safely, no destructive workaround |
| U06 | stale build opens newer DB | read-only safe mode, no downgrade wipe |
| U07 | force stop/restart while syncing | resume safely with no duplicate journal |
| U08 | old snapshot restore while cloud newer | new cloud ops still recovered; no overwrite |
| U09 | cloud unavailable at update | local data remains usable offline |
| U10 | account sign out then same Google sign-in | no unexpected local deletion |

## 5. Android usability/release suite
- First-run from clean install + online consent, denied consent, network offline, repeated sign-in.
- Returning phone offline launch, transaction entry, date filter, report, account balance, CSV export.
- Bangla-first fonts, screen reader, large text, landscape, back navigation, low-memory and typical low-end Android phone.
- ApplicationId, Play App Signing, production signing fingerprint registered in Google Cloud; debug and release OAuth both work.
- Privacy Policy and Play Data Safety accurately reflect app behavior; Google OAuth verification complete as required.
- Play new apps API target checked at publication. Android beta tester feedback addressed, crash logs reviewed (without customer finance data).
- Play production release requires explicit owner approval and rollback/forward-fix plan.

## 6. Android release gating matrix
| Gate | Required proof | Status |
|---|---|---|
| RG-01 Build | APK/AAB generated, exact version+SHA | NOT_STARTED |
| RG-02 Finance correctness | F01–F12 logs, balances and fixtures | NOT_STARTED |
| RG-03 Actual two-device sync | S01–S19 recorded tests | NOT_STARTED |
| RG-04 Update protection | U01–U10 upgrade/restore evidence | NOT_STARTED |
| RG-05 Account privacy | separate Google account tests, consent logs (redacted) | NOT_STARTED |
| RG-06 UX & accessibility | real Android screen recordings/screenshots + issues | NOT_STARTED |
| RG-07 Store readiness | Play Console review, policy/privacy, staged rollout | NOT_STARTED |
| RG-08 Owner approval | explicit go-live consent | NOT_STARTED |

## 7. Failure severity (block launch)
- **P0:** balance mismatch, irreversible record loss, another Google user's data leak, silent account switch mix-up, destructive migration, unhandled duplicate double-post, invalid restore marked success.
- **P1:** sync never resumes under normal network/auth, broken Google OAuth production signing, misleading status, freeze/crash on ordinary offline add, impossible conflict resolution.
- **P2:** layout glitches, nonessential report style, optional theme issue.
Release requires zero open P0/P1 issues or an explicit documented accepted-risk decision (but never waive financial data leak/loss for production).

## 8. Runbook for QA agent
Every run: record environment (device/Android version, debug/release build ID), database fixture fingerprint, offline duration, tested owner ID pseudonym, exact steps, expected vs observed balances, file operation counts, cloud permissions, test results, issue tracker links and evidence paths. Never fabricate a pass or a screenshot.
