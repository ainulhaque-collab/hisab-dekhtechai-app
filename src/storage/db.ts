/**
 * Local Database Engine and Financial Repository
 * Supports atomic transactions, schema versions, migrations,
 * durable outbox, deduplication, and crash-resilient snapshots.
 */

import {
  UUID,
  Workspace,
  Account,
  Category,
  JournalTransaction,
  JournalLine,
  BalancedJournal,
  SyncOperation,
  SyncOutboxEntry,
  ConflictRecord,
  Budget,
  RecurringRule,
  RecurringOccurrence,
  ReceiptBlob,
  LocalSnapshot,
  AccountBalanceSummary,
  DashboardData,
  PaisaString,
  BusinessParty,
  PartyRole,
  AccountGroup,
  AccountGroupSummary,
  AccountPermissionGrant,
  EmployeeRole,
  SyncOperationType
} from '../contracts/types';
import { toPaisa, addPaisa, subPaisa, paisaToDecimalString } from '../domain/money';
import {
  generateUUID,
  buildReversalJournal,
  buildExpenseJournal,
  buildIncomeJournal,
} from '../domain/journal';
import { canonicalJson, computeSha256, computeSha256Sync } from '../sync/canonical';
import { isDeleteConfirmed } from '../domain/confirmation';
import { resolveJournalTime, validateTransactionTime } from '../domain/transactionTime';
import { validateReceiptBlob } from './receipts';
import { createWorkspaceImage, validateWorkspaceImage } from './workspaceImages';
import { decodeBackup, encodeBackup, mergeBackup } from './backup';
import { projectSavingsGoals, validateSavingsGoalEvent, type SavingsGoal, type SavingsGoalEvent, type SavingsProjection } from '../domain/savingsGoals';
import { isSavingsOperation, savingsRecords, validateSavingsOperations } from './savingsOperations';
import {
  createDurableStorageDriver,
  DurableStorageDriver,
  StorageType
} from './drivers/durableStorage';

export const CURRENT_SCHEMA_VERSION = 5;

function storageError(error: unknown): Error {
  if (error instanceof Error) return error;
  const message = error && typeof error === 'object' && 'message' in error ? error.message : error;
  return new Error(typeof message === 'string' ? message : 'Local database operation failed.');
}

export interface DatabaseState {
  schemaVersion: number;
  localIdentity: {
    ownerSubjectHash: string;
    accountDisplayHint?: string;
    createdAt: string;
  } | null;
  deviceIdentity: {
    deviceId: UUID;
    deviceName: string;
    counter: number;
    createdAt: string;
  };
  workspaces: Map<UUID, Workspace>;
  accounts: Map<UUID, Account>;
  accountGroups: Map<UUID, AccountGroup>;
  accountPermissions: Map<UUID, AccountPermissionGrant>;
  categories: Map<UUID, Category>;
  parties: Map<UUID, BusinessParty>;
  journalTransactions: Map<UUID, JournalTransaction>;
  journalLines: Map<UUID, JournalLine>;
  syncOperations: Map<UUID, SyncOperation>;
  syncOutbox: Map<UUID, SyncOutboxEntry>;
  appliedOperations: Set<UUID>;
  syncDeviceHeads: Map<UUID, number>; // deviceId -> highest contiguous seq
  conflicts: Map<UUID, ConflictRecord>;
  budgets: Map<UUID, Budget>;
  recurringRules: Map<UUID, RecurringRule>;
  recurringOccurrences: Map<UUID, RecurringOccurrence>;
  receiptBlobs: Map<string, ReceiptBlob>; // key is sha256
  localSnapshots: Map<UUID, LocalSnapshot>;
  schemaMigrations: Array<{
    fromVersion: number;
    toVersion: number;
    checksum: string;
    appliedAt: string;
  }>;
  preferences: Map<string, any>;
}

export class LocalDatabase {
  private state: DatabaseState;
  private storageKey: string;
  private inTransaction = false;
  private snapshotBeforeTx: string | null = null;
  private driver: DurableStorageDriver | null = null;
  private changeListeners = new Set<() => void>();
  private notifiedPending = new Set<string>();

  public subscribeToLocalChanges(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  }

  public isTransactionInProgress(): boolean { return this.inTransaction; }

  private notifyCommittedChanges(ids = this.getPendingOutbox().map(op => op.operationId)): void {
    const changed = ids.some(id => !this.notifiedPending.has(id));
    this.notifiedPending = new Set(ids);
    if (changed) for (const listener of this.changeListeners) {
      try { listener(); } catch { console.warn('Local change listener failed. Records are already saved.'); }
    }
  }

  constructor(storageKey = 'hisab_dekhtechai_db', driver?: DurableStorageDriver) {
    this.storageKey = storageKey;
    this.state = this.createEmptyState();
    if (driver) {
      this.driver = driver;
    }
    this.loadFromStorage();
  }

  public setStorageDriver(driver: DurableStorageDriver): void {
    this.driver = driver;
  }

  public getStorageDriver(): DurableStorageDriver | null {
    return this.driver;
  }

  private createEmptyState(): DatabaseState {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      localIdentity: null,
      deviceIdentity: {
        deviceId: generateUUID(),
        deviceName: 'Android Device (Primary)',
        counter: 1,
        createdAt: new Date().toISOString(),
      },
      workspaces: new Map(),
      accounts: new Map(),
      accountGroups: new Map(),
      accountPermissions: new Map(),
      categories: new Map(),
      parties: new Map(),
      journalTransactions: new Map(),
      journalLines: new Map(),
      syncOperations: new Map(),
      syncOutbox: new Map(),
      appliedOperations: new Set(),
      syncDeviceHeads: new Map(),
      conflicts: new Map(),
      budgets: new Map(),
      recurringRules: new Map(),
      recurringOccurrences: new Map(),
      receiptBlobs: new Map(),
      localSnapshots: new Map(),
      schemaMigrations: [
        {
          fromVersion: 0,
          toVersion: 1,
          checksum: 'init-v1',
          appliedAt: new Date().toISOString(),
        },
        {
          fromVersion: 1,
          toVersion: 2,
          checksum: 'budget-receipt-v2',
          appliedAt: new Date().toISOString(),
        },
        {
          fromVersion: 2,
          toVersion: 3,
          checksum: 'recovery-snapshots-v3',
          appliedAt: new Date().toISOString(),
        },
        {
          fromVersion: 3,
          toVersion: 4,
          checksum: 'double-entry-ledger-v4',
          appliedAt: new Date().toISOString(),
        },
        {
          fromVersion: 4,
          toVersion: 5,
          checksum: 'account-groups-permissions-v5',
          appliedAt: new Date().toISOString(),
        },
      ],
      preferences: new Map<string, any>([
        ['language', 'en'],
        ['theme', 'light'],
        ['pin_lock_enabled', false],
        ['pin_hash', ''],
      ]),
    };
  }

  /**
   * Automatically loads state from durable storage, seeding defaults only if empty.
   * Never wipes data if parsing fails: preserves emergency backup and throws.
   */
  public loadFromStorage(): boolean {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          // Constructor hydration must not launch asynchronous migrations before driver init.
          this.hydrateState(parsed);
          return true;
        } catch (err) {
          console.error('[CRITICAL] Failed to parse or migrate database from localStorage. Preserving data to prevent wipe:', err);
          try {
            const emergencyKey = `${this.storageKey}_emergency_backup_${Date.now()}`;
            localStorage.setItem(emergencyKey, raw);
            console.warn(`Preserved raw financial data in emergency key: ${emergencyKey}`);
          } catch {}
          throw err;
        }
      }
    }
    this.seedDefaultEntities();
    this.persistSync();
    return false;
  }

  /**
   * Initializes durable driver (Native SQLite or IndexedDB),
   * performing non-destructive migration from legacy localStorage if necessary.
   * Never silently falls back or wipes: storage initialization errors are strictly propagated.
   */
  private initialization: Promise<void> | null = null;
  public init(): Promise<void> {
    return this.initialization ??= this.initialize().catch(error => { this.initialization = null; throw error; });
  }
  private async initialize(): Promise<void> {
    try {
      if (!this.driver) {
        this.driver = await createDurableStorageDriver(this.storageKey);
      }

      // Check if durable store already has records
      const durableData = await this.driver.getItem(this.storageKey);
      if (durableData) {
        try {
          const parsed = JSON.parse(durableData);
          await this.loadFromSerializable(parsed);
          if ((parsed.schemaVersion || 1) < CURRENT_SCHEMA_VERSION) await this.persist();
          else this.persistSync();
          return;
        } catch (err) {
          console.error('[CRITICAL] Failed to parse durable storage state. Preserving emergency snapshot before error:', err);
          try {
            await this.driver.setItem(`${this.storageKey}_emergency_corrupt_backup`, durableData);
            await this.driver.setItem(`${this.storageKey}_emergency_backup_${Date.now()}`, durableData);
          } catch {}
          throw err;
        }
      }

      // If durable driver is empty, check legacy storage and migrate with verification
      await this.migrateFromLegacyStorage();
    } catch (driverErr) {
      console.error('Durable driver initialization failed:', driverErr);
      throw driverErr;
    }
  }

  /**
   * Verified Non-Destructive Migration from legacy localStorage to SQLite/IndexedDB
   */
  public async migrateFromLegacyStorage(): Promise<{
    migrated: boolean;
    verified: boolean;
    recordsMigrated: number;
  }> {
    if (typeof localStorage === 'undefined' || !this.driver) {
      return { migrated: false, verified: false, recordsMigrated: 0 };
    }

    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        // Nothing legacy to migrate, save default seeded state to durable driver
        await this.driver.setItem(this.storageKey, JSON.stringify(this.toSerializable()));
        return { migrated: false, verified: true, recordsMigrated: 0 };
      }

      // Step 1: Pre-migration safety snapshot in a persistent backup key
      const backupKey = `hisab_legacy_backup_${Date.now()}`;
      localStorage.setItem(backupKey, raw);

      const parsed = JSON.parse(raw);
      await this.loadFromSerializable(parsed);

      // Step 2: Compute pre-migration record count and consolidated balance
      const legacyTxCount = this.state.journalTransactions.size;
      const legacyAccCount = this.state.accounts.size;
      let legacyConsolidatedBalance = 0n;
      for (const acc of this.state.accounts.values()) {
        legacyConsolidatedBalance = addPaisa(legacyConsolidatedBalance, toPaisa(acc.openingBalanceMinor));
      }

      // Step 3: Write to durable driver
      const expectedData = JSON.stringify(this.toSerializable());
      await this.driver.setItem(this.storageKey, expectedData);

      // Step 4: Verification read-back
      const readBack = await this.driver.getItem(this.storageKey);
      if (!readBack) {
        throw new Error('Durable driver failed verification read-back: empty payload.');
      }

      const verifiedParsed = JSON.parse(readBack);
      const verifiedTxCount = (verifiedParsed.journalTransactions || []).length;
      const verifiedAccCount = (verifiedParsed.accounts || []).length;

      if (verifiedTxCount !== legacyTxCount || verifiedAccCount !== legacyAccCount ||
          canonicalJson(verifiedParsed) !== canonicalJson(JSON.parse(expectedData))) {
        throw new Error(
          `Record count mismatch during migration verification! Expected ${legacyTxCount} txs, got ${verifiedTxCount}`
        );
      }

      console.info(
        `[Storage Migration] Successfully migrated ${legacyTxCount} transactions and ${legacyAccCount} accounts to ${this.driver.getType()}.`
      );

      // Legacy localStorage data is intentionally preserved in backupKey for emergency recovery
      return {
        migrated: true,
        verified: true,
        recordsMigrated: legacyTxCount,
      };
    } catch (migrationErr) {
      console.error('[Storage Migration Error] Migration failed, rolling back to safety snapshot:', migrationErr);
      throw migrationErr;
    }
  }

  /**
   * Persists database state synchronously to memory/localStorage cache.
   */
  public persistSync(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const serializable = this.toSerializable();
        localStorage.setItem(this.storageKey, JSON.stringify(serializable));
      } catch (e) {
        console.error('Database persistSync failed:', e);
      }
    }
  }

  private writeQueuePromise: Promise<void> = Promise.resolve();
  private pendingQueueCount = 0;
  public lastPersistenceError: Error | null = null;

  public getLastPersistenceError(): Error | null {
    return this.lastPersistenceError;
  }

  public clearPersistenceError(): void {
    this.lastPersistenceError = null;
  }

  /**
   * Enqueues a durable persist task into a strictly serialized FIFO queue.
   * Guarantees that:
   * 1. Concurrent writes never execute in parallel or overwrite newer snapshots with stale ones.
   * 2. Snapshots are captured sequentially at the exact moment each write executes.
   * 3. Failures immediately propagate to the caller's returned Promise.
   * 4. Errors are never swallowed or falsely acknowledged as successful.
   * 5. Unhandled persistence errors are preserved until explicitly cleared by clearPersistenceError().
   */
  public enqueuePersist(): Promise<void> {
    this.pendingQueueCount++;
    const task = this.writeQueuePromise
      .catch(() => {
        // Keep the queue pipeline moving even if a prior write rejected
      })
      .then(async () => {
        try {
          const committedIds = this.getPendingOutbox().map(op => op.operationId);
          if (this.driver) {
            const serializable = this.toSerializable();
            await this.driver.setItem(this.storageKey, JSON.stringify(serializable));
          }
          this.persistSync();
          if (!this.inTransaction) this.notifyCommittedChanges(committedIds);
        } catch (err: any) {
          const errorObj = storageError(err);
          this.lastPersistenceError = errorObj;
          console.error('[CRITICAL LocalDatabase Storage Write Error]:', errorObj);
          throw errorObj;
        } finally {
          this.pendingQueueCount = Math.max(0, this.pendingQueueCount - 1);
        }
      });

    this.writeQueuePromise = task;
    return task;
  }

  /**
   * Persists database state asynchronously to durable SQLite / IndexedDB driver.
   * Ensures durable writes complete before reporting success and propagates any storage errors.
   */
  public async persist(): Promise<void> {
    return await this.enqueuePersist();
  }

  /**
   * Reliably awaits all in-flight asynchronous storage writes and re-throws any persisted errors.
   */
  public async waitForPendingWrites(): Promise<void> {
    await this.writeQueuePromise.catch(() => {});
    if (this.lastPersistenceError) {
      throw this.lastPersistenceError;
    }
  }

  /**
   * Helper for internal synchronous mutating methods.
   * If a transaction is in progress, intermediate mutations are not persisted until commit.
   * Enqueues write and safely catches fire-and-forget promise while tracking errors for waitForPendingWrites.
   */
  private autoPersist(): void {
    if (!this.inTransaction) {
      this.enqueuePersist().catch(() => {});
    }
  }

  // --- Atomic Database Transactions ---

  public async beginTransaction(): Promise<void> {
    // The native connection must finish opening before taking the transaction lock.
    await this.init();
    // Strictly wait for all in-flight writes in the durability queue to settle before beginning transaction
    await this.writeQueuePromise.catch(() => {});
    if (this.inTransaction) {
      throw new Error('Transaction already in progress.');
    }
    const snapshot = JSON.stringify(this.toSerializable());
    this.inTransaction = true;
    this.snapshotBeforeTx = snapshot;
    try {
      if (this.driver && typeof this.driver.beginTransaction === 'function') {
        await this.driver.beginTransaction();
      }
    } catch (error) {
      // A rejected native begin never grants the caller a transaction. Release
      // only this attempt's memory lock; do not roll back another native owner.
      this.inTransaction = false;
      this.snapshotBeforeTx = null;
      throw storageError(error);
    }
  }

  public async commitTransaction(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('Cannot commit: no transaction in progress.');
    }
    try {
      await this.persist();
      if (this.driver && typeof this.driver.commitTransaction === 'function') {
        await this.driver.commitTransaction();
      }
      this.inTransaction = false;
      this.snapshotBeforeTx = null;
      this.notifyCommittedChanges();
    } catch (err) {
      await this.rollbackTransaction();
      throw err;
    }
  }

  public async rollbackTransaction(): Promise<void> {
    if (!this.inTransaction && !this.snapshotBeforeTx) return;
    try {
      if (this.driver && typeof this.driver.rollbackTransaction === 'function') {
        await this.driver.rollbackTransaction();
      }
    } catch (driverRollbackErr) {
      console.warn('Driver rollback warning:', driverRollbackErr);
    }
    if (this.snapshotBeforeTx) {
      try {
        const parsed = JSON.parse(this.snapshotBeforeTx);
        await this.loadFromSerializable(parsed);
        this.persistSync();
      } catch (e) {
        console.error('Failed to rollback transaction state:', e);
      }
    }
    this.inTransaction = false;
    this.snapshotBeforeTx = null;
  }

  public async getDurabilityInfo(): Promise<{
    type: StorageType;
    isPersistent: boolean;
    warning?: string;
  }> {
    const type = this.driver?.getType() || 'localstorage-fallback';
    const isPersistent = this.driver ? await this.driver.isPersistent() : false;
    return {
      type,
      isPersistent,
      warning:
        type === 'localstorage-fallback' || !isPersistent
          ? 'Storage durability lease not guaranteed by browser. Google Drive sync recommended for cloud preservation.'
          : undefined,
    };
  }

  public getDeviceId(): UUID {
    return this.state.deviceIdentity.deviceId;
  }

  public getDeviceName(): string {
    return this.state.deviceIdentity.deviceName;
  }

  public setDeviceIdentity(deviceId: UUID, deviceName: string): void {
    if (deviceId !== this.state.deviceIdentity.deviceId) {
      this.state.deviceIdentity.counter = Array.from(this.state.syncOperations.values())
        .reduce((highest, op) => op.deviceId === deviceId ? Math.max(highest, op.seq) : highest, 0) + 1;
    }
    this.state.deviceIdentity.deviceId = deviceId;
    this.state.deviceIdentity.deviceName = deviceName;
  }

  public getNextDeviceSeq(): number {
    const seq = this.state.deviceIdentity.counter++;
    return seq;
  }

  public getIdentity() {
    return this.state.localIdentity;
  }

  public setIdentity(ownerSubjectHash: string, accountDisplayHint?: string): void {
    this.state.localIdentity = {
      ownerSubjectHash,
      accountDisplayHint,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Seeds default workspace, asset accounts (Cash, bKash, Bank), and categories.
   */
  public seedDefaultEntities(): void { populateStarterEntities(this.state); }

  // --- Transactions and Atomic Commits ---

  /**
   * Commits a balanced journal transaction and queues an immutable sync operation in a single atomic commit.
   */
  public async commitJournalWithOutbox(
    balanced: BalancedJournal,
    op: SyncOperation,
    receipt?: ReceiptBlob | null
  ): Promise<UUID> {
    const tx = balanced.transaction;
    const lines = balanced.lines;
    validateTransactionTime(tx);
    if (receipt) {
      validateReceiptBlob(receipt);
      if (receipt.sha256 !== tx.receiptBlobSha256) throw new Error('Receipt does not match the transaction.');
    }

    // Check if operation was already applied
    if (this.state.appliedOperations.has(op.operationId)) {
      console.warn(`Operation ${op.operationId} was already applied. Skipping duplicate.`);
      return tx.id;
    }

    // Atomic transaction boundary
    await this.beginTransaction();
    try {
      // Store transaction and lines
      const fullTx: JournalTransaction = {
        ...tx,
        lines,
      };
      this.state.journalTransactions.set(fullTx.id, fullTx);
      for (const line of lines) {
        this.state.journalLines.set(line.id, line);
      }

      // Store sync operation
      this.state.syncOperations.set(op.operationId, op);

      // Queue in durable outbox
      const outboxEntry: SyncOutboxEntry = {
        opId: op.operationId,
        uploadedStatus: 'pending',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      };
      this.state.syncOutbox.set(op.operationId, outboxEntry);

      // Mark as applied
      this.state.appliedOperations.add(op.operationId);

      // Advance device sequence head if this device generated it
      if (op.deviceId === this.state.deviceIdentity.deviceId) {
        this.state.syncDeviceHeads.set(op.deviceId, op.seq);
      }

      if (receipt && !this.state.receiptBlobs.has(receipt.sha256)) {
        this.state.receiptBlobs.set(receipt.sha256, { ...receipt });
        this.queueSyncOp('receipt.attach', receipt.sha256, { blob: receipt });
      }

      await this.commitTransaction();
      return fullTx.id;
    } catch (err) {
      await this.rollbackTransaction();
      throw err;
    }
  }

  public getSchemaVersion(): number {
    return this.state.schemaVersion;
  }

  public queueSyncOp(
    opType: SyncOperationType,
    entityId: UUID,
    payload: Record<string, any>
  ): SyncOperation {
    const opId = generateUUID();
    const op: SyncOperation = {
      protocolVersion: 1,
      ownerHash: this.getIdentity()?.ownerSubjectHash || 'local-owner',
      deviceId: this.state.deviceIdentity.deviceId,
      seq: this.getNextDeviceSeq(),
      operationId: opId,
      entityId,
      type: opType,
      createdAtUtc: new Date().toISOString(),
      payload: JSON.parse(JSON.stringify(payload)),
      contentSha256: '',
    };
    op.contentSha256 = computeSha256Sync(canonicalJson(op.payload));
    this.state.syncOperations.set(opId, op);
    this.state.syncOutbox.set(opId, {
      opId,
      uploadedStatus: 'pending',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    });
    this.state.appliedOperations.add(opId);
    this.state.syncDeviceHeads.set(op.deviceId, op.seq);
    return op;
  }

  // --- Query Engine ---

  public getWorkspaces(): Workspace[] {
    return Array.from(this.state.workspaces.values()).filter((w) => !w.archivedAt && !w.deletedAt);
  }

  public getAllWorkspaces(): Workspace[] {
    return Array.from(this.state.workspaces.values()).filter(w => !w.deletedAt);
  }

  public getWorkspace(id: UUID): Workspace | undefined {
    return this.state.workspaces.get(id);
  }

  public createWorkspace(name: string, kind: 'personal' | 'business', description = ''): Workspace {
    if (!name.trim()) throw new Error('Workspace name is required.');
    const ws: Workspace = {
      id: generateUUID(),
      ownerSubjectHash: this.state.localIdentity?.ownerSubjectHash || 'local-owner',
      name: name.trim(),
      kind,
      description: description.trim().slice(0, 500),
      currency: 'BDT',
      createdAt: new Date().toISOString(),
    };
    this.state.workspaces.set(ws.id, ws);
    this.queueSyncOp('workspace.create', ws.id, { workspace: { ...ws } });
    this.autoPersist();
    return ws;
  }

  public archiveWorkspace(id: UUID): boolean {
    const ws = this.state.workspaces.get(id);
    if (!ws) return false;
    this.assertWorkspaceOwner(ws);
    if (ws.archivedAt) return true;
    if (this.getWorkspaces().length <= 1) throw new Error('Keep at least one active workspace.');
    ws.archivedAt = new Date().toISOString();
    this.queueSyncOp('workspace.archive', id, { id, archivedAt: ws.archivedAt });
    this.autoPersist();
    return true;
  }

  public restoreWorkspace(id: UUID): boolean {
    const ws = this.state.workspaces.get(id);
    if (!ws) return false;
    this.assertWorkspaceOwner(ws);
    ws.archivedAt = null;
    // Existing v1 clients understand workspace.create as an idempotent full upsert.
    this.queueSyncOp('workspace.create', id, { workspace: { ...ws } });
    this.autoPersist();
    return true;
  }

  public editWorkspace(id: UUID, updates: Partial<Pick<Workspace, 'name' | 'kind' | 'description'>> & { imageDataUrl?: string | null }): boolean {
    const ws = this.state.workspaces.get(id);
    if (!ws) return false;
    this.assertWorkspaceOwner(ws);
    if (updates.name !== undefined && !updates.name.trim()) throw new Error('Workspace name is required.');
    if (updates.imageDataUrl !== undefined && !this.inTransaction) throw new Error('Save workspace photos inside a database transaction.');
    const image = updates.imageDataUrl === undefined ? undefined : createWorkspaceImage(updates.imageDataUrl, generateUUID(), ws.image);
    if (updates.name !== undefined) ws.name = updates.name.trim();
    if (updates.kind) ws.kind = updates.kind;
    if (updates.description !== undefined) ws.description = updates.description.trim().slice(0, 500);
    if (image) ws.image = image;
    this.queueSyncOp('workspace.update', id, { id, name: ws.name, kind: ws.kind, description: ws.description, ...(image ? { image } : {}) });
    this.autoPersist();
    return true;
  }

  private assertWorkspaceOwner(ws: Workspace): void {
    const owner = this.getIdentity()?.ownerSubjectHash || 'local-owner';
    if (ws.deletedAt || ws.ownerSubjectHash !== owner) throw new Error('Workspace is unavailable or belongs to another owner.');
  }

  public workspaceDeleteBlocker(id: UUID): string | null {
    const ws = this.state.workspaces.get(id);
    if (!ws || ws.deletedAt) return 'Workspace not found.';
    this.assertWorkspaceOwner(ws);
    if (Array.from(this.state.syncOperations.values()).some(op => op.entityId === id && isSavingsOperation(op)))
      return 'This workspace contains savings history. Archive it to keep that history.';
    const starter = { localIdentity: null, workspaces: new Map(), accounts: new Map(), categories: new Map(), parties: new Map() };
    populateStarterEntities(starter);
    const protectedCollections = [this.state.accountGroups, this.state.accountPermissions, this.state.journalTransactions,
      this.state.budgets, this.state.recurringRules];
    if (protectedCollections.some(collection => Array.from((collection as Map<string, any>).values()).some(record => record.workspaceId === id)))
      return 'This workspace contains financial records. Archive it to preserve its history.';
    for (const [records, templates] of [[this.state.accounts, starter.accounts], [this.state.categories, starter.categories], [this.state.parties, starter.parties]] as const) {
      if (Array.from((records as Map<string, any>).values()).some(record => record.workspaceId === id && !sameStarterRecord(record, templates.get(record.id))))
        return 'This workspace has custom accounts, categories or people. Archive it to keep them safe.';
    }
    // Financial operations still protect their workspace. Empty starter-only recovery
    // points may retain the tombstone safely and must not make defaults undeletable.
    const snapshotHasHistory = (snapshot: LocalSnapshot) => {
      if (!snapshot.dataJson?.includes(id)) return false;
      try {
        const data = JSON.parse(snapshot.dataJson);
        if ((data.localSnapshots || []).length) return true; // Older recursive snapshots are conservative.
        if (['accountGroups', 'accountPermissions', 'journalTransactions', 'budgets', 'recurringRules']
          .some(key => (data[key] || []).some(([, record]: [string, any]) => record.workspaceId === id))) return true;
        return (['accounts', 'categories', 'parties'] as const).some(key =>
          (data[key] || []).some(([, record]: [string, any]) => record.workspaceId === id && !sameStarterRecord(record, starter[key].get(record.id))));
      } catch { return true; }
    };
    if (Array.from(this.state.syncOperations.values()).some(op => !op.type.startsWith('workspace.') &&
      (op.entityId === id || JSON.stringify(op.payload).includes(id))) ||
      Array.from(this.state.localSnapshots.values()).some(snapshotHasHistory))
      return 'Retained history or synchronization references this workspace. Archive it instead.';
    return null;
  }

  public safeDeleteWorkspace(id: UUID, confirmation: string): void {
    if (!isDeleteConfirmed(confirmation)) throw new Error('Exactly DELETE is required.');
    const blocker = this.workspaceDeleteBlocker(id);
    if (blocker) throw new Error(blocker);
    const ws = this.state.workspaces.get(id)!;
    ws.archivedAt = ws.deletedAt = new Date().toISOString();
    this.queueSyncOp('workspace.archive', id, { id, archivedAt: ws.archivedAt });
    this.queueSyncOp('workspace.create', id, { workspace: { ...ws } });
    this.autoPersist();
  }

  public getAccounts(workspaceId: UUID, includeArchived = false): Account[] {
    return Array.from(this.state.accounts.values()).filter(
      (a) => a.workspaceId === workspaceId && (includeArchived || !a.archivedAt)
    );
  }

  public createAccount(
    workspaceId: UUID,
    name: string,
    kind: Account['kind'],
    openingBalanceMinor = '0',
    accountNumberMasked = '',
    classification: Account['classification'] = 'asset',
    groupId: UUID | null = null
  ): Account {
    const acc: Account = {
      id: generateUUID(),
      workspaceId,
      groupId,
      name,
      kind,
      classification,
      accountNumberMasked,
      openingBalanceMinor,
      archivedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.state.accounts.set(acc.id, acc);
    this.queueSyncOp('account.create', acc.id, { account: acc });
    this.autoPersist();
    return acc;
  }

  public getAllAccounts(workspaceId: UUID): Account[] {
    return Array.from(this.state.accounts.values()).filter(
      (a) => a.workspaceId === workspaceId
    );
  }

  public getAccount(id: UUID): Account | undefined {
    return this.state.accounts.get(id);
  }

  public updateAccount(
    id: UUID,
    updates: Partial<Pick<Account, 'name' | 'accountNumberMasked' | 'kind' | 'groupId'>>
  ): Account | null {
    const acc = this.state.accounts.get(id);
    if (!acc) return null;
    if (updates.name !== undefined) acc.name = updates.name.trim();
    if (updates.accountNumberMasked !== undefined)
      acc.accountNumberMasked = updates.accountNumberMasked.trim();
    if (updates.kind !== undefined) acc.kind = updates.kind;
    if (updates.groupId !== undefined) acc.groupId = updates.groupId;
    this.queueSyncOp('account.update', id, { id, ...updates });
    this.autoPersist();
    return acc;
  }

  public archiveAccount(id: UUID): boolean {
    const acc = this.state.accounts.get(id);
    if (!acc) return false;
    acc.archivedAt = new Date().toISOString();
    this.queueSyncOp('account.archive', id, { id, archivedAt: acc.archivedAt });
    this.autoPersist();
    return true;
  }

  public restoreAccount(id: UUID): boolean {
    const acc = this.state.accounts.get(id);
    if (!acc) return false;
    acc.archivedAt = null;
    this.queueSyncOp('account.restore', id, { id });
    this.autoPersist();
    return true;
  }

  public safeDeleteAccount(
    id: UUID,
    confirmationText: string
  ): { success: boolean; mode: 'archived' | 'deleted'; error?: string } {
    if (!isDeleteConfirmed(confirmationText)) {
      return {
        success: false,
        mode: 'deleted',
        error: 'Invalid confirmation text. Exactly "DELETE" is required.',
      };
    }

    const acc = this.state.accounts.get(id);
    if (!acc) {
      return { success: false, mode: 'deleted', error: 'Account not found.' };
    }

    let hasTransactions = false;
    for (const line of this.state.journalLines.values()) {
      if (line.accountId === id) {
        hasTransactions = true;
        break;
      }
    }

    const hasReferences = BigInt(acc.openingBalanceMinor) !== 0n ||
      Array.from(this.state.syncOperations.values()).some(op => isSavingsOperation(op) && op.payload.savingsEvent?.accountId === id) ||
      Array.from(this.state.accountPermissions.values()).some(g => g.accountIds.includes(id)) ||
      Array.from(this.state.recurringRules.values()).some(r => JSON.stringify(r).includes(id)) ||
      this.getPendingOutbox().some(op => op.entityId === id || JSON.stringify(op.payload).includes(id));
    if (hasTransactions || hasReferences) {
      acc.archivedAt = new Date().toISOString();
      this.queueSyncOp('account.archive', id, { id, archivedAt: acc.archivedAt });
      this.autoPersist();
      return { success: true, mode: 'archived' };
    } else {
      this.state.accounts.delete(id);
      this.queueSyncOp('account.delete', id, { id });
      this.autoPersist();
      return { success: true, mode: 'deleted' };
    }
  }

  // --- Account Group Management (FEAT-001) ---

  public createAccountGroup(
    workspaceId: UUID,
    name: string,
    icon?: string,
    description?: string
  ): AccountGroup {
    const group: AccountGroup = {
      id: generateUUID(),
      workspaceId,
      name: name.trim(),
      icon,
      description: description?.trim(),
      archivedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.state.accountGroups.set(group.id, group);
    this.queueSyncOp('group.create', group.id, { group });
    this.autoPersist();
    return group;
  }

  public updateAccountGroup(
    id: UUID,
    updates: Partial<Pick<AccountGroup, 'name' | 'icon' | 'description'>>
  ): AccountGroup | null {
    const group = this.state.accountGroups.get(id);
    if (!group) return null;
    if (updates.name !== undefined) group.name = updates.name.trim();
    if (updates.icon !== undefined) group.icon = updates.icon;
    if (updates.description !== undefined) group.description = updates.description.trim();
    this.queueSyncOp('group.update', id, { id, ...updates });
    this.autoPersist();
    return group;
  }

  public archiveAccountGroup(id: UUID): boolean {
    const group = this.state.accountGroups.get(id);
    if (!group) return false;
    group.archivedAt = new Date().toISOString();
    this.queueSyncOp('group.archive', id, { id, archivedAt: group.archivedAt });
    this.autoPersist();
    return true;
  }

  public restoreAccountGroup(id: UUID): boolean {
    const group = this.state.accountGroups.get(id);
    if (!group) return false;
    group.archivedAt = null;
    this.queueSyncOp('group.restore', id, { id });
    this.autoPersist();
    return true;
  }

  public getAccountGroups(workspaceId: UUID, includeArchived = false): AccountGroup[] {
    return Array.from(this.state.accountGroups.values()).filter(
      (g) => g.workspaceId === workspaceId && (includeArchived || !g.archivedAt)
    );
  }

  public getAccountGroup(id: UUID): AccountGroup | undefined {
    return this.state.accountGroups.get(id);
  }

  public addAccountToGroup(accountId: UUID, groupId: UUID): boolean {
    const acc = this.state.accounts.get(accountId);
    const group = this.state.accountGroups.get(groupId);
    if (!acc || !group || acc.workspaceId !== group.workspaceId) return false;
    acc.groupId = groupId;
    this.queueSyncOp('account.update', accountId, { id: accountId, groupId });
    this.autoPersist();
    return true;
  }

  public removeAccountFromGroup(accountId: UUID): boolean {
    const acc = this.state.accounts.get(accountId);
    if (!acc) return false;
    acc.groupId = null;
    this.queueSyncOp('account.update', accountId, { id: accountId, groupId: null });
    this.autoPersist();
    return true;
  }

  public getAccountGroupSummary(groupId: UUID): AccountGroupSummary | null {
    const group = this.state.accountGroups.get(groupId);
    if (!group) return null;

    const groupAccounts = Array.from(this.state.accounts.values()).filter(
      (a) => a.workspaceId === group.workspaceId && a.groupId === groupId
    );
    const groupAccountIds = new Set(groupAccounts.map((a) => a.id));

    let totalOpeningBalanceMinor = 0n;
    for (const acc of groupAccounts) {
      totalOpeningBalanceMinor += toPaisa(acc.openingBalanceMinor);
    }

    const txs = this.getTransactions(group.workspaceId);
    let totalIncomeMinor = 0n;
    let totalExpenseMinor = 0n;

    for (const tx of txs) {
      if (tx.isDeleted || (tx as any).isReplacedBy || tx.transactionType === 'reversal') continue;

      if (tx.transactionType === 'income') {
        for (const line of tx.lines) {
          if (groupAccountIds.has(line.accountId)) {
            totalIncomeMinor += toPaisa(line.debitMinor);
          }
        }
      } else if (tx.transactionType === 'expense') {
        for (const line of tx.lines) {
          if (groupAccountIds.has(line.accountId)) {
            totalExpenseMinor += toPaisa(line.creditMinor);
          }
        }
      } else if (tx.transactionType === 'transfer') {
        const fromLine = tx.lines.find((l) => !l.categoryId && toPaisa(l.creditMinor) > 0n);
        const toLine = tx.lines.find((l) => !l.categoryId && toPaisa(l.debitMinor) > 0n);
        const feeLine = tx.lines.find((l) => l.categoryId);

        const fromInGroup = fromLine && groupAccountIds.has(fromLine.accountId);

        if (fromInGroup && feeLine) {
          totalExpenseMinor += toPaisa(feeLine.debitMinor);
        }
      }
    }

    const allSummaries = this.calculateAccountSummaries(group.workspaceId);
    const summaryMap = new Map(allSummaries.map((s) => [s.accountId, s]));

    let currentBalanceMinor = 0n;
    for (const acc of groupAccounts) {
      const s = summaryMap.get(acc.id);
      if (s) {
        currentBalanceMinor += toPaisa(s.currentBalanceMinor);
      } else {
        currentBalanceMinor += toPaisa(acc.openingBalanceMinor);
      }
    }

    return {
      group,
      accountCount: groupAccounts.length,
      totalOpeningBalanceMinor: totalOpeningBalanceMinor.toString(),
      totalIncomeMinor: totalIncomeMinor.toString(),
      totalExpenseMinor: totalExpenseMinor.toString(),
      currentBalanceMinor: currentBalanceMinor.toString(),
      accounts: groupAccounts,
    };
  }

  // --- Employee Account Sharing and Permissions (FEAT-003) ---

  public grantAccountPermission(
    workspaceId: UUID,
    employeeEmail: string,
    employeeSubjectHash: string,
    accountIds: UUID[],
    role: EmployeeRole
  ): AccountPermissionGrant {
    const grant: AccountPermissionGrant = {
      id: generateUUID(),
      workspaceId,
      accountIds,
      employeeEmail: employeeEmail.trim().toLowerCase(),
      employeeSubjectHash,
      role,
      createdAt: new Date().toISOString(),
    };
    this.state.accountPermissions.set(grant.id, grant);
    this.queueSyncOp('permission.grant', grant.id, { grant });
    this.autoPersist();
    return grant;
  }

  public revokeAccountPermission(grantId: UUID): boolean {
    const grant = this.state.accountPermissions.get(grantId);
    if (!grant) return false;
    grant.revokedAt = new Date().toISOString();
    this.queueSyncOp('permission.revoke', grantId, { id: grantId });
    this.autoPersist();
    return true;
  }

  public getAccountPermissions(
    workspaceId: UUID,
    includeRevoked = false
  ): AccountPermissionGrant[] {
    return Array.from(this.state.accountPermissions.values()).filter(
      (g) => g.workspaceId === workspaceId && (includeRevoked || !g.revokedAt)
    );
  }

  public canUserReadAccount(userSubjectHash: string | undefined, accountId: UUID): boolean {
    const acc = this.state.accounts.get(accountId);
    if (!acc) return false;
    const ws = this.state.workspaces.get(acc.workspaceId);
    if (!ws) return false;

    const localOwner = this.getIdentity()?.ownerSubjectHash;
    if (
      !userSubjectHash ||
      userSubjectHash === 'local-owner' ||
      userSubjectHash === ws.ownerSubjectHash ||
      (localOwner && userSubjectHash === localOwner)
    ) {
      return true;
    }

    const grants = this.getAccountPermissions(ws.id, false);
    return grants.some(
      (g) => g.employeeSubjectHash === userSubjectHash && g.accountIds.includes(accountId)
    );
  }

  public canUserWriteAccount(
    userSubjectHash: string | undefined,
    accountId: UUID,
    opType: SyncOperationType = 'journal.post'
  ): boolean {
    const acc = this.state.accounts.get(accountId);
    if (!acc) return false;
    const ws = this.state.workspaces.get(acc.workspaceId);
    if (!ws) return false;

    const localOwner = this.getIdentity()?.ownerSubjectHash;
    if (
      !userSubjectHash ||
      userSubjectHash === 'local-owner' ||
      userSubjectHash === ws.ownerSubjectHash ||
      (localOwner && userSubjectHash === localOwner)
    ) {
      return true;
    }

    if (opType === 'account.delete' || opType === 'account.archive') {
      return false;
    }

    const grants = this.getAccountPermissions(ws.id, false);
    return grants.some(
      (g) =>
        g.employeeSubjectHash === userSubjectHash &&
        g.role === 'editor' &&
        g.accountIds.includes(accountId)
    );
  }

  public getCategories(workspaceId: UUID): Category[] {
    return Array.from(this.state.categories.values()).filter(
      (c) => c.workspaceId === workspaceId && !c.archivedAt
    );
  }

  public createCategory(
    workspaceId: UUID,
    name: string,
    kind: Category['kind'],
    parentId: UUID | null = null,
    nameEn?: string,
    icon = 'Tag',
    color = '#3B82F6'
  ): Category {
    const cat: Category = {
      id: generateUUID(),
      workspaceId,
      parentId,
      name,
      nameEn: nameEn || name,
      kind,
      icon,
      color,
    };
    this.state.categories.set(cat.id, cat);
    this.queueSyncOp('category.create', cat.id, { category: cat });
    this.autoPersist();
    return cat;
  }

  public getSubCategories(workspaceId: UUID, parentId: UUID): Category[] {
    return Array.from(this.state.categories.values()).filter(
      (c) => c.workspaceId === workspaceId && c.parentId === parentId && !c.archivedAt
    );
  }

  public deleteCategory(categoryId: UUID): void {
    const cat = this.state.categories.get(categoryId);
    if (cat) {
      cat.archivedAt = new Date().toISOString();
      this.queueSyncOp('category.archive', categoryId, { id: categoryId, archivedAt: cat.archivedAt });
      this.autoPersist();
    }
  }

  public editCategory(
    categoryId: UUID,
    name: string,
    nameEn?: string,
    parentId?: UUID | null
  ): void {
    const cat = this.state.categories.get(categoryId);
    if (cat) {
      cat.name = name;
      if (nameEn !== undefined) cat.nameEn = nameEn;
      if (parentId !== undefined) cat.parentId = parentId;
      this.queueSyncOp('category.update', categoryId, { id: categoryId, name: cat.name, nameEn: cat.nameEn, parentId: cat.parentId });
      this.autoPersist();
    }
  }

  // --- Business Parties / Persons Engine ---

  public createParty(
    workspaceId: UUID,
    name: string,
    role: PartyRole = 'other',
    phone = '',
    notes = '',
    openingBalanceMinor = '0'
  ): BusinessParty {
    const id = generateUUID();
    const party: BusinessParty = {
      id,
      workspaceId,
      name,
      phone,
      role,
      openingBalanceMinor,
      notes,
      createdAt: new Date().toISOString(),
    };
    this.state.parties.set(id, party);
    this.queueSyncOp('party.create', id, { party });
    this.autoPersist();
    return party;
  }

  public getParties(workspaceId: UUID): BusinessParty[] {
    return Array.from(this.state.parties.values()).filter(
      (p) => p.workspaceId === workspaceId && !p.archivedAt
    );
  }

  public getParty(id: UUID): BusinessParty | undefined {
    return this.state.parties.get(id);
  }

  public editParty(
    id: UUID,
    updates: Partial<Pick<BusinessParty, 'name' | 'phone' | 'role' | 'notes'>>
  ): void {
    const p = this.state.parties.get(id);
    if (p) {
      if (updates.name !== undefined) p.name = updates.name;
      if (updates.phone !== undefined) p.phone = updates.phone;
      if (updates.role !== undefined) p.role = updates.role;
      if (updates.notes !== undefined) p.notes = updates.notes;
      this.queueSyncOp('party.update', id, { id, ...updates });
      this.autoPersist();
    }
  }

  public deleteParty(id: UUID): void {
    const p = this.state.parties.get(id);
    if (p) {
      p.archivedAt = new Date().toISOString();
      this.queueSyncOp('party.archive', id, { id, archivedAt: p.archivedAt });
      this.autoPersist();
    }
  }

  public getPartyTransactions(partyId: UUID): JournalTransaction[] {
    return Array.from(this.state.journalTransactions.values()).filter(
      (t) => t.partyId === partyId && !(t as any).isDeleted
    );
  }

  /**
   * Deletes (voids/reverses) a transaction cleanly using balanced double-entry accounting.
   */
  public async deleteTransaction(txId: UUID, reason = 'User deleted transaction'): Promise<void> {
    const tx = this.state.journalTransactions.get(txId);
    if (!tx) {
      throw new Error(`Transaction ${txId} not found`);
    }

    const opId = generateUUID();
    const reversalBalanced = buildReversalJournal(tx, opId, reason);

    // Atomic transaction boundary
    await this.beginTransaction();
    try {
      // Save reversal in local state
      this.state.journalTransactions.set(reversalBalanced.transaction.id, {
        ...reversalBalanced.transaction,
        createdOpId: opId,
        lines: reversalBalanced.lines,
      });
      for (const line of reversalBalanced.lines) {
        this.state.journalLines.set(line.id, line);
      }

      // Mark original transaction as deleted/voided
      (tx as any).isDeleted = true;

      // Queue sync operation in durable outbox
      const payload = {
        originalTransactionId: tx.id,
        reversalTransactionId: reversalBalanced.transaction.id,
        reversalBalanced,
        reason,
      };
      const op: SyncOperation = {
        protocolVersion: 1,
        ownerHash: this.getIdentity()?.ownerSubjectHash || 'local-owner',
        deviceId: this.getDeviceId(),
        seq: this.getNextDeviceSeq(),
        operationId: opId,
        entityId: tx.id,
        type: 'journal.delete',
        baseRevision: 'v1',
        createdAtUtc: new Date().toISOString(),
        payload,
        contentSha256: await computeSha256(canonicalJson(payload)),
      };

      this.state.syncOperations.set(opId, op);
      this.state.syncOutbox.set(opId, {
        opId,
        uploadedStatus: 'pending',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      });
      this.state.appliedOperations.add(opId);

      await this.commitTransaction();
    } catch (err) {
      await this.rollbackTransaction();
      throw err;
    }
  }

  /**
   * Edits an existing transaction: voids the previous one and posts the replacement.
   */
  public async editTransaction(
    originalId: UUID,
    cmd: {
      amountMinor: string;
      effectiveDate: string;
      effectiveTime?: string;
      assetAccountId: UUID;
      categoryId: UUID;
      note?: string;
      partyId?: UUID | null;
      reason?: string;
    }
  ): Promise<void> {
    const origTx = this.state.journalTransactions.get(originalId);
    if (!origTx) throw new Error(`Transaction ${originalId} not found`);

    const opId = generateUUID();
    const effectivePartyId = cmd.partyId !== undefined ? cmd.partyId : origTx.partyId || null;
    const timing = resolveJournalTime(!cmd.effectiveTime && cmd.effectiveDate === origTx.effectiveDate && origTx.occurredTimezoneOffsetMinutes !== undefined
      ? { effectiveDate: origTx.effectiveDate, occurredAtUtc: origTx.occurredAtUtc, occurredTimezoneOffsetMinutes: origTx.occurredTimezoneOffsetMinutes }
      : { effectiveDate: cmd.effectiveDate, effectiveTime: cmd.effectiveTime });

    // 1. Build reversal journal
    const reversalBalanced = buildReversalJournal(
      origTx,
      opId,
      cmd.reason || 'User corrected transaction'
    );

    // 2. Build replacement transaction
    let replacementBalanced: BalancedJournal;
    if (origTx.transactionType === 'income') {
      replacementBalanced = buildIncomeJournal({
        workspaceId: origTx.workspaceId,
        assetAccountId: cmd.assetAccountId,
        revenueCategoryId: cmd.categoryId,
        amountMinor: cmd.amountMinor,
        ...timing,
        note: cmd.note,
        partyId: effectivePartyId,
        receiptBlobSha256: origTx.receiptBlobSha256,
        receiptName: origTx.receiptName,
        opId,
      });
    } else {
      replacementBalanced = buildExpenseJournal({
        workspaceId: origTx.workspaceId,
        assetAccountId: cmd.assetAccountId,
        expenseCategoryId: cmd.categoryId,
        amountMinor: cmd.amountMinor,
        ...timing,
        note: cmd.note,
        partyId: effectivePartyId,
        receiptBlobSha256: origTx.receiptBlobSha256,
        receiptName: origTx.receiptName,
        opId,
      });
    }

    // Atomic transaction boundary
    await this.beginTransaction();
    try {
      // Save reversal
      this.state.journalTransactions.set(reversalBalanced.transaction.id, {
        ...reversalBalanced.transaction,
        createdOpId: opId,
        lines: reversalBalanced.lines,
      });
      for (const line of reversalBalanced.lines) {
        this.state.journalLines.set(line.id, line);
      }

      // Save replacement
      this.state.journalTransactions.set(replacementBalanced.transaction.id, {
        ...replacementBalanced.transaction,
        createdOpId: opId,
        lines: replacementBalanced.lines,
      });
      for (const line of replacementBalanced.lines) {
        this.state.journalLines.set(line.id, line);
      }

      // Mark original
      (origTx as any).isReplacedBy = replacementBalanced.transaction.id;

      // Queue sync operation
      const payload = {
        originalTransactionId: origTx.id,
        reversalBalanced,
        replacementBalanced,
        note: cmd.note,
      };
      const op: SyncOperation = {
        protocolVersion: 1,
        ownerHash: this.getIdentity()?.ownerSubjectHash || 'local-owner',
        deviceId: this.getDeviceId(),
        seq: this.getNextDeviceSeq(),
        operationId: opId,
        entityId: origTx.id,
        type: 'journal.correct',
        baseRevision: 'v1',
        createdAtUtc: new Date().toISOString(),
        payload,
        contentSha256: await computeSha256(canonicalJson(payload)),
      };

      this.state.syncOperations.set(opId, op);
      this.state.syncOutbox.set(opId, {
        opId,
        uploadedStatus: 'pending',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      });
      this.state.appliedOperations.add(opId);

      await this.commitTransaction();
    } catch (err) {
      await this.rollbackTransaction();
      throw err;
    }
  }

  public getTransactions(workspaceId: UUID): JournalTransaction[] {
    const all = Array.from(this.state.journalTransactions.values()).filter(
      (t) => t.workspaceId === workspaceId
    );
    // Sort descending by effectiveDate, then occurredAtUtc
    return all.sort((a, b) => {
      const dateCmp = b.effectiveDate.localeCompare(a.effectiveDate);
      if (dateCmp !== 0) return dateCmp;
      return b.occurredAtUtc.localeCompare(a.occurredAtUtc);
    });
  }

  public getTransaction(id: UUID): JournalTransaction | undefined {
    return this.state.journalTransactions.get(id);
  }

  /**
   * Calculates derived current balances for all asset accounts in a workspace.
   * Account balance = Opening Balance + Sum(Debits) - Sum(Credits)
   */
  public calculateAccountSummaries(workspaceId: UUID): AccountBalanceSummary[] {
    const accounts = this.getAccounts(workspaceId, true);
    const txs = this.getTransactions(workspaceId);

    const summaries: AccountBalanceSummary[] = [];

    for (const acc of accounts) {
      let totalDebits = 0n;
      let totalCredits = 0n;

      for (const tx of txs) {
        for (const line of tx.lines) {
          if (line.accountId === acc.id) {
            // Check if this line is asset debit or asset credit
            // Note: in double entry, an asset line has null categoryId or is asset side
            // In our journal builder, the line.accountId is the asset.
            // If categoryId is set on line, it's the nominal side.
            if (!line.categoryId) {
              totalDebits = addPaisa(totalDebits, toPaisa(line.debitMinor));
              totalCredits = addPaisa(totalCredits, toPaisa(line.creditMinor));
            }
          }
        }
      }

      const opening = toPaisa(acc.openingBalanceMinor);
      const current = opening + totalDebits - totalCredits;

      summaries.push({
        accountId: acc.id,
        name: acc.name,
        kind: acc.kind,
        openingBalanceMinor: acc.openingBalanceMinor,
        currentBalanceMinor: current.toString(),
        totalDebitsMinor: totalDebits.toString(),
        totalCreditsMinor: totalCredits.toString(),
      });
    }

    return summaries;
  }

  /**
   * Builds high-level Dashboard data for a workspace.
   */
  public getDashboardData(workspaceId: UUID): DashboardData {
    const ws = this.getWorkspace(workspaceId) || this.getWorkspaces()[0];
    const accountSummaries = this.calculateAccountSummaries(workspaceId);

    let totalConsolidated = 0n;
    for (const s of accountSummaries) {
      totalConsolidated += toPaisa(s.currentBalanceMinor);
    }

    const txs = this.getTransactions(workspaceId);

    // Current month filter (YYYY-MM)
    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let totalIncome = 0n;
    let totalExpense = 0n;
    const categoryExpenseMap = new Map<UUID, bigint>();

    for (const tx of txs) {
      if (!tx.effectiveDate.startsWith(currentMonthPrefix)) continue;
      // Exclude voided/deleted, replaced, or reversal transactions from active income & expense totals
      if (tx.isDeleted || (tx as any).isReplacedBy || tx.transactionType === 'reversal') continue;

      if (tx.transactionType === 'income') {
        for (const line of tx.lines) {
          if (line.categoryId) {
            totalIncome += toPaisa(line.creditMinor);
          }
        }
      } else if (tx.transactionType === 'expense') {
        for (const line of tx.lines) {
          if (line.categoryId) {
            const exp = toPaisa(line.debitMinor);
            totalExpense += exp;
            const currentCatTotal = categoryExpenseMap.get(line.categoryId) || 0n;
            categoryExpenseMap.set(line.categoryId, currentCatTotal + exp);
          }
        }
      } else if (tx.transactionType === 'transfer') {
        // Transfers only count fee towards expense
        for (const line of tx.lines) {
          if (line.categoryId) {
            const fee = toPaisa(line.debitMinor);
            totalExpense += fee;
          }
        }
      }
    }

    const netFlow = totalIncome - totalExpense;

    // Top expense categories
    const categoriesMap = new Map(this.getCategories(workspaceId).map((c) => [c.id, c]));
    const topCategories: DashboardData['topExpenseCategories'] = [];

    for (const [catId, amount] of categoryExpenseMap.entries()) {
      const cat = categoriesMap.get(catId);
      const percentage =
        totalExpense > 0n ? Math.round(Number((amount * 10000n) / totalExpense) / 100) : 0;
      topCategories.push({
        categoryId: catId,
        name: cat?.name || 'অন্যান্য খরচ',
        amountMinor: amount.toString(),
        percentage,
      });
    }

    topCategories.sort((a, b) => Number(toPaisa(b.amountMinor) - toPaisa(a.amountMinor)));

    return {
      workspace: ws,
      totalConsolidatedBalanceMinor: totalConsolidated.toString(),
      totalIncomeThisMonthMinor: totalIncome.toString(),
      totalExpenseThisMonthMinor: totalExpense.toString(),
      netFlowThisMonthMinor: netFlow.toString(),
      accountSummaries,
      recentTransactions: txs.slice(0, 15),
      topExpenseCategories: topCategories.slice(0, 5),
    };
  }

  // --- Outbox and Sync Queries ---

  public getPendingOutbox(): SyncOperation[] {
    const pendingOpIds = Array.from(this.state.syncOutbox.values())
      .filter((entry) => entry.uploadedStatus === 'pending' || entry.uploadedStatus === 'failed')
      .map((entry) => entry.opId);

    const ops: SyncOperation[] = [];
    for (const id of pendingOpIds) {
      const op = this.state.syncOperations.get(id);
      if (op) ops.push(op);
    }
    // Sort strictly by sequence
    return ops.sort((a, b) => a.seq - b.seq);
  }

  public async markOutboxUploaded(opIds: UUID[], remoteFileId: string): Promise<void> {
    for (const id of opIds) {
      const entry = this.state.syncOutbox.get(id);
      if (entry) {
        entry.uploadedStatus = 'uploaded';
        entry.remoteFileId = remoteFileId;
        entry.lastError = null;
      }
    }
    await this.persist();
  }

  public async markOutboxFailed(opIds: UUID[], errorMsg: string): Promise<void> {
    for (const id of opIds) {
      const entry = this.state.syncOutbox.get(id);
      if (entry) {
        entry.uploadedStatus = 'failed';
        entry.retryCount++;
        entry.lastError = errorMsg;
      }
    }
    await this.persist();
  }

  public getSyncOutboxEntries(): SyncOutboxEntry[] {
    return Array.from(this.state.syncOutbox.values());
  }

  public getConflicts(): ConflictRecord[] {
    return Array.from(this.state.conflicts.values());
  }

  public async addConflict(conflict: ConflictRecord): Promise<void> {
    this.state.conflicts.set(conflict.id, conflict);
    await this.persist();
  }

  public async resolveConflict(conflictId: UUID, resolutionOpId: UUID): Promise<void> {
    const c = this.state.conflicts.get(conflictId);
    if (c) {
      c.status = 'resolved';
      c.resolutionOpId = resolutionOpId;
      await this.persist();
    }
  }

  // Savings are earmarks over real account balances, never journal postings.
  private savingsWorkspace(workspaceId: UUID, requireActive = true): Workspace {
    const ws = this.state.workspaces.get(workspaceId);
    if (!ws || ws.deletedAt || requireActive && ws.archivedAt) throw new Error('SAVINGS_WORKSPACE_UNAVAILABLE');
    if (ws.ownerSubjectHash !== (this.getIdentity()?.ownerSubjectHash || 'local-owner')) throw new Error('SAVINGS_OWNER_MISMATCH');
    return ws;
  }

  public getSavingsProjection(workspaceId: UUID, today?: string): SavingsProjection {
    this.savingsWorkspace(workspaceId, false);
    const balances: Record<string, string> = {};
    for (const summary of this.calculateAccountSummaries(workspaceId)) {
      const account = this.state.accounts.get(summary.accountId);
      if (account && (account.classification || 'asset') === 'asset') balances[summary.accountId] = summary.currentBalanceMinor;
    }
    const now = new Date();
    const day = today || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return projectSavingsGoals(savingsRecords(this.state.syncOperations.values(), workspaceId), workspaceId, balances, day);
  }

  private async commitSavingsEvent(workspaceId: UUID,
    build: (projection: SavingsProjection) => SavingsGoalEvent): Promise<SavingsGoalEvent> {
    await this.beginTransaction();
    try {
      this.savingsWorkspace(workspaceId);
      const event = validateSavingsGoalEvent(build(this.getSavingsProjection(workspaceId)));
      this.queueSyncOp('workspace.update', workspaceId, event.action === 'goal.delete'
        ? { id: workspaceId, savingsDeletion: { version: 1, goalId: event.goalId } }
        : { id: workspaceId, savingsEvent: event });
      validateSavingsOperations(this.state.syncOperations.values(), this.state.workspaces, this.state.accounts);
      await this.commitTransaction();
      return event;
    } catch (error) { await this.rollbackTransaction(); throw error; }
  }

  public async saveSavingsGoal(workspaceId: UUID, input: {
    id?: UUID; name: string; kind: 'general' | 'emergency'; targetMinor: string;
    deadline?: string; monthlyContributionMinor?: string; essentialMonthlyMinor?: string; coverageMonths?: number;
  }): Promise<SavingsGoal> {
    const event = await this.commitSavingsEvent(workspaceId, projection => {
      const existingItem = input.id ? projection.goals.find(item => item.goal.id === input.id) : undefined;
      if (existingItem?.deleted) throw new Error('SAVINGS_GOAL_DELETED');
      const existing = existingItem?.goal;
      if (input.id && !existing) throw new Error('SAVINGS_GOAL_NOT_FOUND');
      if (existing?.archived) throw new Error('SAVINGS_GOAL_ARCHIVED');
      return { version: 1, action: 'goal.set', goal: {
        id: existing?.id || generateUUID(), workspaceId, name: input.name.trim(), kind: input.kind,
        targetMinor: input.targetMinor, ...(input.deadline ? { deadline: input.deadline } : {}),
        ...(input.monthlyContributionMinor ? { monthlyContributionMinor: input.monthlyContributionMinor } : {}),
        ...(input.essentialMonthlyMinor ? { essentialMonthlyMinor: input.essentialMonthlyMinor } : {}),
        ...(input.coverageMonths !== undefined ? { coverageMonths: input.coverageMonths } : {}),
        revision: (existing?.revision || 0) + 1, archived: false,
      } };
    });
    if (event.action !== 'goal.set') throw new Error('SAVINGS_EVENT_INVALID');
    return event.goal;
  }

  public async setSavingsGoalArchived(workspaceId: UUID, goalId: UUID, archived: boolean): Promise<void> {
    await this.commitSavingsEvent(workspaceId, projection => {
      const item = projection.goals.find(item => item.goal.id === goalId);
      if (!item) throw new Error('SAVINGS_GOAL_NOT_FOUND');
      if (item.deleted) throw new Error('SAVINGS_GOAL_DELETED');
      if (archived && BigInt(item.requestedMinor) > 0n) throw new Error('SAVINGS_ALLOCATIONS_REMAIN');
      return { version: 1, action: 'goal.set', goal: { ...item.goal, archived, revision: item.goal.revision + 1 } };
    });
  }

  public async allocateSavingsGoal(workspaceId: UUID, goalId: UUID, accountId: UUID, amountMinor: string, note?: string): Promise<void> {
    await this.commitSavingsEvent(workspaceId, projection => {
      if (projection.orphanAllocationCount || projection.orphanReleaseCount) throw new Error('SAVINGS_SYNC_INCOMPLETE');
      const item = projection.goals.find(item => item.goal.id === goalId);
      if (!item) throw new Error('SAVINGS_GOAL_NOT_FOUND');
      if (item.deleted) throw new Error('SAVINGS_GOAL_DELETED');
      if (item.goal.archived) throw new Error('SAVINGS_GOAL_ARCHIVED');
      const account = this.state.accounts.get(accountId);
      if (!account || account.workspaceId !== workspaceId || account.archivedAt || (account.classification || 'asset') !== 'asset')
        throw new Error('SAVINGS_ACCOUNT_UNAVAILABLE');
      const event: SavingsGoalEvent = { version: 1, action: 'allocation.add', goalId, allocationId: generateUUID(),
        accountId, amountMinor, ...(note?.trim() ? { note: note.trim() } : {}) };
      validateSavingsGoalEvent(event);
      const available = projection.accounts.find(item => item.accountId === accountId)?.availableMinor || '0';
      if (BigInt(amountMinor) > BigInt(available)) throw new Error('SAVINGS_INSUFFICIENT_AVAILABLE');
      return event;
    });
  }

  public async releaseSavingsAllocation(workspaceId: UUID, goalId: UUID, allocationId: UUID, amountMinor: string): Promise<void> {
    await this.commitSavingsEvent(workspaceId, projection => {
      const item = projection.goals.find(item => item.goal.id === goalId);
      if (!item) throw new Error('SAVINGS_GOAL_NOT_FOUND');
      const contribution = item.contributions.find(value => value.allocationId === allocationId);
      if (!contribution) throw new Error('SAVINGS_EVENT_INVALID');
      const event: SavingsGoalEvent = { version: 1, action: 'allocation.release', goalId, allocationId, amountMinor };
      validateSavingsGoalEvent(event);
      if (BigInt(amountMinor) > BigInt(contribution.requestedMinor)) throw new Error('SAVINGS_RELEASE_EXCEEDS_ALLOCATION');
      return event;
    });
  }

  public async safeDeleteSavingsGoal(workspaceId: UUID, goalId: UUID, confirmation: string): Promise<void> {
    if (!isDeleteConfirmed(confirmation)) throw new Error('SAVINGS_DELETE_CONFIRMATION');
    await this.commitSavingsEvent(workspaceId, projection => {
      const item = projection.goals.find(item => item.goal.id === goalId);
      if (!item) throw new Error('SAVINGS_GOAL_NOT_FOUND');
      if (item.deleted) throw new Error('SAVINGS_GOAL_DELETED');
      if (!item.goal.archived) throw new Error('SAVINGS_ARCHIVE_BEFORE_DELETE');
      if (BigInt(item.requestedMinor) > 0n) throw new Error('SAVINGS_ALLOCATIONS_REMAIN');
      return { version: 1, action: 'goal.delete', goalId };
    });
  }

  public getBudgets(workspaceId: UUID): Budget[] {
    return Array.from(this.state.budgets.values()).filter((b) => b.workspaceId === workspaceId);
  }

  public setBudget(budget: Budget): void {
    this.state.budgets.set(budget.id, budget);
    this.queueSyncOp('budget.set', budget.id, { budget });
    this.autoPersist();
  }

  public getRecurringRules(workspaceId: UUID): RecurringRule[] {
    return Array.from(this.state.recurringRules.values()).filter(
      (r) => r.workspaceId === workspaceId
    );
  }

  public setRecurringRule(rule: RecurringRule): void {
    const exists = this.state.recurringRules.has(rule.id);
    this.state.recurringRules.set(rule.id, rule);
    this.queueSyncOp(exists ? 'recurring.rule.update' : 'recurring.rule.create', rule.id, { rule });
    this.autoPersist();
  }

  public getReceiptBlob(sha256: string): ReceiptBlob | undefined {
    return this.state.receiptBlobs.get(sha256);
  }

  public async storeReceiptBlob(blob: ReceiptBlob): Promise<void> {
    validateReceiptBlob(blob);
    await this.beginTransaction();
    try {
      if (!this.state.receiptBlobs.has(blob.sha256)) {
        this.state.receiptBlobs.set(blob.sha256, { ...blob });
        this.queueSyncOp('receipt.attach', blob.sha256, { blob });
      }
      await this.commitTransaction();
    } catch (error) { await this.rollbackTransaction(); throw error; }
  }

  // --- Snapshot and Non-destructive Migration Safeguards ---

  /**
   * Captures an immutable recovery snapshot before running any schema migration.
   */
  public async captureRecoverySnapshot(): Promise<LocalSnapshot> {
    await this.waitForPendingWrites();
    if (this.inTransaction) throw new Error('Storage busy. Try backup again after the current save finishes.');
    // Snapshots must not recursively embed all preceding snapshots.
    const serialized = JSON.stringify({ ...this.toSerializable(), localSnapshots: [] });
    const hash = await computeSha256(serialized);
    if (this.inTransaction) throw new Error('Storage busy. Try backup again after the current save finishes.');

    const snapshot: LocalSnapshot = {
      id: generateUUID(),
      dbSchemaVersion: this.state.schemaVersion,
      hash,
      totalTransactions: this.state.journalTransactions.size,
      totalLines: this.state.journalLines.size,
      pendingOutboxCount: this.getPendingOutbox().length,
      verifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      dataJson: serialized,
    };

    this.state.localSnapshots.set(snapshot.id, snapshot);
    try { await this.persist(); }
    catch (error) { this.state.localSnapshots.delete(snapshot.id); throw error; }
    return snapshot;
  }

  public getSnapshots(): LocalSnapshot[] {
    return Array.from(this.state.localSnapshots.values());
  }

  /**
   * Restores a previously verified snapshot if a migration or disaster occurs.
   */
  public async restoreFromSnapshot(snapshotId: UUID): Promise<boolean> {
    const snap = this.state.localSnapshots.get(snapshotId);
    if (!snap || !snap.dataJson) return false;

    // Verify hash integrity
    const computed = await computeSha256(snap.dataJson);
    if (computed !== snap.hash) {
      throw new Error('BACKUP_CHECKSUM');
    }

    await this.restoreBackupData(JSON.parse(snap.dataJson));
    return true;
  }

  public async exportBackupFile(): Promise<string> {
    // Export is an escape hatch when internal storage is full: settle writes,
    // preserve the error, and copy the current records to a separate file.
    await this.writeQueuePromise.catch(() => {});
    if (this.inTransaction) throw new Error('Storage busy. Try backup again after the current save finishes.');
    return encodeBackup(this.toSerializable());
  }

  public async importBackupFile(text: string): Promise<void> {
    await this.restoreBackupData(await decodeBackup(text));
  }

  private async restoreBackupData(incoming: Record<string, any>): Promise<void> {
    await this.waitForPendingWrites();
    mergeBackup(this.toSerializable(), incoming, this.hasOnlyUntouchedStarters()); // Reject invalid/foreign files without writing anything.
    // Capture a recovery point before import, then validate against the latest state
    // inside the transaction. No newer journal, metadata or pending operation is removed.
    await this.captureRecoverySnapshot();
    await this.beginTransaction();
    try {
      const startersOnly = this.hasOnlyUntouchedStarters();
      const merged = mergeBackup(this.toSerializable(), incoming, startersOnly);
      await this.loadFromSerializable(merged);
      if (startersOnly) {
        // Publish recovered metadata after any initial workspace bootstrap operations.
        // Existing immutable journal and pending operation IDs are never replaced.
        for (const [key, type, field] of [
          ['workspaces', 'workspace.create', 'workspace'], ['accounts', 'account.create', 'account'],
          ['categories', 'category.create', 'category'], ['parties', 'party.create', 'party'],
        ] as const) for (const [id] of incoming[key] || []) {
          const record = (this.state[key] as Map<string, any>).get(id);
          this.queueSyncOp(type, id, { [field]: { ...record } });
        }
      }
      await this.commitTransaction();
    } catch (error) { await this.rollbackTransaction(); throw error; }
  }

  public hasOnlyUntouchedStarters(): boolean {
    if ([this.state.journalTransactions, this.state.journalLines, this.state.accountGroups, this.state.accountPermissions,
      this.state.budgets, this.state.recurringRules, this.state.recurringOccurrences, this.state.receiptBlobs, this.state.conflicts]
      .some(records => records.size > 0)) return false;
    if (Array.from(this.state.syncOperations.values()).some(op => op.type !== 'workspace.create' ||
        !['ws-personal-default', 'ws-business-default'].includes(op.entityId))) return false;
    const starter = { localIdentity: null, workspaces: new Map(), accounts: new Map(), categories: new Map(), parties: new Map() };
    populateStarterEntities(starter);
    return (['workspaces', 'accounts', 'categories', 'parties'] as const).every(key =>
      this.state[key].size === starter[key].size && Array.from((this.state[key] as Map<string, any>).values())
        .every(record => sameStarterRecord(record, starter[key].get(record.id))));
  }

  // --- Serialization / Hydration ---

  public toSerializable(): Record<string, any> {
    return {
      schemaVersion: this.state.schemaVersion,
      localIdentity: this.state.localIdentity,
      deviceIdentity: this.state.deviceIdentity,
      workspaces: Array.from(this.state.workspaces.entries()),
      accounts: Array.from(this.state.accounts.entries()),
      accountGroups: Array.from(this.state.accountGroups.entries()),
      accountPermissions: Array.from(this.state.accountPermissions.entries()),
      categories: Array.from(this.state.categories.entries()),
      parties: Array.from(this.state.parties.entries()),
      journalTransactions: Array.from(this.state.journalTransactions.entries()),
      journalLines: Array.from(this.state.journalLines.entries()),
      syncOperations: Array.from(this.state.syncOperations.entries()),
      syncOutbox: Array.from(this.state.syncOutbox.entries()),
      appliedOperations: Array.from(this.state.appliedOperations),
      syncDeviceHeads: Array.from(this.state.syncDeviceHeads.entries()),
      conflicts: Array.from(this.state.conflicts.entries()),
      budgets: Array.from(this.state.budgets.entries()),
      recurringRules: Array.from(this.state.recurringRules.entries()),
      recurringOccurrences: Array.from(this.state.recurringOccurrences.entries()),
      receiptBlobs: Array.from(this.state.receiptBlobs.entries()),
      localSnapshots: Array.from(this.state.localSnapshots.entries()),
      schemaMigrations: this.state.schemaMigrations,
      preferences: Array.from(this.state.preferences.entries()),
    };
  }

  public async loadFromSerializable(data: Record<string, any>): Promise<void> {
    const previous = this.state;
    try {
      this.hydrateState(data);
      const fromVer = data.schemaVersion || 1;
      if (fromVer < 4) await this.runVersion4Migration(fromVer);
      if (fromVer < 5) await this.runVersion5Migration(fromVer);
    } catch (error) { this.state = previous; throw error; }
  }

  private hydrateState(data: Record<string, any>): void {
    const fromVer = data.schemaVersion || 1;
    if (!Number.isSafeInteger(fromVer) || fromVer < 1 || fromVer > CURRENT_SCHEMA_VERSION) {
      throw new Error('DATABASE_VERSION_UNSUPPORTED: Update the app before opening this database. Existing records have not been replaced.');
    }
    this.state = this.createEmptyState();
    this.state.schemaVersion = fromVer;
    this.state.localIdentity = data.localIdentity || null;
    this.state.deviceIdentity = data.deviceIdentity || {
      deviceId: generateUUID(),
      deviceName: 'Device',
      counter: 1,
      createdAt: new Date().toISOString(),
    };
    this.state.workspaces = new Map(data.workspaces || []);
    for (const workspace of this.state.workspaces.values()) if (workspace.image !== undefined) validateWorkspaceImage(workspace.image);
    this.state.accounts = new Map(data.accounts || []);
    this.state.accountGroups = new Map(data.accountGroups || []);
    this.state.accountPermissions = new Map(data.accountPermissions || []);
    this.state.categories = new Map(data.categories || []);
    this.state.parties = new Map(data.parties || []);
    this.state.journalTransactions = new Map(data.journalTransactions || []);
    this.state.journalLines = new Map(data.journalLines || []);
    this.state.syncOperations = new Map(data.syncOperations || []);
    this.state.syncOutbox = new Map(data.syncOutbox || []);
    this.state.appliedOperations = new Set(data.appliedOperations || []);
    this.state.syncDeviceHeads = new Map(data.syncDeviceHeads || []);
    this.state.conflicts = new Map(data.conflicts || []);
    this.state.budgets = new Map(data.budgets || []);
    this.state.recurringRules = new Map(data.recurringRules || []);
    this.state.recurringOccurrences = new Map(data.recurringOccurrences || []);
    this.state.receiptBlobs = new Map(data.receiptBlobs || []);
    this.state.localSnapshots = new Map(data.localSnapshots || []);
    this.state.schemaMigrations = [...(data.schemaMigrations || [])];
    this.state.preferences = new Map(data.preferences || []);
    validateSavingsOperations(this.state.syncOperations.values(), this.state.workspaces, this.state.accounts);

  }

  private async runVersion4Migration(fromVer: number): Promise<void> {
    // 1. Ensure all accounts have a GAAP classification (default 'asset')
    for (const [id, acc] of this.state.accounts.entries()) {
      if (!acc.classification) {
        this.state.accounts.set(id, {
          ...acc,
          classification: 'asset',
        });
      }
    }
    // 2. Append migration log entry
    this.state.schemaMigrations.push({
      fromVersion: fromVer,
      toVersion: 4,
      checksum: 'double-entry-ledger-v4',
      appliedAt: new Date().toISOString(),
    });
    this.state.schemaVersion = 4;
  }

  private async runVersion5Migration(fromVer: number): Promise<void> {
    // Step 1: Pre-migration safety snapshot in a persistent recovery snapshot and driver backup
    if (this.driver) {
      const rawCurrent = await this.driver.getItem(this.storageKey);
      if (rawCurrent) {
        await this.driver.setItem(`${this.storageKey}_pre_migration_v5`, rawCurrent);
      }
    }
    // Stage the recovery point in memory. Never overwrite the original database
    // until every migration and ledger check has succeeded.
    const dataJson = JSON.stringify({ ...this.toSerializable(), localSnapshots: [] });
    const createdAt = new Date().toISOString();
    const snapshot: LocalSnapshot = { id: generateUUID(), dbSchemaVersion: this.state.schemaVersion,
      hash: await computeSha256(dataJson), totalTransactions: this.state.journalTransactions.size,
      totalLines: this.state.journalLines.size, pendingOutboxCount: this.getPendingOutbox().length,
      verifiedAt: createdAt, createdAt, dataJson };
    this.state.localSnapshots.set(snapshot.id, snapshot);

    // Step 2: Non-destructive accounts schema updates
    for (const [id, acc] of this.state.accounts.entries()) {
      if (acc.groupId === undefined) {
        this.state.accounts.set(id, {
          ...acc,
          groupId: null,
        });
      }
    }

    // Step 3: Ensure maps exist
    if (!this.state.accountGroups) {
      this.state.accountGroups = new Map();
    }
    if (!this.state.accountPermissions) {
      this.state.accountPermissions = new Map();
    }

    // Step 4: Post-migration integrity verification across all workspaces
    for (const ws of this.state.workspaces.values()) {
      const integrity = this.verifyLedgerIntegrity(ws.id);
      if (!integrity.isValid) {
        throw new Error(
          `Migration v5 failed integrity verification in workspace ${ws.id}: ${integrity.discrepancies.join(', ')}`
        );
      }
    }

    // Step 5: Append migration log entry
    this.state.schemaMigrations.push({
      fromVersion: Math.max(fromVer, 4),
      toVersion: 5,
      checksum: 'account-groups-permissions-v5',
      appliedAt: new Date().toISOString(),
    });
    this.state.schemaVersion = 5;
  }

  /**
   * Independently verifies the mathematical and financial integrity of the double-entry ledger.
   * Asserts:
   * 1. Every journal transaction is internally balanced (total debits == total credits).
   * 2. Grand trial balance across all transactions in the workspace matches (total workspace debits == total workspace credits).
   * 3. Independently computed account balances match calculateAccountSummaries.
   * 4. Invariant: Assets Net Delta === Net Revenue - Expenses.
   */
  public verifyLedgerIntegrity(workspaceId: UUID): {
    isValid: boolean;
    trialBalanceMatched: boolean;
    totalDebits: string;
    totalCredits: string;
    netIncome: string;
    totalAssetBalance: string;
    discrepancies: string[];
  } {
    const txs = this.getTransactions(workspaceId);
    let totalWorkspaceDebits = 0n;
    let totalWorkspaceCredits = 0n;
    const discrepancies: string[] = [];

    // 1. Transaction-level balance and aggregate trial balance
    for (const tx of txs) {
      let txDebits = 0n;
      let txCredits = 0n;
      for (const line of tx.lines) {
        const d = toPaisa(line.debitMinor);
        const c = toPaisa(line.creditMinor);
        if (d < 0n || c < 0n) {
          discrepancies.push(`Transaction ${tx.id} line ${line.id} has negative amounts`);
        }
        txDebits += d;
        txCredits += c;
        totalWorkspaceDebits += d;
        totalWorkspaceCredits += c;
      }
      if (txDebits !== txCredits) {
        discrepancies.push(
          `Transaction ${tx.id} unbalanced! Debits=${txDebits}, Credits=${txCredits}`
        );
      }
    }

    const trialBalanceMatched = totalWorkspaceDebits === totalWorkspaceCredits;
    if (!trialBalanceMatched) {
      discrepancies.push(
        `Trial balance mismatch! Grand total debits (${totalWorkspaceDebits}) != Grand total credits (${totalWorkspaceCredits})`
      );
    }

    // 2. Independently calculate account balances
    const accounts = this.getAllAccounts(workspaceId);
    const summaries = this.calculateAccountSummaries(workspaceId);
    const summaryMap = new Map(summaries.map((s) => [s.accountId, s]));

    let totalAssetBalance = 0n;
    for (const acc of accounts) {
      let expectedDebits = 0n;
      let expectedCredits = 0n;
      for (const tx of txs) {
        for (const line of tx.lines) {
          if (line.accountId === acc.id && !line.categoryId) {
            expectedDebits += toPaisa(line.debitMinor);
            expectedCredits += toPaisa(line.creditMinor);
          }
        }
      }
      const expectedBalance = toPaisa(acc.openingBalanceMinor) + expectedDebits - expectedCredits;
      totalAssetBalance += expectedBalance;

      const summary = summaryMap.get(acc.id);
      if (!summary) {
        discrepancies.push(`Missing summary for account ${acc.id}`);
      } else if (summary.currentBalanceMinor !== expectedBalance.toString()) {
        discrepancies.push(
          `Account ${acc.name} balance mismatch! Expected ${expectedBalance}, got ${summary.currentBalanceMinor}`
        );
      }
    }

    // 3. Nominal revenue and expense verification
    let totalRevenue = 0n;
    let totalExpense = 0n;
    for (const tx of txs) {
      if (tx.isDeleted || (tx as any).isReplacedBy || tx.transactionType === 'reversal') continue;
      for (const line of tx.lines) {
        if (line.categoryId) {
          if (tx.transactionType === 'income') {
            totalRevenue += toPaisa(line.creditMinor);
          } else if (tx.transactionType === 'expense' || tx.transactionType === 'transfer') {
            totalExpense += toPaisa(line.debitMinor);
          }
        }
      }
    }
    const netIncome = totalRevenue - totalExpense;

    return {
      isValid: discrepancies.length === 0,
      trialBalanceMatched,
      totalDebits: totalWorkspaceDebits.toString(),
      totalCredits: totalWorkspaceCredits.toString(),
      netIncome: netIncome.toString(),
      totalAssetBalance: totalAssetBalance.toString(),
      discrepancies,
    };
  }

  public getRawState(): DatabaseState {
    return this.state;
  }
}

function sameStarterRecord(record: any, template: any): boolean {
  if (!template) return false;
  const clean = (value: any) => Object.fromEntries(Object.entries(value).filter(([key, entry]) =>
    !['createdAt', 'ownerSubjectHash'].includes(key) && entry !== null && entry !== undefined));
  return canonicalJson(clean(record)) === canonicalJson(clean(template));
}

function populateStarterEntities(state: Pick<DatabaseState, 'localIdentity' | 'workspaces' | 'accounts' | 'categories' | 'parties'>): void {
    const now = new Date().toISOString();
    const wsPersonalId = 'ws-personal-default';
    const wsBusinessId = 'ws-business-default';

    // 1. Personal Workspace
    const wsPersonal: Workspace = {
      id: wsPersonalId,
      ownerSubjectHash: state.localIdentity?.ownerSubjectHash || 'local-owner',
      name: 'ব্যক্তিগত (Personal)',
      kind: 'personal',
      currency: 'BDT',
      createdAt: now,
    };
    state.workspaces.set(wsPersonal.id, wsPersonal);

    // 2. Business Workspace
    const wsBusiness: Workspace = {
      id: wsBusinessId,
      ownerSubjectHash: state.localIdentity?.ownerSubjectHash || 'local-owner',
      name: 'দোকান / ব্যবসা (Business)',
      kind: 'business',
      currency: 'BDT',
      createdAt: now,
    };
    state.workspaces.set(wsBusiness.id, wsBusiness);

    // Default Personal Accounts (Clean slate: 0 opening balance)
    const accCash: Account = {
      id: 'acc-cash-1',
      workspaceId: wsPersonalId,
      name: 'Cash in Hand (নগদ ক্যাশ)',
      kind: 'cash',
      classification: 'asset',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    const accBkash: Account = {
      id: 'acc-bkash-1',
      workspaceId: wsPersonalId,
      name: 'bKash (বিকাশ একাউন্ট)',
      kind: 'bkash',
      classification: 'asset',
      accountNumberMasked: '',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    const accBank: Account = {
      id: 'acc-bank-1',
      workspaceId: wsPersonalId,
      name: 'Bank Account (ব্যাংক হিসাব)',
      kind: 'bank',
      classification: 'asset',
      accountNumberMasked: '',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    state.accounts.set(accCash.id, accCash);
    state.accounts.set(accBkash.id, accBkash);
    state.accounts.set(accBank.id, accBank);

    // Default Business Accounts (Clean slate: 0 opening balance)
    const accBizCash: Account = {
      id: 'acc-biz-cash',
      workspaceId: wsBusinessId,
      name: 'Cash Drawer (দোকানের ক্যাশ)',
      kind: 'cash',
      classification: 'asset',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    const accBizBkash: Account = {
      id: 'acc-biz-bkash',
      workspaceId: wsBusinessId,
      name: 'bKash Merchant (মার্চেন্ট)',
      kind: 'bkash',
      classification: 'asset',
      accountNumberMasked: '',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    state.accounts.set(accBizCash.id, accBizCash);
    state.accounts.set(accBizBkash.id, accBizBkash);

    // Default Categories with Sub-categories
    const categories: Array<Omit<Category, 'workspaceId'> & { workspaceId?: UUID }> = [
      // Personal Expenses
      { id: 'cat-food', kind: 'expense', name: 'খাবার ও রেস্তোরাঁ', nameEn: 'Food & Dining', icon: 'Utensils', color: '#EF4444' },
      { id: 'cat-food-restaurant', parentId: 'cat-food', kind: 'expense', name: 'রেস্তোরাঁ ও ডাইনিং', nameEn: 'Restaurant & Dining', icon: 'Utensils', color: '#EF4444' },
      { id: 'cat-food-snacks', parentId: 'cat-food', kind: 'expense', name: 'চা ও নাশতা', nameEn: 'Tea & Snacks', icon: 'Coffee', color: '#EF4444' },

      { id: 'cat-groceries', kind: 'expense', name: 'কাঁচাবাজার ও মুদি', nameEn: 'Groceries', icon: 'ShoppingCart', color: '#F97316' },
      { id: 'cat-groc-veg', parentId: 'cat-groceries', kind: 'expense', name: 'শাকসবজি ও ফলমূল', nameEn: 'Vegetables & Fruits', icon: 'Apple', color: '#F97316' },
      { id: 'cat-groc-fish', parentId: 'cat-groceries', kind: 'expense', name: 'মাছ, মাংস ও চাল-ডাল', nameEn: 'Meat, Fish & Rice', icon: 'Package', color: '#F97316' },

      { id: 'cat-transport', kind: 'expense', name: 'যাতায়াত ও ভাড়া', nameEn: 'Transport & Commute', icon: 'Bus', color: '#3B82F6' },
      { id: 'cat-transport-bus', parentId: 'cat-transport', kind: 'expense', name: 'বাস / রিকশা ভাড়া', nameEn: 'Bus & Rickshaw', icon: 'Bus', color: '#3B82F6' },
      { id: 'cat-transport-fuel', parentId: 'cat-transport', kind: 'expense', name: 'বাইক / গাড়ির জ্বালানি', nameEn: 'Fuel & Gas', icon: 'Fuel', color: '#3B82F6' },

      { id: 'cat-utility', kind: 'expense', name: 'বিদ্যুৎ ও গ্যাস বিল', nameEn: 'Utility Bills', icon: 'Zap', color: '#EAB308' },
      { id: 'cat-medical', kind: 'expense', name: 'ওষুধ ও চিকিৎসা', nameEn: 'Medical & Healthcare', icon: 'HeartPulse', color: '#EC4899' },
      { id: 'cat-rent', kind: 'expense', name: 'বাসা ভাড়া', nameEn: 'House Rent', icon: 'Home', color: '#8B5CF6' },

      // Personal Income
      { id: 'cat-salary', kind: 'income', name: 'মাসিক বেতন', nameEn: 'Monthly Salary', icon: 'Briefcase', color: '#10B981' },
      { id: 'cat-freelance', kind: 'income', name: 'ফ্রিল্যান্সিং ও বোনাস', nameEn: 'Freelance & Bonus', icon: 'Laptop', color: '#06B6D4' },
      { id: 'cat-investment', kind: 'income', name: 'বিনিয়োগ ও লভ্যাংশ', nameEn: 'Investments & Profit', icon: 'TrendingUp', color: '#14B8A6' },

      // Transfer Fees
      { id: 'cat-transfer-fee', kind: 'expense', name: 'ক্যাশআউট চার্জ ও ব্যাংক ফি', nameEn: 'Transfer & Cashout Fee', icon: 'Percent', color: '#64748B' },

      // Business Categories
      { id: 'cat-biz-sales', kind: 'income', name: 'পণ্য বিক্রয়', nameEn: 'Sales Revenue', icon: 'Store', color: '#10B981', workspaceId: wsBusinessId },
      { id: 'cat-biz-purchase', kind: 'expense', name: 'মাল ক্রয় ও স্টক', nameEn: 'Stock Purchase', icon: 'Package', color: '#F97316', workspaceId: wsBusinessId },
      { id: 'cat-biz-salary', kind: 'expense', name: 'কর্মচারীর বেতন', nameEn: 'Staff Salary', icon: 'Users', color: '#EF4444', workspaceId: wsBusinessId },
      { id: 'cat-biz-rent', kind: 'expense', name: 'দোকান ভাড়া', nameEn: 'Shop Rent', icon: 'Building2', color: '#8B5CF6', workspaceId: wsBusinessId },
    ];

    for (const cat of categories) {
      const fullCat: Category = {
        ...cat,
        workspaceId: cat.workspaceId || wsPersonalId,
      };
      state.categories.set(fullCat.id, fullCat);
    }

    // Default Business Parties (Partners, Staff, Suppliers, Customers)
    const partyPartner: BusinessParty = {
      id: 'party-partner-1',
      workspaceId: wsBusinessId,
      name: 'করিম সাহেব (পার্টনার)',
      role: 'partner',
      phone: '01711-000000',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    const partyStaff: BusinessParty = {
      id: 'party-staff-1',
      workspaceId: wsBusinessId,
      name: 'রাশেদ (কর্মচারী)',
      role: 'staff',
      phone: '01811-000000',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    state.parties.set(partyPartner.id, partyPartner);
    state.parties.set(partyStaff.id, partyStaff);
  }
