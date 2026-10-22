# 13 — MASTER FLOWCHART REFERENCE
This file holds condensed Mermaid workflows for designers, engineering agents and QA.

## 1. Release pipeline
```mermaid
flowchart LR
 A[Android Repo and UI] --> B[SQLite and Finance Engine]
 B --> C[Google Login and Drive Consent]
 C --> D[Two Android Device Sync]
 D --> E[Update Protection and Restore]
 E --> F[Android QA and Play Release]
 F --> G[Shared Contracts Frozen]
 G --> H[Web UI and IndexedDB]
 H --> I[Android Web Sync Test]
 I --> J[Web QA and Deployment]
```

## 2. Login and bootstrap
```mermaid
flowchart TD
 A[Install Android] --> B[Continue with Google]
 B --> C{Internet / Google identity verified?}
 C -- No --> D[First-use needs Internet; Retry]
 C -- Yes --> E[Google Drive appData consent]
 E --> F{Consent granted?}
 F -- No --> G[Explain / Retry; never claim cloud ready]
 F -- Yes --> H[Scan own Drive app files]
 H --> I{Existing cloud data?}
 I -- Yes --> J[Stage / Validate / Restore]
 I -- No --> K[Initialize SQLite and Workspace]
 J --> L[Dashboard Ready]
 K --> L
```

## 3. Offline local write and eventual sync
```mermaid
flowchart TD
 A[Income Expense Transfer] --> B[Validate Exact Money and Accounts]
 B --> C[Atomic SQLite Journal and Outbox]
 C --> D[Saved on Device]
 D --> E{Online and Google token?}
 E -- No --> F[Show Waiting to Sync]
 E -- Yes --> G[Upload Immutable Own Device Batch]
 G --> H[Verify Remote Receipt]
 H --> I[Download Other Device Batches]
 I --> J[Validate / Dedupe / Merge]
 J --> K{Conflict?}
 K -- Yes --> L[Preserve Versions; Needs Review]
 K -- No --> M[Recompute Journal Balances]
 M --> N[Verified Synced Status]
```

## 4. Safe app update / crash recovery
```mermaid
flowchart TD
 A[New Signed App Version] --> B[Open Existing DB and Read Version]
 B --> C[Create Consistent Local Recovery Snapshot]
 C --> D{Enough disk / valid snapshot?}
 D -- No --> E[Safe Mode; Keep Existing Data]
 D -- Yes --> F[Transactional Incremental Migration]
 F --> G{Integrity/Amounts/Outbox OK?}
 G -- No --> E
 G -- Yes --> H[Commit Version and Refresh Dashboard]
 H --> I[Resume Drive Sync When Available]
```

## 5. Second device onboarding
```mermaid
flowchart TD
 A[Device B Continue with same Google] --> B[Authorize Drive appData]
 B --> C[Download Verified Checkpoint and Op History]
 C --> D[Build Staged Local DB]
 D --> E{All required operations valid?}
 E -- No --> F[Safe Retry; Don't announce full restore]
 E -- Yes --> G[Atomic Restore and Report Counts]
 G --> H[Catch Up from Device A and Own New Writes]
```
