# 06 — SECURITY, PRIVACY, ACCESS & ACCOUNT RECOVERY (V1)

## 1. Security promise and limitations
Design for high protection and explain failures candidly. **Do not claim 100% safety, zero-knowledge or E2EE in V1.** No Recovery Key in V1 and no proprietary auth server imply there is no customer-secret-based cloud key escrow/recovery mechanism. Google secures customer Drive account and data at rest; all network transfers use TLS. If a Google account or device is compromised, privacy is at risk.

## 2. Google Identity & Drive consent
- Customer entry point is **Continue with Google**, first-run Internet required.
- OAuth clients (Android/Web) are created **by developer** in one Google Cloud project; Drive API enabled and authorized consent configured once. Customers configure nothing technical.
- Login identity (`openid`, profile) and Drive access (`drive.appdata`) may be distinct consent actions. The Google UI handles them; make customer-facing explanation clear.
- Bind dataset to a stable Google subject tied to the **authorized Drive token/account** (hash subject for local identification). A matching email alone does not suffice. Because V1 has no independent authentication server, verify identity using currently supported Google-issued SDK credentials and, where supported, check the account subject linked to the same authorized OAuth token. Do **not** pretend local JWT decoding alone is cryptographic verification or equivalent to a server-enforced identity boundary.
- Use Android recommended Google Credential Manager / Google Identity authorization as supported, secure access-token lifecycle and no embedded client secret. Validate tokens appropriately; do not trust unsigned decoded JWT text.
- On account switch/log out: handle unsynced outbox warning, lock/unmount previous dataset and clear tokens; do **not** delete local finance automatically.
- On account revoked: local data remains with guarded owner binding, show pending sync and authorization required.

## 3. Device storage and app lock
- SQLite files in Android **private app sandbox**, not user-shared documents folder; disable accidental plaintext external backups if sync is authoritative (review Android backup manifest/data extraction rules).
- Use a vetted SQLite encryption option only after verifying actual native support with tested key persistence via Android Keystore; do not describe database as SQLCipher-encrypted until demonstrated. At minimum use OS file-at-rest encryption, private app area, optional PIN/biometric app lock.
- Store OAuth tokens only in appropriate platform secure stores (Keystore/OS token store). Do not persist refresh tokens or access tokens into React LocalStorage/IndexedDB/plain logs.
- Disable screenshots on sensitive screens only if product owner chooses; accessibility and Android recents behavior must be tested.
- Never put precise finance details, access tokens or personal info in crash reports, analytics, URLs or debug telemetry.
- Sanitize amount/note/category inputs; limit size, restrict supported types; validate SQLite parameter binding.

## 4. Cloud Drive scope and operations
- Use Google Drive `appDataFolder` under least-privilege `drive.appdata` permission. It is customer-owned app storage, **not visible in the user's normal Drive UI**. Explain clearly.
- Warn on quota exhaustion, consent removal or Drive application-data deletion. Provide clear local CSV/JSON export and a safe backup option where feasible, independent of being able to browse appDataFolder.
- No broad Drive permission, no public sharing of sync files, no uploading records to your own servers, no service account owning customer finance.
- Download operations only after identity, size, schema, type, referential and hash verification. Hashes detect accidental corruption; **not all malicious account takeover**.
- All cloud edits are attributed to owner account, not to a trustworthy independent staff identity; hence **no team finance/approval** in V1.

## 5. Confidentiality threat matrix
| Threat | Proposed controls | Remaining risk |
|---|---|---|
| Phone stolen but locked | OS lock, private storage, optional in-app PIN/biometric | rooted/unlocked device, insecure owner passcode |
| Google account compromised | Google account security, scoped appData access, no public shares | attacker may access/remove cloud data; no V1 E2EE |
| Device loses Internet | durable local SQLite/outbox; sync status | unsynced records cannot be restored on a lost phone |
| Drive quota/storage full | retain local queue, alert and retry | cloud history stops updating |
| Two-device simultaneous edits | immutable ops, causal base rev, conflict review | conflicts may require manual user action |
| Damaged local database | consistent pre-migration recovery snapshot, verified cloud checkpoint | latest unsynced data may not be available after physical loss |
| Malicious altered cloud file | strict parsing, size, schema and checksum checks | adversary able to replace both data and checksum may evade hash check |
| Web browser data cleared | user Drive sync and restoration | any changes not yet synced may be lost |
| Token leakage | short-lived tokens, secure platform storage, zero tokens in logs | compromised browser/device runtime |

## 6. Financial integrity & audit
- Post journal and outbox transactionally; no float money math; all amounts are signed-decimal strings on TS/JSON transport.
- Posted history immutable; corrections append reversal/replacement; prevent overlap conflicts; never silently resolve by timestamp.
- Per-device UUID and monotonically increasing counter; no uncontrolled aggregate mutable file.
- No admin impersonation, hidden master password, analytics harvesting or broad backend account inspection.

## 7. Privacy policy and Play data safety
Prepare clear Bengali/English policy covering: what identity fields are used, which financial data is stored locally and in user's Drive, appDataFolder visibility, cookies/tokens, retention/recovery behavior, Google scope, account deletion consequences, and support contact. Verify Google API Services User Data Policy and Google Play Data Safety declaration against **actual implementation**. If no remote telemetry, don't claim analytics collection.

## 8. Account deletion and logout UX
- `Sign out` means remove active authorization and lock accessible data, **not silently delete records**.
- `Remove local data from this device` is a **separate destructive operation** that needs explicit confirmation and warnings about unsynced records; refuse until user acknowledges risk.
- `Delete cloud data` needs separately verified authorization, explicit destructive consent, clear irreversible scope, and no unexpected deletion from other devices. V1 may defer fully automated account deletion pending safe multi-device protocol; document manual export/support path and store policy review.

## 9. V1 no-recovery-key trade-off
Customer explicitly does not want recovery key during onboarding. Therefore **do not derive cloud encryption key from account email, OAuth token, or a hard-coded string** and pretend this is private E2EE. Prefer supported provider-managed Drive encryption at rest + TLS + private local files. In future release, optional recovery-key or account-independent key management may be designed **before** claiming stronger cloud privacy. Older V1 backup formats must remain importable during that migration.
