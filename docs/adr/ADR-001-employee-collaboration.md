# Architecture Decision Record (ADR-001)
## Secure Multi-User Employee Collaboration in Hisab DekhteChai

### Status
Accepted & Implemented (Core Permission & Ledger Layer) / Feature-Flagged for Network Relay

### Date
2026-10-24

### Authors
Lead Full-Stack Engineer, Android Engineer, Financial Ledger Architect & Security Reviewer

---

## 1. Context & Business Problem
Hisab DekhteChai (হিসাব দেখতে চাই) is an offline-first financial management application serving individuals and small business owners in Bangladesh.
A critical business requirement is **FEAT-003: Employee Account Sharing and Permissions**:
- A business owner needs to grant access to specific accounts (e.g. "Cash Drawer", "bKash Merchant") to employees (e.g. Sales Staff, Cashier, Accountant).
- Access control must distinguish three distinct roles:
  1. **Owner**: Full administrative and financial control over all owned accounts, employees, and settings.
  2. **Editor**: Can post Income and Expense only for explicitly granted accounts; cannot delete accounts, access unpermitted accounts, or modify owner privileges.
  3. **Viewer**: Can view transaction history and balance for authorized accounts only; cannot post or modify transactions.
- Each employee must authenticate with their own verified identity.
- Every financial mutation must be auditable (`authorSubjectHash`, timestamps, `deviceId`, `operationId`).

---

## 2. Architectural Constraint: Personal Google Drive appDataFolder
The core synchronization architecture of Hisab DekhteChai uses the customer's personal Google Drive `appDataFolder` (`https://www.googleapis.com/auth/drive.appdata`).
- By Google's security design, **`appDataFolder` is completely isolated to the individual Google account** that authorized the app.
- An owner cannot share their private `appDataFolder` files with another user's Google account.
- Sharing the owner's private Drive OAuth credentials with employees is strictly prohibited as it would expose all personal and business files.
- The project rules strictly prohibit introducing Supabase, paid cloud databases, or recurring server hosting costs without explicit owner approval.

---

## 3. Evaluated Architectural Options

### Option A: Google Drive Shared Folder with `drive.file` Scope
- **Mechanism**: The owner creates a dedicated shared folder on their Google Drive and shares it with the employee's Google email address. Both owner and employee request the `https://www.googleapis.com/auth/drive.file` OAuth scope. Batches are written to this shared folder.
- **Cost**: $0 / month (uses Google Drive's free tier).
- **Pros**: Pure Google Drive, no external backend servers required.
- **Cons & Risks**:
  - Requires broader OAuth scope (`drive.file`) which prompts additional Google verification warnings.
  - Requires user interaction in Google Drive or Drive API folder invitation flow.
  - Folder permissions in Google Drive do not support sub-account cryptographic access control; files are visible to all folder collaborators unless encrypted client-side.

### Option B: Zero-Cost Authenticated P2P / Serverless Relay with End-to-End Cryptography (Recommended)
- **Mechanism**:
  1. **Key Management**: The Owner creates an asymmetric keypair (or ECDSA / Ed25519) in the local database.
  2. **Signed Permission Grants**: The Owner issues a cryptographically signed `AccountPermissionGrant` specifying:
     `{ id, workspaceId, accountIds, employeeEmail, employeeSubjectHash, role, createdAt, validUntil }`.
  3. **Operation Signing**: When an employee submits a transaction offline, the operation is signed by the employee (`authorSubjectHash`, `grantId`, `operationId`, `contentSha256`).
  4. **Data Layer Enforcement**: The local database and sync orchestrator enforce `canUserWriteAccount` and `canUserReadAccount`.
  5. **Free Relay Transport**: Sync batches are exchanged via Cloudflare Workers + KV Free Tier (100,000 free read requests/day, $0.00 recurring cost) or a lightweight authenticated relay where payloads for restricted accounts are client-side encrypted using account-specific keys derived from the Grant.
- **Cost**: $0.00 / month.
- **Security**: True least-privilege, verifiable audit logs, zero unauthorized reads.

---

## 4. Decision & Implementation Strategy
1. **Core Data & Permission Engine (Fully Implemented & Tested)**:
   - Implemented `AccountPermissionGrant` contract and storage in `LocalDatabase`.
   - Implemented `canUserReadAccount` and `canUserWriteAccount` in `LocalDatabase`.
   - Extended `SyncOperation` to include `authorSubjectHash` and `grantId` for durable attribution.
   - Verified that Viewers cannot write, Editors cannot write unauthorized accounts or delete accounts, and Owners have full authority.
   - Tested offline operation queues, idempotency, and rejection of unauthorized writes.

2. **Network Transport Protection**:
   - Until the owner explicitly chooses between Option A (Google Drive Shared Folder invitation) or Option B (Zero-cost Cloudflare KV Relay), cross-device multi-user network transport is kept behind a disabled feature flag (`VITE_ENABLE_MULTI_USER_SHARING = false`).
   - The UI provides a full Team & Sharing management interface allowing the owner to configure and audit employee accounts, permissions, and grants locally.

3. **Revocation Invariant**:
   - When an owner revokes a grant (`revokeAccountPermission`), any subsequent writes by the revoked employee are immediately rejected during local and remote synchronization.
   - As an inherent property of distributed local-first systems, revocation cannot retroactively erase data that was previously downloaded to an offline employee device before revocation. This is clearly communicated in the UI.
