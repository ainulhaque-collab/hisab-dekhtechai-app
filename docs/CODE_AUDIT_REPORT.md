# Hisab DekhteChai (হিসাব দেখতে চাই) — Code Audit Report

**Date:** 2026-10-23  
**Audit Branch:** `fix/finance-storage-sync-hardening` (branched from `main` @ `ae16803`)  
**Auditor:** Lead Architect & Financial Systems Auditor  
**Application Target:** Android Capacitor (Primary), Web SPA (Secondary)

---

## 1. Executive Summary

A comprehensive structural, financial, storage, and security audit of the **Hisab DekhteChai** codebase was performed. 

The application has established a solid architectural foundation with integer-paisa math, double-entry balanced journal contracts, multi-party business ledger structures, and clean bilingual UI components. However, several **critical data safety, persistence, and synchronization gaps** require immediate remediation:

1. **Storage Durability Risk:** `src/storage/db.ts` currently persists application state in browser `localStorage` as serialized JSON. On Android and Web, `localStorage` is subject to OS eviction, storage quotas, WebView crashes, and lack of atomic multi-table transactions.
2. **Simulated Authentication in Production Flow:** `src/auth/googleAuth.ts` contains fallback code that generates synthetic tokens (`oauth-token-...`) and fake identities when offline or GIS is unavailable.
3. **Simulated Drive Transport Active in App Context:** `src/context/AppContext.tsx` instantiates `SimulatedGoogleDriveTransport` by default. Real Google Drive v3 REST calls to `drive.appdata` were bypassed in production runtime.
4. **Drive Pagination & Backoff Incompleteness:** `RealGoogleDriveTransport.listAppDataFiles` in `src/drive/transport.ts` only fetches the first 100 files without looping through `nextPageToken`.
5. **Security & PIN Storage:** App PIN lock was only stored in plain React component state and was not derived using PBKDF2/SHA-256 with salted key storage.

---

## 2. Existing localStorage Schema & Non-Destructive Migration Plan

### 2.1 Existing Schema Structure (`hisab_dekhtechai_db` / `hisab_db_<deviceId>`)
The serialized JSON state stored in `localStorage` under `hisab_dekhtechai_db` contains:
```typescript
interface DatabaseStateSerializable {
  schemaVersion: number; // Currently 3
  localIdentity: {
    ownerSubjectHash: string;
    accountDisplayHint?: string;
    createdAt: string;
  } | null;
  deviceIdentity: {
    deviceId: string;
    deviceName: string;
    counter: number;
    createdAt: string;
  };
  workspaces: [string, Workspace][];
  accounts: [string, Account][];
  categories: [string, Category][];
  parties: [string, BusinessParty][];
  journalTransactions: [string, JournalTransaction][];
  journalLines: [string, JournalLine][];
  syncOperations: [string, SyncOperation][];
  syncOutbox: [string, SyncOutboxEntry][];
  appliedOperations: string[];
  syncDeviceHeads: [string, number][];
  conflicts: [string, ConflictRecord][];
  budgets: [string, Budget][];
  recurringRules: [string, RecurringRule][];
  recurringOccurrences: [string, RecurringOccurrence][];
  receiptBlobs: [string, ReceiptBlob][];
  localSnapshots: [string, LocalSnapshot][];
  schemaMigrations: SchemaMigration[];
  preferences: [string, any][];
}
```

### 2.2 Non-Destructive Migration & Zero-Data-Loss Invariant
To ensure no customer data is ever deleted or corrupted:
1. **Pre-Migration Snapshot:** Before writing to SQLite / OPFS, the full raw JSON string is backed up to a dedicated safety key: `hisab_legacy_backup_<timestamp>`.
2. **Integrity Checksum:** Compute SHA-256 hash of the payload and verify all account balance checksums.
3. **Dual-Read / Dual-Write Verification Gate:** Migrate entities into SQLite tables (`workspaces`, `accounts`, `categories`, `parties`, `transactions`, `journal_lines`, `sync_outbox`, `sync_ops`).
4. **Post-Migration Record & Balance Audit:** Verify that the total number of transactions and the computed account balances in SQLite exactly match the legacy state.
5. **Rollback Strategy:** If any error occurs during SQLite initialization, the database safely continues reading from the verified local snapshot without clearing localStorage.

---

## 3. Feature Audit & Status Matrix

| Module | Feature | Implementation Status | Notes |
| :--- | :--- | :--- | :--- |
| **Storage** | SQLite Native on Android | **PARTIAL / NEEDS HARDENING** | Capacitor SQLite bridge needed; currently falls back to localStorage. |
| **Storage** | SQLite / OPFS on Web | **PARTIAL** | Memory + localStorage fallback; OPFS durable driver required. |
| **Finance** | Integer Paisa Math (BigInt) | **COMPLETE** | Exact 1 BDT = 100 Paisa calculations verified in `src/domain/money.ts`. |
| **Finance** | Balanced Double-Entry Journal | **COMPLETE** | Debits equal credits strictly enforced; unbalance throws `InvariantViolation`. |
| **Finance** | Immutable Reversal Journals | **COMPLETE** | Editing/deleting generates reversal journals with audit trail. |
| **Finance** | Multi-Person Business Ledger | **COMPLETE** | Partners, staff, customers, suppliers with transaction tagging. |
| **Auth** | Real Google Sign-In (GIS) | **PARTIAL** | Web GIS token client exists, but simulated demo fallback must be isolated from production. |
| **Auth** | Drive Scoped Authorization | **PARTIAL** | Needs token renewal and secure platform storage for Android. |
| **Sync** | Canonical JSON & SHA-256 | **COMPLETE** | Deterministic key ordering and hash calculation verified. |
| **Sync** | Real Drive appDataFolder | **PARTIAL** | REST client exists but lacks pagination (`nextPageToken`) and backoff retries. |
| **Sync** | Outbox Queue & Deduplication | **COMPLETE** | `applied_operations` set and op UUID idempotency verified. |
| **Sync** | Conflict Quarantine | **COMPLETE** | Concurrent competing corrections quarantined without silent LWW. |
| **Security** | 4-Digit PIN Lock | **PARTIAL** | UI exists in settings, needs SHA-256/PBKDF2 salted hash persistence. |
| **UI** | Bilingual Support (BN/EN) | **COMPLETE** | Modern financial design, no missing glyph boxes, clean typography. |
| **Export** | CSV Financial Export | **COMPLETE** | RFC-4180 compliant with formula injection protection (`=, +, -, @`). |
| **Export** | XLSX Export | **MISSING** | Priority 1 feature in Phase 6. |

---

## 4. Security & Financial Risk Analysis

### 4.1 Security Vulnerabilities
- **VULN-01: Hardcoded / Simulated Auth Fallback in Production:**
  `promptGoogleSignIn` fell back to hardcoded `ainulshalkhuria@gmail.com` with synthetic token `oauth-token-...`.
  *Remediation:* Strictly decouple test mock transport from production runtime. Production must enforce authentic Google authorization.
- **VULN-02: Plaintext PIN Verification:**
  PIN was kept in volatile state without cryptographic hashing.
  *Remediation:* Hash PIN with salt via PBKDF2/SHA-256 before storing in local encrypted preferences.

### 4.2 Data-Loss & Persistence Risks
- **RISK-01: LocalStorage Eviction:**
  Mobile WebViews can evict `localStorage` when device storage runs low.
  *Remediation:* Implement native SQLite for Android (Capacitor) and IndexedDB/OPFS fallback for Web.
- **RISK-02: Drive File List Truncation:**
  Fetching `pageSize=100` without checking `nextPageToken` would cause devices with >100 sync batch files to miss remote operations.
  *Remediation:* Implement full pagination loop while checking `nextPageToken`.

---

## 5. Baseline Test Results

All 15 domain and sync unit tests executed on baseline:
```
TAP version 13
ok 1 - Money domain: integer paisa conversion and exact math
ok 2 - Money domain: normalizeNumericAmountInput converts Bengali digits to English
ok 3 - Double-entry journal: Income transaction balance invariant
ok 4 - Double-entry journal: Transfer with fee balance invariant
ok 5 - Double-entry journal: Unbalanced journal rejection
ok 6 - Reversal journal: inverts original debits and credits with audit reference
ok 7 - Deterministic recurring occurrence ID
ok 8 - CSV formula injection protection
ok 9 - Database migrations: snapshot capture, integrity verification, and non-destructive upgrade
ok 10 - Business Ledger: Multiple persons / parties management and transaction linkage
ok 11 - Canonical JSON serialization: deterministic keys and SHA-256
ok 12 - Two-device offline concurrent sync and eventual convergence
ok 13 - Idempotency: Re-syncing duplicate batches never duplicates transactions
ok 14 - Conflict quarantine: concurrent incompatible corrections do NOT use silent last-writer-wins
ok 15 - Sync error handling: 403 quota and 401 unauthorized status reporting
1..15
# tests 15, suites 0, pass 15, fail 0
```
- **TypeScript Typecheck:** `npx tsc --noEmit` -> PASS (0 errors).
- **Vite Production Build:** `npm run build` -> PASS (0 errors, 439ms).
- **Android Asset Sync:** `npx cap sync android` -> PASS (0 errors).

---

## 6. Release Blockers

1. **BLOCKER-1:** Storage engine must transition from volatile `localStorage` to durable SQLite/IndexedDB/OPFS.
2. **BLOCKER-2:** Decouple simulated Google Drive transport from production UI in `src/context/AppContext.tsx`.
3. **BLOCKER-3:** Add full pagination and exponential backoff retry loop in `RealGoogleDriveTransport`.
4. **BLOCKER-4:** Salted hash persistence for the 4-digit security PIN lock.
5. **BLOCKER-5:** Implement missing Priority 1 features (Ledger archive/restore, XLSX export, advanced filters).

---

## 7. Action Plan & Next Phases
- **Phase 1:** Implement durable SQLite / IndexedDB / OPFS storage engine with pre-migration snapshot, balance verification, and non-destructive migration.
- **Phase 2:** Financial Accounting Engine audit & hardening (account classifications, transfer fees, reversal invariants).
- **Phase 3:** Real Google Authentication & token renewal hardening.
- **Phase 4:** Real Two-Way Google Drive Synchronization with pagination, backoff, and outbox durability.
- **Phase 5:** Security PIN lock with salted hash & session verification.
- **Phase 6:** Priority 1 and Priority 2 feature implementations (XLSX export, ledger archive/restore, advanced search).
- **Phase 7 & 8:** Full regression test suite, QA release report, and milestone documentation.
