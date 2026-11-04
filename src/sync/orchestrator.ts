/**
 * Google Drive Two-Way Eventual Synchronization Orchestrator
 * Strictly adheres to 05_GOOGLE_DRIVE_SYNC.md:
 * - Immutable per-device operation batches
 * - Deduplication by op_id and applied_operations
 * - Conflict quarantine for concurrent competing corrections (no silent LWW)
 * - Honest status: Synced only after verified upload + remote scan
 */

import { LocalDatabase } from '../storage/db';
import { isSavingsOperation, validateSavingsOperations } from '../storage/savingsOperations';
import { validateReportOperations } from '../storage/reportMetadata';
import { isLoanOperation, readSavingsLoans } from '../storage/loanBook';
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
import { GoogleUserProfile, computeOwnerSubjectHash } from '../auth/googleAuth';
import { workspaceMedia } from '../storage/workspaceMedia';
import { migrateLegacyWorkspaceImages } from '../storage/workspaceMediaMigration';
import { mergeWorkspaceImage, validateWorkspaceImage } from '../storage/workspaceImages';
import { validateReceiptBlob } from '../storage/receipts';
import { ensureCloudBackup, getCloudBackupReceipt, verifyCloudBackup } from './cloudBackup';
import { buildReversalJournal } from '../domain/journal';
import { requireDependencies, SyncDependencyError, validateIncomingJournal } from './validation';

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
  lastCloudBackupAt?: string | null;
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
  private currentState: SyncStatusState = 'idle';
  private listeners: Set<SyncEventListener> = new Set();
  private isSyncInProgress = false;
  private bootstrapInProgress = false;
  private needsBootstrapMetadata = false;

  constructor(db: LocalDatabase, transport: DriveTransport, private options: { cloudBackups?: boolean } = {}) {
    this.db = db;
    this.transport = transport;
  }

  public isBusy(): boolean { return this.isSyncInProgress || this.bootstrapInProgress; }

  public async downloadCloudBackup(): Promise<string> {
    const receipt = getCloudBackupReceipt(this.db);
    if (!receipt) throw new Error('No verified Drive backup is available yet.');
    const text = await this.transport.downloadBatchFile(receipt.fileId);
    await verifyCloudBackup(text, receipt.ownerHash, receipt.fingerprint);
    return text;
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
    const receipt = this.db.getRawState().preferences.get('last-verified-sync-v1');
    const historicalSyncAt = receipt?.ownerHash === this.db.getIdentity()?.ownerSubjectHash &&
      typeof receipt?.at === 'string' && Number.isFinite(Date.parse(receipt.at)) ? receipt.at : null;

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
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt || historicalSyncAt,
      pendingOutboxCount: pendingCount,
      lastError: this.lastError,
      isPaused: this.isPaused,
      lastCloudBackupAt: getCloudBackupReceipt(this.db)?.verifiedAt || null,
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
    if (this.isSyncInProgress || this.bootstrapInProgress) return;
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
      await this.db.waitForPendingWrites();
      if (this.needsBootstrapMetadata || this.db.getRawState().preferences.has('sync-bootstrap-owner-v1') ||
          (this.options.cloudBackups && this.db.getRawState().preferences.get('sync-metadata-version-v1') !== 1)) {
        // A fresh device must read existing definitions before publishing its starter rows.
        await this.downloadAndReconcileRemoteBatches();
        await this.queueMissingMetadata();
        this.needsBootstrapMetadata = false;
      }
      // Step A: Upload local pending outbox batch if any
      await this.uploadPendingBatch();

      // Step B: Download and reconcile all remote batches from Drive appDataFolder
      await this.downloadAndReconcileRemoteBatches();

      // Step C: Verify quota status
      const quota = await this.transport.getQuotaStatus();
      if (quota.isFull) {
        this.currentState = 'quota_full';
      } else {
        if (this.options.cloudBackups && this.db.getPendingOutbox().length === 0) await ensureCloudBackup(this.db, this.transport);
        await this.recordSuccessfulSync();
        this.currentState = 'synced_verified';
      }

      this.lastError = null;
    } catch (err: any) {
      const msg = err.message || String(err);
      this.lastError = msg;

      if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('AUTH_REQUIRED') || msg.includes('not signed in')) {
        this.currentState = 'auth_required';
        this.isAuthorized = false;
      } else if (msg.includes('403') && msg.includes('Forbidden')) {
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

  private async recordSuccessfulSync(): Promise<void> {
    const at = new Date().toISOString(), ownerHash = this.db.getIdentity()?.ownerSubjectHash;
    const preferences = this.db.getRawState().preferences;
    const previous = preferences.get('last-verified-sync-v1');
    // Keep a historical receipt across reloads without rewriting an idle ledger every poll.
    if (ownerHash && (previous?.ownerHash !== ownerHash || !Number.isFinite(Date.parse(previous?.at)) || Date.now() - Date.parse(previous.at) >= 60_000)) {
      preferences.set('last-verified-sync-v1', { ownerHash, at });
      try { await this.db.persist(); }
      catch (error) {
        if (previous) preferences.set('last-verified-sync-v1', previous); else preferences.delete('last-verified-sync-v1');
        throw error;
      }
    }
    this.lastSuccessfulSyncAt = at;
  }

  /**
   * Packages pending outbox operations into an immutable batch file and uploads to Drive.
   */
  private async uploadPendingBatch(): Promise<void> {
    const pending = this.db.getPendingOutbox();
    for (const deviceId of new Set(pending.map(op => op.deviceId))) {
      const operations = pending.filter(op => op.deviceId === deviceId);
      let group: SyncOperation[] = [], bytes = 0;
      for (const op of operations) {
        const size = new TextEncoder().encode(JSON.stringify(op)).length;
        if (size > 7 * 1024 * 1024) throw new Error('A synchronization record is too large. Export a file backup for recovery.');
        if (group.length >= 100 || bytes + size > 7 * 1024 * 1024) { await this.uploadDeviceBatch(group); group = []; bytes = 0; }
        group.push(op); bytes += size;
      }
      if (group.length) await this.uploadDeviceBatch(group);
    }
  }

  private async uploadDeviceBatch(sourceOps: SyncOperation[]): Promise<void> {
    // A restored file can contain pending operations from another device.
    // Keep each immutable operation's original device and sequence identity.
    const pendingOps: SyncOperation[] = [];
    for (const op of sourceOps) {
      const hash = await computeSha256(canonicalJson(op.payload));
      if (op.contentSha256 && op.contentSha256 !== hash) throw new Error('Local operation checksum mismatch. Export a file backup before requesting recovery support.');
      pendingOps.push({ ...op, contentSha256: hash });
    }

    const deviceId = pendingOps[0].deviceId;
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
      byteLength: new TextEncoder().encode(serializedForLen).length,
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
      JSON.stringify(fullBatch)
    );

    if (!uploadReceipt.fileId) throw new Error('Drive upload returned no file identity.');
    const stored = JSON.parse(await this.transport.downloadBatchFile(uploadReceipt.fileId));
    if (canonicalJson(stored) !== canonicalJson(fullBatch) ||
        await SyncOrchestrator.computeBatchHash(stored) !== fullBatch.batchSha256) {
      throw new Error('Drive upload read-back verification failed. Pending changes are retained.');
    }

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

    let failedFiles = 0;
    const waiting: SyncBatch[] = [];
    const versions = this.db.getRawState().preferences.get('verified-drive-file-versions-v1') || {};
    let versionsChanged = false;
    for (const file of batchFiles) {
      try {
        if (file.version && versions[file.id] === `${localOwner}:${file.version}`) continue;
        if (Number(file.size || 0) > 8 * 1024 * 1024) throw new Error('Synchronization batch is too large.');
        const fileContent = await this.transport.downloadBatchFile(file.id);
        if (new TextEncoder().encode(fileContent).length > 8 * 1024 * 1024) throw new Error('Synchronization batch is too large.');
        const batch: SyncBatch = JSON.parse(fileContent);

        // Verification checks
        if (batch.protocolVersion !== 1) {
          throw new Error('Unsupported synchronization protocol. Update this app before syncing.');
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
            throw new Error('Remote batch integrity verification failed.');
          }
        }

        if (!batch.batchSha256) throw new Error('Remote batch checksum is missing.');
        if (!Array.isArray(batch.operations) || !batch.operations.length || batch.operations.length > 10_000 ||
            batch.operations.some(op => op.deviceId !== batch.deviceId)) throw new Error('Invalid remote batch operations.');
        try {
          await this.applyBatchOperations(batch);
          if (file.version) { versions[file.id] = `${localOwner}:${file.version}`; versionsChanged = true; }
        } catch (error) { if (error instanceof SyncDependencyError) waiting.push(batch); else throw error; }
      } catch (fileErr) {
        failedFiles++;
        console.error(`Failed to download/parse remote file ${file.name}:`, fileErr);
      }
    }
    while (waiting.length) {
      let progress = false;
      for (let i = waiting.length - 1; i >= 0; i--) {
        try { await this.applyBatchOperations(waiting[i]); waiting.splice(i, 1); progress = true; }
        catch (error) { if (!(error instanceof SyncDependencyError)) { waiting.splice(i, 1); failedFiles++; } }
      }
      if (!progress) break;
    }
    failedFiles += waiting.length;
    if (versionsChanged) {
      this.db.getRawState().preferences.set('verified-drive-file-versions-v1', versions);
      await this.db.persist();
    }
    if (failedFiles) throw new Error('Remote synchronization verification is incomplete. Retry without clearing local records.');
  }

  /**
   * Safe First-Device / New-Device Bootstrap and Restore:
   * 1. Requires verified authenticated Google user profile (with subjectHash).
   * 2. Prevents silent reassignment of an existing non-empty dataset to a different Google account.
   * 3. Preserves any offline transactions recorded prior to authentication by adopting them under the verified owner.
   * 4. Downloads and applies all remote batches from Google Drive belonging to this verified owner.
   */
  public async bootstrapAndRestore(profile: GoogleUserProfile, consentToBindOffline = false): Promise<{
    restoredOpsCount: number;
    verifiedOwner: string;
    preservedOfflineOpsCount: number;
  }> {
    if (this.bootstrapInProgress || this.isSyncInProgress) throw new Error('Synchronization is busy. Try connecting again when it finishes.');
    this.bootstrapInProgress = true;
    try { return await this.bootstrapIdentity(profile, consentToBindOffline); }
    finally { this.bootstrapInProgress = false; }
  }

  private async bootstrapIdentity(profile: GoogleUserProfile, consentToBindOffline = false): Promise<{
    restoredOpsCount: number;
    verifiedOwner: string;
    preservedOfflineOpsCount: number;
  }> {
    if (!profile || !profile.subjectHash) {
      throw new Error('Bootstrap and restore requires a verified Google user profile with subjectHash.');
    }
    await this.db.waitForPendingWrites();
    if (!profile.accessToken || !profile.isDriveAuthorized || profile.subjectHash !== await computeOwnerSubjectHash(profile.subjectId)) {
      throw new Error('Verified Google authorization is required before binding this dataset.');
    }

    const currentOwner = this.db.getIdentity()?.ownerSubjectHash;
    const rawState = this.db.getRawState();
    const hasTransactions = rawState.journalTransactions.size > 0;
    const hasSyncOps = rawState.syncOperations.size > 0;
    const isNonEmpty = hasTransactions || hasSyncOps || !this.db.hasOnlyUntouchedStarters();

    // 1. Prevent silent reassignment of an existing non-empty dataset to another Google account
    if (currentOwner && currentOwner !== profile.subjectHash) {
      throw new Error(
        `Security Error: Cannot reassign existing non-empty dataset belonging to owner (${currentOwner}) to a different Google account (${profile.subjectHash}).`
      );
    }

    const temporary = (owner?: string) => !owner || owner === 'local-owner' || owner === 'unassigned';
    if (Array.from(rawState.workspaces.values()).some(ws => !temporary(ws.ownerSubjectHash) && ws.ownerSubjectHash !== profile.subjectHash) ||
      Array.from(rawState.syncOperations.values()).some(op => !temporary(op.ownerHash) && op.ownerHash !== profile.subjectHash)) {
      throw new Error('Security Error: Foreign workspace or operation ownership prevents first-owner binding.');
    }
    if (!currentOwner && isNonEmpty && !consentToBindOffline) {
      throw new Error('Explicit consent is required to bind existing offline records to this Google account.');
    }

    // 2. Preserve offline transactions: if dataset was created offline before login (or by this owner)
    let preservedOfflineOpsCount = 0;
    await this.db.beginTransaction();
    try {
    if ((!currentOwner || currentOwner === profile.subjectHash) && isNonEmpty) {
      for (const op of rawState.syncOperations.values()) {
        if (!op.ownerHash || op.ownerHash === 'local-owner' || op.ownerHash === 'unassigned') {
          op.ownerHash = profile.subjectHash;
          preservedOfflineOpsCount++;
        }
      }
    }

    for (const ws of rawState.workspaces.values()) {
      if (temporary(ws.ownerSubjectHash)) ws.ownerSubjectHash = profile.subjectHash;
    }
    for (const op of rawState.syncOperations.values()) {
      if (op.type === 'workspace.create' && temporary(op.payload.workspace?.ownerSubjectHash)) {
        op.payload.workspace.ownerSubjectHash = profile.subjectHash;
        op.contentSha256 = await computeSha256(canonicalJson(op.payload));
      }
      if (temporary(op.ownerHash)) op.ownerHash = profile.subjectHash;
    }

    // 3. Establish verified identity on database
    this.db.setIdentity(profile.subjectHash, profile.displayName);
    rawState.preferences.set('sync-bootstrap-owner-v1', profile.subjectHash);
    validateSavingsOperations(this.db.getRawState().syncOperations.values(), this.db.getRawState().workspaces, this.db.getRawState().accounts);
    await this.db.commitTransaction();
    } catch (error) { await this.db.rollbackTransaction(); throw error; }
    // Independent asset-store failure keeps originals intact; reconnect retries the claim.
    await workspaceMedia.claimOfflineAssets(Array.from(this.db.getRawState().workspaces.keys()), profile.subjectHash)
      .catch(() => console.warn('Workspace image ownership migration will retry on reconnect.'));
    await migrateLegacyWorkspaceImages(this.db)
      .catch(() => console.warn('Previous workspace photos remain on this device; copying them for sync will retry on reconnect.'));
    this.isAuthorized = true;
    this.needsBootstrapMetadata = true;

    // 4. Trigger sync to download and apply all remote batches belonging to this verified owner,
    // and upload any preserved offline outbox operations to Google Drive
    this.bootstrapInProgress = false;
    await this.triggerSync();

    return {
      restoredOpsCount: this.db.getRawState().appliedOperations.size,
      verifiedOwner: profile.subjectHash,
      preservedOfflineOpsCount,
    };
  }

  private async queueMissingMetadata(): Promise<void> {
    await this.db.beginTransaction();
    try {
      const state = this.db.getRawState();
      const definitions = new Set(Array.from(state.syncOperations.values()).map(op => `${op.type}:${op.entityId}`));
      for (const [collection, type, field] of [
        ['workspaces', 'workspace.create', 'workspace'], ['accounts', 'account.create', 'account'],
        ['categories', 'category.create', 'category'], ['parties', 'party.create', 'party'],
        ['accountGroups', 'group.create', 'group'], ['accountPermissions', 'permission.grant', 'grant'],
        ['budgets', 'budget.set', 'budget'], ['recurringRules', 'recurring.rule.create', 'rule'],
        ['recurringOccurrences', 'recurring.occurrence.post', 'occurrence'],
        ['receiptBlobs', 'receipt.attach', 'blob'],
      ] as const) for (const [id, record] of state[collection] as Map<string, any>) {
        if (!definitions.has(`${type}:${id}`)) this.db.queueSyncOp(type, id, { [field]: record });
      }
      const journalIds = new Set<string>();
      for (const op of state.syncOperations.values()) {
        for (const key of ['balancedJournal', 'reversalBalanced', 'replacementBalanced']) {
          const id = op.payload[key]?.transaction?.id; if (id) journalIds.add(id);
        }
      }
      for (const tx of state.journalTransactions.values()) if (!journalIds.has(tx.id)) {
        const { lines, ...transaction } = tx;
        this.db.queueSyncOp('journal.post', tx.id, { balancedJournal: { transaction, lines } });
      }
      state.preferences.delete('sync-bootstrap-owner-v1');
      state.preferences.set('sync-metadata-version-v1', 1);
      await this.db.commitTransaction();
    } catch (error) { await this.db.rollbackTransaction(); throw error; }
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

    // Old clients may have applied/retained the extension. A replay is allowed
    // only for the same immutable operation, never a replacement using its ID.
    const batchIds = new Map<string, SyncOperation>();
    for (const op of batch.operations) {
      if (!op || typeof op.operationId !== 'string') throw new Error('Invalid synchronization operation.');
      const existing = batchIds.get(op.operationId) || this.db.getRawState().syncOperations.get(op.operationId);
      if (existing && (isSavingsOperation(existing) || isSavingsOperation(op) || isLoanOperation(existing) || isLoanOperation(op))) {
        const { contentSha256: _oldHash, ...oldFields } = existing;
        const { contentSha256: _newHash, ...newFields } = op;
        if (canonicalJson(oldFields) !== canonicalJson(newFields)) throw new Error('SAVINGS_EVENT_CONFLICT');
      }
      batchIds.set(op.operationId, op);
    }
    if (batch.operations.every(op => this.db.getRawState().appliedOperations.has(op.operationId))) return;
    await this.db.beginTransaction();
    try {
    let operations = [...batch.operations];
    while (operations.length) {
    const deferred: SyncOperation[] = [];
    let progress = false;
    for (const op of operations) {
      if (!op || !op.payload || !op.operationId || !Number.isSafeInteger(op.seq) || op.seq < 1) throw new Error('Invalid synchronization operation.');
      // 1. Validate dataset owner identity on operation
      if (!op.ownerHash) {
        throw new Error('Synchronization operation owner is missing.');
      }
      if (localOwner && op.ownerHash !== localOwner) {
        throw new Error('Synchronization operation owner mismatch.');
      }

      // 2. Idempotency: if already applied, skip
      if (this.db.getRawState().appliedOperations.has(op.operationId)) {
        continue;
      }

      // 2. Validate op content hash if present
      if (op.contentSha256) {
        const expectedHash = await computeSha256(canonicalJson(op.payload));
        if (op.contentSha256 !== expectedHash) {
          throw new Error('Synchronization operation checksum mismatch.');
        }
      }

      // 3. Process operation by type
      try { await this.applySingleOperation(op, isFromSelf); }
      catch (error) { if (error instanceof SyncDependencyError) { deferred.push(op); continue; } throw error; }

      // 4. Record as applied
      this.db.getRawState().appliedOperations.add(op.operationId);
      if (!this.db.getRawState().syncOperations.has(op.operationId)) this.db.getRawState().syncOperations.set(op.operationId, JSON.parse(JSON.stringify(op)));
      progress = true;
    }
    if (deferred.length && !progress) throw new SyncDependencyError();
    operations = deferred;
    }

    validateSavingsOperations(this.db.getRawState().syncOperations.values(), this.db.getRawState().workspaces, this.db.getRawState().accounts);
    readSavingsLoans(this.db.getRawState());
    validateReportOperations(this.db.getRawState().syncOperations.values(),this.db.getRawState().workspaces,this.db.getRawState().accounts,this.db.getRawState().journalTransactions);
    await this.db.commitTransaction();
    } catch (error) { await this.db.rollbackTransaction(); throw error; }
  }

  private async applySingleOperation(op: SyncOperation, isFromSelf: boolean): Promise<void> {
    const payload: SyncOperation['payload'] = { ...op.payload, id: op.payload.id || op.entityId };
    requireDependencies(this.db, op);

    switch (op.type) {
      case 'journal.post': {
        const balanced: BalancedJournal = payload.balancedJournal;
        if (balanced && balanced.transaction && balanced.lines) {
          validateIncomingJournal(this.db, balanced);
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
            createdOpId: balanced.transaction.createdOpId || op.operationId,
            lines: balanced.lines,
          };
          if (!this.db.getTransaction(fullTx.id)) this.db.getRawState().journalTransactions.set(fullTx.id, fullTx);
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
          throw new SyncDependencyError();
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
          validateIncomingJournal(this.db, reversalBalanced);
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
          validateIncomingJournal(this.db, replacementBalanced);
          const repTx: JournalTransaction = {
            ...replacementBalanced.transaction,
            createdOpId: op.operationId,
            lines: replacementBalanced.lines,
          };
          this.db.getRawState().journalTransactions.set(repTx.id, repTx);
          for (const line of replacementBalanced.lines) {
            this.db.getRawState().journalLines.set(line.id, line);
          }
          originalTx.isReplacedBy = repTx.id;
        }
        break;
      }

      case 'journal.delete': {
        const original = this.db.getTransaction(payload.originalTransactionId)!;
        let reversal: BalancedJournal = payload.reversalBalanced;
        if (!reversal) {
          reversal = buildReversalJournal(original, op.operationId, payload.reason || 'Deleted transaction');
          reversal.transaction.id = payload.reversalTransactionId;
          reversal.transaction.occurredAtUtc = op.createdAtUtc;
          reversal.lines = reversal.lines.map((line, index) => ({ ...line, id: `${op.operationId}-reversal-${index}`,
            transactionId: payload.reversalTransactionId }));
        }
        validateIncomingJournal(this.db, reversal);
        if (!this.db.getTransaction(reversal.transaction.id)) this.db.getRawState().journalTransactions.set(reversal.transaction.id, { ...reversal.transaction, lines: reversal.lines });
        for (const line of reversal.lines) this.db.getRawState().journalLines.set(line.id, line);
        original.isDeleted = true;
        break;
      }

      case 'workspace.create': {
        if (!payload.workspace || payload.workspace.id !== op.entityId || payload.workspace.ownerSubjectHash !== op.ownerHash ||
            op.authorSubjectHash && op.authorSubjectHash !== op.ownerHash) throw new Error('Invalid workspace owner or definition.');
        const existing = this.db.getWorkspace(payload.workspace.id);
        if (existing && existing.ownerSubjectHash !== op.ownerHash) throw new Error('Workspace owner mismatch.');
        const image = mergeWorkspaceImage(existing?.image, payload.workspace.image);
        if (payload.workspace && payload.workspace.ownerSubjectHash === op.ownerHash &&
          !this.db.getWorkspace(payload.workspace.id)?.deletedAt) {
          this.db.getRawState().workspaces.set(payload.workspace.id, { ...payload.workspace, ...(image ? { image } : {}) });
        }
        break;
      }

      case 'workspace.update':
        if (payload.id !== op.entityId || op.authorSubjectHash && op.authorSubjectHash !== op.ownerHash)
          throw new Error('Invalid workspace author or reference.');
        if (payload.image !== undefined) validateWorkspaceImage(payload.image);
        if (payload.id && this.db.getRawState().workspaces.has(payload.id)) {
          const ws = this.db.getRawState().workspaces.get(payload.id)!;
          if (ws.ownerSubjectHash !== op.ownerHash) throw new Error('Workspace owner mismatch.');
          if (ws.deletedAt) break;
          if (payload.image !== undefined) ws.image = mergeWorkspaceImage(ws.image, payload.image);
          if (payload.name) ws.name = payload.name;
          if (payload.kind) ws.kind = payload.kind;
          if (typeof payload.description === 'string') ws.description = payload.description.trim().slice(0, 500);
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
          if (payload.parentId !== undefined) c.parentId = payload.parentId;
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

      case 'receipt.attach':
        validateReceiptBlob(payload.blob);
        if (op.entityId !== payload.blob.sha256) throw new Error('Receipt identity does not match its contents.');
        if (!this.db.getReceiptBlob(payload.blob.sha256)) this.db.getRawState().receiptBlobs.set(payload.blob.sha256, payload.blob);
        break;

      default:
        throw new Error('Unsupported synchronization operation. Update this app before syncing.');
    }
  }
}
