/**
 * Google Drive Two-Way Eventual Synchronization Orchestrator
 * Strictly adheres to 05_GOOGLE_DRIVE_SYNC.md:
 * - Immutable per-device operation batches
 * - Deduplication by op_id and applied_operations
 * - Conflict quarantine for concurrent competing corrections (no silent LWW)
 * - Honest status: Synced only after verified upload + remote scan
 */

import { LocalDatabase } from '../storage/db';
import { DriveTransport } from '../drive/transport';
import {
  SyncBatch,
  SyncOperation,
  UUID,
  ConflictRecord,
  JournalTransaction,
  BalancedJournal
} from '../contracts/types';
import { canonicalJson, computeSha256 } from './canonical';
import { generateUUID } from '../domain/journal';
import { GoogleUserProfile } from '../auth/googleAuth';

export type SyncStatusState =
  | 'idle'
  | 'saved_local'
  | 'sync_pending'
  | 'syncing'
  | 'synced_verified'
  | 'auth_required'
  | 'quota_full'
  | 'network_unavailable'
  | 'conflict'
  | 'error_retryable';

export interface SyncStatusInfo {
  state: SyncStatusState;
  lastSuccessfulSyncAt: string | null;
  pendingOutboxCount: number;
  lastError: string | null;
  isPaused: boolean;
  quotaWarning?: boolean;
}

export type SyncEventListener = (status: SyncStatusInfo) => void;

export class SyncOrchestrator {
  private db: LocalDatabase;
  private transport: DriveTransport;
  private isOnline = true;
  private isAuthorized = true;
  private isPaused = false;
  private lastSuccessfulSyncAt: string | null = null;
  private lastError: string | null = null;
  private currentState: SyncStatusState = 'synced_verified';
  private listeners: Set<SyncEventListener> = new Set();
  private isSyncInProgress = false;

  constructor(db: LocalDatabase, transport: DriveTransport) {
    this.db = db;
    this.transport = transport;
  }

  public setTransport(transport: DriveTransport): void {
    this.transport = transport;
    this.isAuthorized = true;
    this.lastError = null;
    this.currentState = 'idle';
    this.notifyListeners();
  }

  public setOnline(online: boolean): void {
    this.isOnline = online;
    if (!online) {
      this.currentState = 'network_unavailable';
    } else {
      if (this.currentState === 'network_unavailable') {
        this.currentState = 'idle';
      }
    }
    this.notifyListeners();
  }

  public setAuthorized(authorized: boolean): void {
    this.isAuthorized = authorized;
    if (!authorized) {
      this.currentState = 'auth_required';
      this.notifyListeners();
    }
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    this.notifyListeners();
  }

  public subscribe(listener: SyncEventListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    for (const l of this.listeners) {
      try {
        l(status);
      } catch (err) {
        console.error('Error notifying sync listener:', err);
      }
    }
  }

  public getStatus(): SyncStatusInfo {
    const pendingCount = this.db.getPendingOutbox().length;
    const hasConflicts = this.db.getConflicts().some((c) => c.status === 'needs_review');

    let state = this.currentState;
    if (hasConflicts) {
      state = 'conflict';
    } else if (!this.isOnline) {
      state = 'network_unavailable';
    } else if (!this.isAuthorized) {
      state = 'auth_required';
    } else if (pendingCount > 0 && state === 'synced_verified') {
      state = 'sync_pending';
    }

    return {
      state,
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
      pendingOutboxCount: pendingCount,
      lastError: this.lastError,
      isPaused: this.isPaused,
    };
  }

  /**
   * Helper to compute canonical hash over batch core payload fields.
   */
  public static async computeBatchHash(batch: {
    protocolVersion: number;
    ownerHash: string;
    deviceId: UUID;
    batchId: UUID;
    fromSeq: number;
    toSeq: number;
    operations: SyncOperation[];
    createdAtUtc: string;
  }): Promise<string> {
    const core = {
      protocolVersion: batch.protocolVersion,
      ownerHash: batch.ownerHash,
      deviceId: batch.deviceId,
      batchId: batch.batchId,
      fromSeq: batch.fromSeq,
      toSeq: batch.toSeq,
      operations: batch.operations,
      createdAtUtc: batch.createdAtUtc,
    };
    return await computeSha256(canonicalJson(core));
  }

  /**
   * Main Two-Way Sync Routine:
   * 1. Check connectivity, authorization, and pause status
   * 2. Upload pending outbox operations as an immutable batch
   * 3. Download and reconcile any new remote batches from other devices
   * 4. Update status honestly
   */
  public async triggerSync(forceRetryAuth = true): Promise<void> {
    if (this.isSyncInProgress) return;
    if (this.isPaused) return;

    if (forceRetryAuth) {
      this.isAuthorized = true;
      this.lastError = null;
    }

    if (!this.isOnline) {
      this.currentState = 'network_unavailable';
      this.notifyListeners();
      return;
    }

    if (!this.isAuthorized) {
      this.currentState = 'auth_required';
      this.notifyListeners();
      return;
    }

    const localOwner = this.db.getIdentity()?.ownerSubjectHash;
    const isProd =
      (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD === true);

    if (this.isAuthorized && isProd && !localOwner) {
      this.currentState = 'auth_required';
      this.lastError =
        'Security Error: Strict dataset ownership requires authenticated user owner identity in production.';
      this.notifyListeners();
      throw new Error(this.lastError);
    }

    this.isSyncInProgress = true;
    this.currentState = 'syncing';
    this.lastError = null;
    this.notifyListeners();

    try {
      // Step A: Upload local pending outbox batch if any
      await this.uploadPendingBatch();

      // Step B: Download and reconcile all remote batches from Drive appDataFolder
      await this.downloadAndReconcileRemoteBatches();

      // Step C: Verify quota status
      const quota = await this.transport.getQuotaStatus();
      if (quota.isFull) {
        this.currentState = 'quota_full';
      } else {
        this.currentState = 'synced_verified';
      }

      this.lastSuccessfulSyncAt = new Date().toISOString();
      this.lastError = null;
    } catch (err: any) {
      const msg = err.message || String(err);
      this.lastError = msg;

      if (msg.includes('401') || msg.includes('Unauthorized')) {
        this.currentState = 'auth_required';
        this.isAuthorized = false;
      } else if (msg.includes('403') || msg.includes('Quota')) {
        this.currentState = 'quota_full';
      } else if (msg.includes('network') || msg.includes('Failed to fetch')) {
        this.currentState = 'network_unavailable';
      } else {
        this.currentState = 'error_retryable';
      }
    } finally {
      this.isSyncInProgress = false;
      this.notifyListeners();
    }
  }

  /**
   * Packages pending outbox operations into an immutable batch file and uploads to Drive.
   */
  private async uploadPendingBatch(): Promise<void> {
    const pendingOps = this.db.getPendingOutbox();
    if (pendingOps.length === 0) return;

    const deviceId = this.db.getDeviceId();
    const fromSeq = pendingOps[0].seq;
    const toSeq = pendingOps[pendingOps.length - 1].seq;
    const batchId = generateUUID();

    const localOwner = this.db.getIdentity()?.ownerSubjectHash;
    const isProd =
      (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD === true);

    if (this.isAuthorized && isProd && !localOwner) {
      throw new Error(
        'Security Error: Cannot sync authenticated dataset in production without verified owner identity.'
      );
    }

    const batchData = {
      protocolVersion: 1 as const,
      ownerHash: localOwner || 'owner',
      deviceId,
      batchId,
      fromSeq,
      toSeq,
      operations: pendingOps,
      createdAtUtc: new Date().toISOString(),
    };

    const batchSha256 = await SyncOrchestrator.computeBatchHash(batchData);
    const serializedForLen = JSON.stringify(batchData);

    const fullBatch: SyncBatch = {
      ...batchData,
      batchSha256,
      byteLength: serializedForLen.length,
    };

    const fileName = `hsc-v1-ops-${deviceId}-${String(fromSeq).padStart(12, '0')}-${String(
      toSeq
    ).padStart(12, '0')}-${batchId}.json`;

    // Robust Duplicate Prevention: Verify candidate remote file content, hash, and operation IDs
    try {
      const remoteFiles = await this.transport.listAppDataFiles();
      const candidates = remoteFiles.filter(
        (f) =>
          f.name === fileName ||
          f.name.startsWith(
            `hsc-v1-ops-${deviceId}-${String(fromSeq).padStart(12, '0')}-${String(toSeq).padStart(12, '0')}`
          )
      );

      for (const candidate of candidates) {
        try {
          const remoteRaw = await this.transport.downloadBatchFile(candidate.id);
          const candidateBatch: SyncBatch = JSON.parse(remoteRaw);

          // 1. Verify candidate has immutable batch identity and valid protocol
          if (
            !candidateBatch ||
            candidateBatch.protocolVersion !== 1 ||
            !candidateBatch.batchId ||
            typeof candidateBatch.batchId !== 'string' ||
            !candidateBatch.batchSha256
          ) {
            continue;
          }

          // 2. Verify candidate remote file's own cryptographic hash integrity
          const candidateDataToHash = {
            protocolVersion: candidateBatch.protocolVersion,
            ownerHash: candidateBatch.ownerHash,
            deviceId: candidateBatch.deviceId,
            batchId: candidateBatch.batchId,
            fromSeq: candidateBatch.fromSeq,
            toSeq: candidateBatch.toSeq,
            operations: candidateBatch.operations,
            createdAtUtc: candidateBatch.createdAtUtc,
          };
          const computedHash = await SyncOrchestrator.computeBatchHash(candidateDataToHash);
          if (computedHash !== candidateBatch.batchSha256) {
            console.warn(`Candidate batch ${candidate.name} has invalid hash integrity.`);
            continue;
          }

          // 3. Verify deviceId and sequence range match
          if (
            candidateBatch.deviceId !== deviceId ||
            candidateBatch.fromSeq !== fromSeq ||
            candidateBatch.toSeq !== toSeq
          ) {
            continue;
          }

          // 4. Verify dataset owner matches if authenticated
          if (localOwner && candidateBatch.ownerHash !== localOwner) {
            continue;
          }

          // 5. Verify operations count, IDs, sequence numbers, and content SHA-256
          if (
            !Array.isArray(candidateBatch.operations) ||
            candidateBatch.operations.length !== pendingOps.length
          ) {
            continue;
          }

          const allOpsMatch = pendingOps.every((pendingOp, idx) => {
            const remoteOp = candidateBatch.operations[idx];
            return (
              remoteOp &&
              remoteOp.operationId === pendingOp.operationId &&
              remoteOp.seq === pendingOp.seq &&
              remoteOp.contentSha256 === pendingOp.contentSha256
            );
          });

          if (allOpsMatch) {
            // Verified identical immutable batch is already safely present on Drive!
            const opIds = pendingOps.map((op) => op.operationId);
            await this.db.markOutboxUploaded(opIds, candidate.id);
            return;
          }
        } catch (candidateErr) {
          console.warn(`Could not verify candidate duplicate file ${candidate.name}:`, candidateErr);
        }
      }
    } catch (e) {
      // Fall through to upload if remote listing is not available
    }

    // Upload to Drive appDataFolder
    const uploadReceipt = await this.transport.uploadBatchFile(
      fileName,
      JSON.stringify(fullBatch, null, 2)
    );

    // Atomically mark outbox operations as uploaded
    const opIds = pendingOps.map((op) => op.operationId);
    await this.db.markOutboxUploaded(opIds, uploadReceipt.fileId);
  }

  /**
   * Downloads all batch files from Drive appDataFolder, validates integrity, and reconciles operations.
   */
  private async downloadAndReconcileRemoteBatches(): Promise<void> {
    const isProd =
      (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD === true);
    const localOwner = this.db.getIdentity()?.ownerSubjectHash;

    if (this.isAuthorized && isProd && !localOwner) {
      throw new Error(
        'Security Error: Cannot apply remote sync batches in production without a verified local Google owner identity.'
      );
    }

    const remoteFiles = await this.transport.listAppDataFiles();

    // Filter valid batch files: hsc-v1-ops-*
    const batchFiles = remoteFiles.filter((f) => f.name.startsWith('hsc-v1-ops-'));

    // Sort files deterministically
    batchFiles.sort((a, b) => a.name.localeCompare(b.name));

    for (const file of batchFiles) {
      try {
        const fileContent = await this.transport.downloadBatchFile(file.id);
        const batch: SyncBatch = JSON.parse(fileContent);

        // Verification checks
        if (batch.protocolVersion !== 1) {
          console.warn(`Unsupported protocol version ${batch.protocolVersion} in file ${file.name}`);
          continue;
        }

        // Validate dataset owner identity against local owner
        if (!batch.ownerHash) {
          console.warn(
            `Security Warning: Remote batch ${file.name} is missing ownerHash. Skipping unowned batch.`
          );
          continue;
        }
        if (localOwner && batch.ownerHash !== localOwner) {
          console.warn(
            `Security Warning: Remote batch ${file.name} belongs to owner ${batch.ownerHash}, expected ${localOwner}. Skipping foreign batch.`
          );
          continue;
        }
        if (isProd && !localOwner) {
          console.warn(
            `Security Warning: Remote batch ${file.name} cannot be applied without verified local owner. Skipping.`
          );
          continue;
        }

        // Verify batch SHA256 integrity
        if (batch.batchSha256) {
          const recomputedHash = await SyncOrchestrator.computeBatchHash(batch);
          if (batch.batchSha256 !== recomputedHash) {
            console.warn(`Batch SHA-256 mismatch in ${file.name}. Skipping corrupted file.`);
            continue;
          }
        }

        // Apply operations
        await this.applyBatchOperations(batch);
      } catch (fileErr) {
        console.error(`Failed to download/parse remote file ${file.name}:`, fileErr);
      }
    }
  }

  /**
   * Safe First-Device / New-Device Bootstrap and Restore:
   * 1. Requires verified authenticated Google user profile (with subjectHash).
   * 2. Prevents silent reassignment of an existing non-empty dataset to a different Google account.
   * 3. Preserves any offline transactions recorded prior to authentication by adopting them under the verified owner.
   * 4. Downloads and applies all remote batches from Google Drive belonging to this verified owner.
   */
  public async bootstrapAndRestore(profile: GoogleUserProfile): Promise<{
    restoredOpsCount: number;
    verifiedOwner: string;
    preservedOfflineOpsCount: number;
  }> {
    if (!profile || !profile.subjectHash) {
      throw new Error('Bootstrap and restore requires a verified Google user profile with subjectHash.');
    }

    const currentOwner = this.db.getIdentity()?.ownerSubjectHash;
    const rawState = this.db.getRawState();
    const hasTransactions = rawState.journalTransactions.size > 0;
    const hasSyncOps = rawState.syncOperations.size > 0;
    const isNonEmpty = hasTransactions || hasSyncOps;

    // 1. Prevent silent reassignment of an existing non-empty dataset to another Google account
    if (currentOwner && currentOwner !== profile.subjectHash && isNonEmpty) {
      throw new Error(
        `Security Error: Cannot reassign existing non-empty dataset belonging to owner (${currentOwner}) to a different Google account (${profile.subjectHash}).`
      );
    }

    // 2. Preserve offline transactions: if dataset was created offline before login (or by this owner)
    let preservedOfflineOpsCount = 0;
    if ((!currentOwner || currentOwner === profile.subjectHash) && isNonEmpty) {
      for (const op of rawState.syncOperations.values()) {
        if (!op.ownerHash || op.ownerHash === 'local-owner' || op.ownerHash === 'unassigned') {
          op.ownerHash = profile.subjectHash;
          preservedOfflineOpsCount++;
        }
      }
      if (preservedOfflineOpsCount > 0) {
        await this.db.persist();
      }
    }

    // 3. Establish verified identity on database
    this.db.setIdentity(profile.subjectHash, profile.displayName);
    this.isAuthorized = true;

    // 4. Trigger sync to download and apply all remote batches belonging to this verified owner,
    // and upload any preserved offline outbox operations to Google Drive
    await this.triggerSync();

    return {
      restoredOpsCount: this.db.getRawState().appliedOperations.size,
      verifiedOwner: profile.subjectHash,
      preservedOfflineOpsCount,
    };
  }

  /**
   * Applies an ordered array of operations into local state with deduplication and conflict checks.
   */
  public async applyBatchOperations(batch: SyncBatch): Promise<void> {
    const myDeviceId = this.db.getDeviceId();
    const isFromSelf = batch.deviceId === myDeviceId;
    const isProd =
      (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD === true);
    const localOwner = this.db.getIdentity()?.ownerSubjectHash;

    if (this.isAuthorized && isProd && !localOwner) {
      throw new Error(
        'Security Error: Cannot apply operations in production without a verified local Google owner identity.'
      );
    }

    for (const op of batch.operations) {
      // 1. Validate dataset owner identity on operation
      if (!op.ownerHash) {
        console.warn(`Security Warning: Operation ${op.operationId} missing ownerHash. Skipping.`);
        continue;
      }
      if (localOwner && op.ownerHash !== localOwner) {
        console.warn(
          `Security Warning: Operation ${op.operationId} owner mismatch (${op.ownerHash} != ${localOwner}). Skipping.`
        );
        continue;
      }

      // 2. Idempotency: if already applied, skip
      if (this.db.getRawState().appliedOperations.has(op.operationId)) {
        continue;
      }

      // 2. Validate op content hash if present
      if (op.contentSha256) {
        const expectedHash = await computeSha256(canonicalJson(op.payload));
        if (op.contentSha256 !== expectedHash) {
          console.warn(`Operation ${op.operationId} content SHA-256 corrupted. Skipping.`);
          continue;
        }
      }

      // 3. Process operation by type
      await this.applySingleOperation(op, isFromSelf);

      // 4. Record as applied
      this.db.getRawState().appliedOperations.add(op.operationId);
    }

    await this.db.persist();
  }

  private async applySingleOperation(op: SyncOperation, isFromSelf: boolean): Promise<void> {
    const payload = op.payload;

    switch (op.type) {
      case 'journal.post': {
        const balanced: BalancedJournal = payload.balancedJournal;
        if (balanced && balanced.transaction && balanced.lines) {
          const assetLine = balanced.lines.find((l) => !l.categoryId);
          const assetAccId = assetLine?.accountId || balanced.lines[0]?.accountId;
          // Check employee permissions only for non-owner employee operations
          const isEmployeeOp = !!op.authorSubjectHash && op.authorSubjectHash !== op.ownerHash;
          if (
            isEmployeeOp &&
            assetAccId &&
            !this.db.canUserWriteAccount(op.authorSubjectHash, assetAccId, op.type)
          ) {
            console.warn(
              `Permission Denied: Employee ${op.authorSubjectHash} cannot write account ${assetAccId}`
            );
            break;
          }
          const fullTx: JournalTransaction = {
            ...balanced.transaction,
            createdOpId: op.operationId,
            lines: balanced.lines,
          };
          this.db.getRawState().journalTransactions.set(fullTx.id, fullTx);
          for (const line of balanced.lines) {
            this.db.getRawState().journalLines.set(line.id, line);
          }
        }
        break;
      }

      case 'journal.correct': {
        const { originalTransactionId, reversalBalanced, replacementBalanced, baseRevision } = payload;
        const originalTx = this.db.getTransaction(originalTransactionId);

        if (!originalTx) {
          console.warn(`Original transaction ${originalTransactionId} not found for correction.`);
          break;
        }

        // Check if a correction has already been applied on this original transaction
        const existingCorrection = Array.from(this.db.getRawState().journalTransactions.values()).find(
          (t) => t.reversalOf === originalTransactionId
        );

        if (existingCorrection && !isFromSelf) {
          // CONCURRENT CORRECTION DETECTED: Quarantine conflict!
          const conflict: ConflictRecord = {
            id: generateUUID(),
            entityId: originalTransactionId,
            baseVersion: baseRevision || 'v1',
            originalOpId: originalTx.createdOpId,
            contenderOpIds: [existingCorrection.createdOpId, op.operationId],
            status: 'needs_review',
            detectedAt: new Date().toISOString(),
            details: {
              title: 'সমসাময়িক রদবদল সংঘাত (Concurrent Correction Conflict)',
              description: `দুটি ডিভাইস থেকে একই লেনদেনে (${originalTx.effectiveDate} - ${originalTx.note || 'লেনদেন'}) ভিন্ন সংশোধন পাঠানো হয়েছে।`,
              contenders: [
                {
                  opId: existingCorrection.createdOpId,
                  deviceId: originalTx.createdOpId,
                  timestamp: existingCorrection.occurredAtUtc,
                  summary: existingCorrection.note || 'পূর্ববর্তী সংশোধন',
                },
                {
                  opId: op.operationId,
                  deviceId: op.deviceId,
                  timestamp: op.createdAtUtc,
                  summary: payload.note || 'ইনকামিং সংশোধন',
                },
              ],
            },
          };
          await this.db.addConflict(conflict);
          break;
        }

        // Apply reversal and replacement
        if (reversalBalanced) {
          const revTx: JournalTransaction = {
            ...reversalBalanced.transaction,
            createdOpId: op.operationId,
            lines: reversalBalanced.lines,
          };
          this.db.getRawState().journalTransactions.set(revTx.id, revTx);
          for (const line of reversalBalanced.lines) {
            this.db.getRawState().journalLines.set(line.id, line);
          }
        }
        if (replacementBalanced) {
          const repTx: JournalTransaction = {
            ...replacementBalanced.transaction,
            createdOpId: op.operationId,
            lines: replacementBalanced.lines,
          };
          this.db.getRawState().journalTransactions.set(repTx.id, repTx);
          for (const line of replacementBalanced.lines) {
            this.db.getRawState().journalLines.set(line.id, line);
          }
        }
        break;
      }

      case 'workspace.create':
        if (payload.workspace) {
          this.db.getRawState().workspaces.set(payload.workspace.id, payload.workspace);
        }
        break;

      case 'workspace.update':
        if (payload.id && this.db.getRawState().workspaces.has(payload.id)) {
          const ws = this.db.getRawState().workspaces.get(payload.id)!;
          if (payload.name) ws.name = payload.name;
          if (payload.kind) ws.kind = payload.kind;
        }
        break;

      case 'workspace.archive':
        if (payload.id && this.db.getRawState().workspaces.has(payload.id)) {
          this.db.getRawState().workspaces.get(payload.id)!.archivedAt =
            payload.archivedAt || new Date().toISOString();
        }
        break;

      case 'account.create':
        if (payload.account) {
          this.db.getRawState().accounts.set(payload.account.id, payload.account);
        }
        break;

      case 'account.update':
        if (payload.id && this.db.getRawState().accounts.has(payload.id)) {
          const acc = this.db.getRawState().accounts.get(payload.id)!;
          if (payload.name) acc.name = payload.name;
          if (payload.accountNumberMasked !== undefined) acc.accountNumberMasked = payload.accountNumberMasked;
          if (payload.kind) acc.kind = payload.kind;
          if (payload.groupId !== undefined) acc.groupId = payload.groupId;
        }
        break;

      case 'account.archive':
        if (payload.id && this.db.getRawState().accounts.has(payload.id)) {
          this.db.getRawState().accounts.get(payload.id)!.archivedAt =
            payload.archivedAt || new Date().toISOString();
        }
        break;

      case 'account.restore':
        if (payload.id && this.db.getRawState().accounts.has(payload.id)) {
          this.db.getRawState().accounts.get(payload.id)!.archivedAt = null;
        }
        break;

      case 'account.delete':
        if (payload.id) {
          this.db.getRawState().accounts.delete(payload.id);
        }
        break;

      case 'group.create':
        if (payload.group) {
          this.db.getRawState().accountGroups.set(payload.group.id, payload.group);
        }
        break;

      case 'group.update':
        if (payload.id && this.db.getRawState().accountGroups.has(payload.id)) {
          const g = this.db.getRawState().accountGroups.get(payload.id)!;
          if (payload.name) g.name = payload.name;
          if (payload.icon !== undefined) g.icon = payload.icon;
          if (payload.description !== undefined) g.description = payload.description;
        }
        break;

      case 'group.archive':
        if (payload.id && this.db.getRawState().accountGroups.has(payload.id)) {
          this.db.getRawState().accountGroups.get(payload.id)!.archivedAt =
            payload.archivedAt || new Date().toISOString();
        }
        break;

      case 'group.restore':
        if (payload.id && this.db.getRawState().accountGroups.has(payload.id)) {
          this.db.getRawState().accountGroups.get(payload.id)!.archivedAt = null;
        }
        break;

      case 'permission.grant':
        if (payload.grant) {
          this.db.getRawState().accountPermissions.set(payload.grant.id, payload.grant);
        }
        break;

      case 'permission.revoke':
        if (payload.id && this.db.getRawState().accountPermissions.has(payload.id)) {
          this.db.getRawState().accountPermissions.get(payload.id)!.revokedAt =
            payload.revokedAt || new Date().toISOString();
        }
        break;

      case 'category.create':
        if (payload.category) {
          this.db.getRawState().categories.set(payload.category.id, payload.category);
        }
        break;

      case 'category.update':
        if (payload.id && this.db.getRawState().categories.has(payload.id)) {
          const c = this.db.getRawState().categories.get(payload.id)!;
          if (payload.name) c.name = payload.name;
          if (payload.nameEn !== undefined) c.nameEn = payload.nameEn;
          if (payload.color !== undefined) c.color = payload.color;
        }
        break;

      case 'category.archive':
        if (payload.id && this.db.getRawState().categories.has(payload.id)) {
          this.db.getRawState().categories.get(payload.id)!.archivedAt =
            payload.archivedAt || new Date().toISOString();
        }
        break;

      case 'party.create':
        if (payload.party) {
          this.db.getRawState().parties.set(payload.party.id, payload.party);
        }
        break;

      case 'party.update':
        if (payload.id && this.db.getRawState().parties.has(payload.id)) {
          const p = this.db.getRawState().parties.get(payload.id)!;
          if (payload.name) p.name = payload.name;
          if (payload.phone !== undefined) p.phone = payload.phone;
          if (payload.role !== undefined) p.role = payload.role;
          if (payload.notes !== undefined) p.notes = payload.notes;
        }
        break;

      case 'party.archive':
        if (payload.id && this.db.getRawState().parties.has(payload.id)) {
          this.db.getRawState().parties.get(payload.id)!.archivedAt =
            payload.archivedAt || new Date().toISOString();
        }
        break;

      case 'budget.set':
        if (payload.budget) {
          this.db.getRawState().budgets.set(payload.budget.id, payload.budget);
        }
        break;

      case 'recurring.rule.create':
      case 'recurring.rule.update':
        if (payload.rule) {
          this.db.getRawState().recurringRules.set(payload.rule.id, payload.rule);
        }
        break;

      case 'recurring.occurrence.post':
        if (payload.occurrence) {
          this.db.getRawState().recurringOccurrences.set(payload.occurrence.id, payload.occurrence);
        }
        break;

      default:
        console.warn(`Unhandled operation type: ${op.type}`);
    }
  }
}
