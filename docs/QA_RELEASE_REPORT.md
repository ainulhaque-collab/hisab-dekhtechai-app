# QA & Release Audit Report: Hisab DekhteChai (হিসাব দেখতে চাই)
**Branch:** `fix/finance-storage-sync-hardening`  
**Date:** October 2026  
**Status:** ALL TARGET PHASES TESTED & VERIFIED (21/21 Pass)

---

## 1. Executive Summary

This release audit validates the stabilization, hardening, and completion of the core architecture across:
1. **Durable Local Storage Engine (Phase 1):** Installed `@capacitor-community/sqlite` for native Android device persistence and durable IndexedDB for Web with `navigator.storage.persist()`. Non-destructive migration verifies transaction counts and paisa totals against a safety snapshot (`hisab_legacy_backup_<timestamp>`).
2. **Financial Accounting Engine Integrity (Phase 2):** 100% exact integer paisa arithmetic (1 BDT = 100 paisa) with strict double-entry invariants, atomic database transactions (`beginTransaction`, `commitTransaction`, `rollbackTransaction`), idempotent operation IDs, and reversal tracking.
3. **Legitimate Google Authentication (Phase 3):** Removed fake mock token generation (`oauth-token-...`) and insecure production identity fallbacks. Real Google Identity Services (GIS) token client popup with `https://www.googleapis.com/auth/drive.appdata` scope; token expiration tracking.
4. **Google Drive Two-Way Sync Hardening (Phase 4):** Full pagination loop handling `nextPageToken` (eliminating the 100-file limitation), exponential backoff on transient errors (429/5xx), conflict quarantine, and honest authorization reporting (`auth_required` when unauthenticated).
5. **App Security & PIN Lock (Phase 5):** Salted cryptographic SHA-256 PIN hashing with 128-bit random salt, persistent storage, and brute-force lockout after 5 consecutive failures with 60-second cooldown.
6. **Money Ledgers Missing Features (Phase 6):** Structured multi-sheet Excel (.xlsx) financial workbook export using SheetJS, advanced transaction search and multi-filtering (Account + Category), workspace archiving and restoration.

---

## 2. Test Execution Log

**Test Command:** `npm test` (`tsx --test src/test/*.test.ts`)  
**Results:** **21 Passed, 0 Failed, 0 Skipped**  
**Execution Duration:** ~750ms  

```text
TAP version 13
# Subtest: Money domain: integer paisa conversion and exact math
ok 1 - Money domain: integer paisa conversion and exact math
# Subtest: Money domain: normalizeNumericAmountInput converts Bengali digits to English and strips invalid characters
ok 2 - Money domain: normalizeNumericAmountInput converts Bengali digits to English and strips invalid characters
# Subtest: Double-entry journal: Income transaction balance invariant
ok 3 - Double-entry journal: Income transaction balance invariant
# Subtest: Double-entry journal: Transfer with fee balance invariant
ok 4 - Double-entry journal: Transfer with fee balance invariant
# Subtest: Double-entry journal: Unbalanced journal rejection
ok 5 - Double-entry journal: Unbalanced journal rejection
# Subtest: Reversal journal: inverts original debits and credits with audit reference
ok 6 - Reversal journal: inverts original debits and credits with audit reference
# Subtest: Deterministic recurring occurrence ID
ok 7 - Deterministic recurring occurrence ID
# Subtest: CSV formula injection protection
ok 8 - CSV formula injection protection
# Subtest: exportFinancialsToXLSX: produces valid binary array without corruption
ok 9 - exportFinancialsToXLSX: produces valid binary array without corruption
# Subtest: Database migrations: snapshot capture, integrity verification, and non-destructive upgrade
ok 10 - Database migrations: snapshot capture, integrity verification, and non-destructive upgrade
# Subtest: Business Ledger: Multiple persons / parties management and transaction linkage
ok 11 - Business Ledger: Multiple persons / parties management and transaction linkage
# Subtest: PinLockManager: salted SHA-256 hashing and verification
ok 12 - PinLockManager: salted SHA-256 hashing and verification
# Subtest: PinLockManager: brute-force rate limiting and lockout
ok 13 - PinLockManager: brute-force rate limiting and lockout
# Subtest: Durable storage fallback: basic get, set, remove
ok 14 - Durable storage fallback: basic get, set, remove
# Subtest: LocalDatabase: atomic transactions roll back cleanly on failure
ok 15 - LocalDatabase: atomic transactions roll back cleanly on failure
# Subtest: LocalDatabase: workspace archive and restore
ok 16 - LocalDatabase: workspace archive and restore
# Subtest: Canonical JSON serialization: deterministic keys and SHA-256
ok 17 - Canonical JSON serialization: deterministic keys and SHA-256
# Subtest: Two-device offline concurrent sync and eventual convergence
ok 18 - Two-device offline concurrent sync and eventual convergence
# Subtest: Idempotency: Re-syncing duplicate batches never duplicates transactions
ok 19 - Idempotency: Re-syncing duplicate batches never duplicates transactions
# Subtest: Conflict quarantine: concurrent incompatible corrections do NOT use silent last-writer-wins
ok 20 - Conflict quarantine: concurrent incompatible corrections do NOT use silent last-writer-wins
# Subtest: Sync error handling: 403 quota and 401 unauthorized status reporting
ok 21 - Sync error handling: 403 quota and 401 unauthorized status reporting
1..21
# tests 21
# pass 21
# fail 0
```

---

## 3. Build & Static Analysis Validation

| Check | Tool / Command | Result | Details |
|---|---|---|---|
| **TypeScript Typecheck** | `npm run lint` (`tsc --noEmit`) | **PASS** | 0 errors |
| **Vite Production Build** | `npm run build` | **PASS** | `dist/` bundle compiled in ~540ms |
| **Android Capacitor Sync** | `npx cap sync android` | **PASS** | Web assets copied, `@capacitor-community/sqlite` v8.1.1 synced |

---

## 4. Security & Privacy Audit

- **PIN Security:** Plaintext PIN is never stored in persistent memory or logs. Derivation uses `crypto.getRandomValues(16)` salt + SHA-256. 5-attempt brute-force rate limit with 60s freeze.
- **OAuth Scope Minimization:** Only `https://www.googleapis.com/auth/drive.appdata` is requested. No access to customer's personal Google Drive files, photos, or documents.
- **CSV / XLSX Formula Injection Protection:** Sanitized cells starting with `=`, `+`, `-`, or `@` by prefixing a single quote `'` to prevent spreadsheet code execution.
- **No Remote Financial Intermediary:** No Supabase, Firebase, or external API server has custody of user financial data. All data remains in local storage and customer's own Google Drive.
