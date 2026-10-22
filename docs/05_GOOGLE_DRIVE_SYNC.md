# 05 — GOOGLE DRIVE AUTOMATIC TWO-WAY SYNC PROTOCOL
**Status:** Mandatory implementation specification, unproven until real-device tests. **Drive is file storage, NOT a transactional realtime database.**

## 1. Required experience
- Customer taps **Continue with Google**, grants app-specific Drive access when prompted; **NO customer API key, NO recovery key, NO cloud-developer account setup**.
- All local financial actions save to SQLite immediately, including when offline.
- On connectivity/valid authorization and permitted execution, app automatically uploads pending changes and downloads others; two devices **eventually converge** after sync. Manual 'Retry' is visible.
- Same product later supports Web through a separate Google Web OAuth client under the same intended Google app/Cloud project after cross-client compatibility proof.
- When sync is blocked, make condition honest and actionable; never delete, rewrite, hide or mark unsynced rows as synced.

## 2. Google account and permissions
- Use Android current-supported Google identity APIs and native authorization for Google Drive. Verify ID token subject correctly before pairing; never use email text as identity key alone.
- Google Drive OAuth scope: prefer `https://www.googleapis.com/auth/drive.appdata`. Files are in the customer's Drive **hidden application data storage**. The file area cannot be browsed in Drive UI and may be deleted if the user removes the app's stored data. This is acceptable for internal sync; user-facing export is separate.
- Do not use blanket `drive` scope. Consider `drive.file` only if file visibility/export requirements genuinely justify it; document differences and consent.
- The **developer** enables Drive API and configures Android OAuth clients, signing fingerprints, and later browser origin. Public client ID is not a password; never embed client secrets or service-account private keys in distributed app.
- Android account sign-in and Drive authorization are related but not identical operations; do not claim one silently confers the other. Test first consent, denial, account switch, revoked scope, expired token.

## 3. Storage format — immutable device-specific operation batches
Prefer a **flat file list** in appDataFolder; one immutable batch per device & sequence range, with unique generated name. Avoid race-prone single mutable "latest.json" as the source of truth.

Example remote object names (not user-visible):
```text
hsc-v1-ops-<device_uuid>-000000000001-000000000020-<batch_uuid>.json
hsc-v1-ops-<device_uuid>-000000000021-000000000035-<batch_uuid>.json
hsc-v1-checkpoint-<checkpoint_uuid>.json
hsc-v1-meta-<device_uuid>-<nonce>.json
```
**Important:** Google Drive file names need not be unique. A retry may create two files with the same name. Deduplication MUST use **operation UUIDs** and stored remote file IDs, never filename alone.

Proposed operation envelope (documentation-only sample, `owner_hash` placeholder, no real identity):
```json
{
  "protocolVersion": 1,
  "ownerHash": "sha256-of-stable-google-sub-and-app-context",
  "deviceId": "device-uuid",
  "seq": 35,
  "operationId": "uuid-v4",
  "entityId": "journal-uuid",
  "type": "journal.post",
  "baseRevision": null,
  "createdAtUtc": "2026-10-22T04:00:00Z",
  "payload": {
    "workspaceId": "workspace-uuid",
    "transactionId": "journal-uuid",
    "amountMinor": "35000",
    "currency": "BDT"
  },
  "contentSha256": "computed-over-canonicalized-unsigned-envelope"
}
```
A real `journal.post` operation contains a complete balanced **journal**, not merely amount. Use deterministic canonical JSON (RFC 8785-style canonicalization if selected and pinned), schema validator, immutable UUIDs, bounds, content hashes and explicit format versions. `contentSha256` is a **corruption check**, not a signature against a maliciously compromised Google account.

Batch envelope includes `protocolVersion`, owner hash, deviceId, `fromSeq`/`toSeq`, ordered array of operations, canonical-content SHA-256, byte length and creation time. Max batch bytes and rate are tunable after load tests; batch files may hold 10–100 operations initially but do not treat as fixed SLA.

## 4. Upload algorithm (crash-tolerant)
```text
SyncOnce(device):
  if not authenticated/authorized/online: update status and exit, keep outbox
  acquire local durable lock; release in finally
  recover last incomplete upload / scan remote if receipt unknown
  read unsent outbox operations in device sequence order
  create immutable batch bytes and hash locally
  upload file using resumable/simple API depending on tested payload size
  verify returned Drive file ID, metadata, content or checksum
  mark included op IDs as uploaded in local transaction
  fetch all missing remote batches/checkpoints and validate/replay
  persist cursor/head and status ONLY after verified application
```
- If upload success response is lost, retry may make duplicate remote file; **do not duplicate ledger entries** because importer dedupes by `op_id`.
- Never clear outbox before a verified remote upload receipt. Failed Drive write must not roll back committed local income/expense.
- Respect `401` (refresh/reconsent), `403` (scope/quota), `429` (rate-limit) and `5xx` (retry with capped exponential backoff+jitter). Honor retry hints; never busy-loop.
- Storage quota full: maintain pending outbox, show explicit warning + local export, retry when quota resolved.

## 5. Download/reconciliation algorithm
```text
  remote = list appDataFolder files with pagination / change feed
  for every matching file not already processed:
    verify allowable name, protocolVersion, accountHash, max bytes
    download, verify batch hash and per-op schema/amount/UUID
    stage incoming file metadata and ops locally
  sort/apply operations respecting each device's increasing contiguous seq
  in ONE transaction per application unit:
    reject duplicate op_id; do not overwrite original posted journal
    apply valid referenced prior operations or hold dependent ops
    if concurrent incompatible corrections: quarantine conflict
    insert into applied_operations, advance contiguous device head
  update cursor only once relevant operations durably applied or safely staged
  display balances recalculated from accepted journal
```
- Do not assume `createdAtUtc` provides causal order. Offline device clocks can differ, so preserve `deviceId+seq`, `baseRevision`, dependencies and operation UUIDs. Prefer deterministic application of independent operations, and explicit review for incompatible same-object edits.
- If user deleted Drive files or Drive `changes` cursor becomes unusable, perform full appDataFolder inventory/recovery. Never infer no data from a single unsuccessful list request.
- For first device restore: snapshot/checkpoint + operation log is staged in temp local DB and verified before user sees 'Restore complete'.
- Don't pretend a conflicted correction has posted; surface review actions: original stays posted, preserve both proposed corrections, choose one or create a compensating resolution op.

## 6. Concurrency and conflict policy
| Situation | Expected result |
|---|---|
| Devices A,B each add independent expense while offline | Both operations merge exactly once |
| Upload response times out but Drive created file | Retry may create duplicate remote file; apply only once |
| Device A renames category while B records expense with old name | Stable category ID; no loss; later display name may change |
| A and B edit same unposted metadata concurrently | Hold both revisions, explicit conflict policy (do not silently override) |
| A and B correct same posted transaction based on old revision | Preserve both correction proposals; require manual conflict resolution |
| One device restores outdated snapshot while other has new op | Replay all missing ops, don't replace newer state with old snapshot |
| User revokes Drive permission | All committed local finance data remains; sync status 'Authorization required' |
| Drive file missing/corrupt | Quarantine; don't trust partial rebuild or silently clear account |

## 7. Checkpoints and backup
- V1 **retain all immutable op files**, preferably batches rather than per-event files. Do not prematurely garbage-collect: an offline device can reconnect weeks later.
- Periodic **complete, verified** checkpoint reduces restore time; include account hash, schema/protocol versions, per-device **contiguous** applied sequence head vector, journal integrity totals, payload hashes, created date.
- Create checkpoint from verified reconciled local state, upload as immutable object, then download/verify enough to assert readable.
- A checkpoint alone is **not** proof there are no later or unobserved remote ops. Restore scans all device logs and replays above checkpoint head vector; never discard missing operations.
- Compaction/garbage collection of remote logs is **disabled V1** pending a formal safe-retention algorithm and all-device acknowledgment story.
- Local backups before migration are SQLite-consistent snapshots (include WAL safely), distinct from cloud checkpoints.

## 7A. Recurring records, budgets and receipt blobs
- Include versioned op types `budget.create/update/archive`, `recurring.rule.create/update/disable`, `recurring.occurrence.post`, and `receipt.attach/unlink` in the immutable protocol. Each mutation needs stable entity UUID/baseRevision for conflict detection.
- Offline devices may independently schedule a recurring occurrence. `occurrenceId` must be deterministic from rule ID, generation and due date; on merge, allow only one posted occurrence, park conflicting duplicates for resolution. **Operation ID uniqueness alone is insufficient** when two devices create independent operation IDs for the same due occurrence.
- Upload each receipt as a content-addressed, immutable Drive blob (`hsc-v1-blob-<sha256>-<nonce>`). Validate MIME, size, digest, Google quota; attach journal metadata with blob hash and pending availability. Never block saving the financial record when an optional image upload fails. Avoid unbounded blob replication.
- Snapshots include budgets/recurring rules and receipt metadata but not assume every attachment blob downloaded.

## 8. Trigger policy & truthful timing
- Trigger: app foreground/open, after local mutation debounced/batched, connectivity regained, periodic native worker if OS permits, manual Retry.
- Android constrained background task **best-effort**, never promise exact seconds to sync or run indefinitely while battery saver/permission issue.
- Web later: foreground active tab sync on app open, network return, bounded interval or manual. No assumed web background writes while browser closed; token prompts may be necessary.
- `Synced` means all known local outbox ops are verified uploaded **and** remote inventory/changes have been applied through last verified scan, with timestamp. New remote ops may arrive immediately afterward; app is never globally instantaneous.

## 9. Early integration gates — MUST be real
**G1:** Same Google owner creates record on Android A, Android B receives after Drive OAuth; reverse direction tested.  
**G2:** Two offline devices simultaneously mutate and merge without loss/duplication.  
**G3:** Kill process before/after local commit, upload, receipt write, download and apply; recover.  
**G4:** Revoked OAuth, 401, 403 storage quota, 429, 5xx, corrupted bytes, deleted remote file.  
**G5:** Restored new device reports exactly expected journal entries and account balances.  
**G6:** Works across Android release version updates, including pending outbox.  
**G7:** Cross-client Android ↔ Web Drive appDataFolder access confirmed **before Web implementation**.

## 10. Non-goals and unavoidable limits
No Google-only cloud E2EE secret without another key-recovery design; V1 cloud protection uses Google-controlled at-rest encryption, Drive-scoped authorization and TLS. No realtime push without a server; no multi-user concurrent shared Drive dataset. API quotas and Drive deletion/storage/full or missing unsynced data can still prevent recovery; explain these limits honestly.

**Official references:**
- https://developers.google.com/workspace/drive/api/guides/appdata
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/manage-changes
- https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list
- https://developers.google.com/workspace/drive/api/guides/handle-errors
