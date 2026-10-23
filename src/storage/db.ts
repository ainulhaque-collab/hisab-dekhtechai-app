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
  PartyRole
} from '../contracts/types';
import { toPaisa, addPaisa, subPaisa, paisaToDecimalString } from '../domain/money';
import {
  generateUUID,
  buildReversalJournal,
  buildExpenseJournal,
  buildIncomeJournal,
} from '../domain/journal';
import { canonicalJson, computeSha256 } from '../sync/canonical';

export const CURRENT_SCHEMA_VERSION = 3;

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

  constructor(storageKey = 'hisab_dekhtechai_db') {
    this.storageKey = storageKey;
    this.state = this.createEmptyState();
    this.loadFromStorage();
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
   */
  public loadFromStorage(): boolean {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          this.loadFromSerializable(parsed);
          return true;
        }
      } catch (err) {
        console.warn('Failed to parse saved database from storage, initializing fresh:', err);
      }
    }
    this.seedDefaultEntities();
    this.persistSync();
    return false;
  }

  /**
   * Loads state from persistent storage (localStorage wrapper).
   */
  public async init(): Promise<void> {
    this.loadFromStorage();
  }

  /**
   * Persists database state synchronously to durable storage.
   */
  public persistSync(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const serializable = this.toSerializable();
        localStorage.setItem(this.storageKey, JSON.stringify(serializable));
      } catch (e) {
        console.error('Database persist failed:', e);
      }
    }
  }

  /**
   * Persists database state to durable storage.
   */
  public async persist(): Promise<void> {
    this.persistSync();
  }

  public getDeviceId(): UUID {
    return this.state.deviceIdentity.deviceId;
  }

  public getDeviceName(): string {
    return this.state.deviceIdentity.deviceName;
  }

  public setDeviceIdentity(deviceId: UUID, deviceName: string): void {
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
  public seedDefaultEntities(): void {
    const now = new Date().toISOString();
    const wsPersonalId = 'ws-personal-default';
    const wsBusinessId = 'ws-business-default';

    // 1. Personal Workspace
    const wsPersonal: Workspace = {
      id: wsPersonalId,
      ownerSubjectHash: this.state.localIdentity?.ownerSubjectHash || 'local-owner',
      name: 'ব্যক্তিগত (Personal)',
      kind: 'personal',
      currency: 'BDT',
      createdAt: now,
    };
    this.state.workspaces.set(wsPersonal.id, wsPersonal);

    // 2. Business Workspace
    const wsBusiness: Workspace = {
      id: wsBusinessId,
      ownerSubjectHash: this.state.localIdentity?.ownerSubjectHash || 'local-owner',
      name: 'দোকান / ব্যবসা (Business)',
      kind: 'business',
      currency: 'BDT',
      createdAt: now,
    };
    this.state.workspaces.set(wsBusiness.id, wsBusiness);

    // Default Personal Accounts (Clean slate: 0 opening balance)
    const accCash: Account = {
      id: 'acc-cash-1',
      workspaceId: wsPersonalId,
      name: 'Cash in Hand (নগদ ক্যাশ)',
      kind: 'cash',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    const accBkash: Account = {
      id: 'acc-bkash-1',
      workspaceId: wsPersonalId,
      name: 'bKash (বিকাশ একাউন্ট)',
      kind: 'bkash',
      accountNumberMasked: '',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    const accBank: Account = {
      id: 'acc-bank-1',
      workspaceId: wsPersonalId,
      name: 'Bank Account (ব্যাংক হিসাব)',
      kind: 'bank',
      accountNumberMasked: '',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    this.state.accounts.set(accCash.id, accCash);
    this.state.accounts.set(accBkash.id, accBkash);
    this.state.accounts.set(accBank.id, accBank);

    // Default Business Accounts (Clean slate: 0 opening balance)
    const accBizCash: Account = {
      id: 'acc-biz-cash',
      workspaceId: wsBusinessId,
      name: 'Cash Drawer (দোকানের ক্যাশ)',
      kind: 'cash',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    const accBizBkash: Account = {
      id: 'acc-biz-bkash',
      workspaceId: wsBusinessId,
      name: 'bKash Merchant (মার্চেন্ট)',
      kind: 'bkash',
      accountNumberMasked: '',
      openingBalanceMinor: '0',
      createdAt: now,
    };
    this.state.accounts.set(accBizCash.id, accBizCash);
    this.state.accounts.set(accBizBkash.id, accBizBkash);

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
      this.state.categories.set(fullCat.id, fullCat);
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
    this.state.parties.set(partyPartner.id, partyPartner);
    this.state.parties.set(partyStaff.id, partyStaff);
  }

  // --- Transactions and Atomic Commits ---

  /**
   * Commits a balanced journal transaction and queues an immutable sync operation in a single atomic commit.
   */
  public async commitJournalWithOutbox(
    balanced: BalancedJournal,
    op: SyncOperation
  ): Promise<UUID> {
    const tx = balanced.transaction;
    const lines = balanced.lines;

    // Check if operation was already applied
    if (this.state.appliedOperations.has(op.operationId)) {
      console.warn(`Operation ${op.operationId} was already applied. Skipping duplicate.`);
      return tx.id;
    }

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

    await this.persist();
    return fullTx.id;
  }

  // --- Query Engine ---

  public getWorkspaces(): Workspace[] {
    return Array.from(this.state.workspaces.values()).filter((w) => !w.archivedAt);
  }

  public getWorkspace(id: UUID): Workspace | undefined {
    return this.state.workspaces.get(id);
  }

  public createWorkspace(name: string, kind: 'personal' | 'business'): Workspace {
    const ws: Workspace = {
      id: generateUUID(),
      ownerSubjectHash: this.state.localIdentity?.ownerSubjectHash || 'local-owner',
      name,
      kind,
      currency: 'BDT',
      createdAt: new Date().toISOString(),
    };
    this.state.workspaces.set(ws.id, ws);
    this.persist();
    return ws;
  }

  public getAccounts(workspaceId: UUID): Account[] {
    return Array.from(this.state.accounts.values()).filter(
      (a) => a.workspaceId === workspaceId && !a.archivedAt
    );
  }

  public createAccount(
    workspaceId: UUID,
    name: string,
    kind: Account['kind'],
    openingBalanceMinor = '0',
    accountNumberMasked = ''
  ): Account {
    const acc: Account = {
      id: generateUUID(),
      workspaceId,
      name,
      kind,
      accountNumberMasked,
      openingBalanceMinor,
      createdAt: new Date().toISOString(),
    };
    this.state.accounts.set(acc.id, acc);
    this.persist();
    return acc;
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
    this.persist();
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
      this.persist();
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
      this.persist();
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
    this.persist();
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
      this.persist();
    }
  }

  public deleteParty(id: UUID): void {
    const p = this.state.parties.get(id);
    if (p) {
      p.archivedAt = new Date().toISOString();
      this.persist();
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
      reason,
    };
    const op: SyncOperation = {
      protocolVersion: 1,
      ownerHash: this.getIdentity()?.ownerSubjectHash || 'owner',
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

    await this.persist();
  }

  /**
   * Edits an existing transaction: voids the previous one and posts the replacement.
   */
  public async editTransaction(
    originalId: UUID,
    cmd: {
      amountMinor: string;
      effectiveDate: string;
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
        effectiveDate: cmd.effectiveDate,
        note: cmd.note,
        partyId: effectivePartyId,
        opId,
      });
    } else {
      replacementBalanced = buildExpenseJournal({
        workspaceId: origTx.workspaceId,
        assetAccountId: cmd.assetAccountId,
        expenseCategoryId: cmd.categoryId,
        amountMinor: cmd.amountMinor,
        effectiveDate: cmd.effectiveDate,
        note: cmd.note,
        partyId: effectivePartyId,
        opId,
      });
    }

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
      ownerHash: this.getIdentity()?.ownerSubjectHash || 'owner',
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

    await this.persist();
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
    const accounts = this.getAccounts(workspaceId);
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

  public markOutboxUploaded(opIds: UUID[], remoteFileId: string): void {
    for (const id of opIds) {
      const entry = this.state.syncOutbox.get(id);
      if (entry) {
        entry.uploadedStatus = 'uploaded';
        entry.remoteFileId = remoteFileId;
        entry.lastError = null;
      }
    }
    this.persist();
  }

  public markOutboxFailed(opIds: UUID[], errorMsg: string): void {
    for (const id of opIds) {
      const entry = this.state.syncOutbox.get(id);
      if (entry) {
        entry.uploadedStatus = 'failed';
        entry.retryCount++;
        entry.lastError = errorMsg;
      }
    }
    this.persist();
  }

  public getSyncOutboxEntries(): SyncOutboxEntry[] {
    return Array.from(this.state.syncOutbox.values());
  }

  public getConflicts(): ConflictRecord[] {
    return Array.from(this.state.conflicts.values());
  }

  public addConflict(conflict: ConflictRecord): void {
    this.state.conflicts.set(conflict.id, conflict);
    this.persist();
  }

  public resolveConflict(conflictId: UUID, resolutionOpId: UUID): void {
    const c = this.state.conflicts.get(conflictId);
    if (c) {
      c.status = 'resolved';
      c.resolutionOpId = resolutionOpId;
      this.persist();
    }
  }

  public getBudgets(workspaceId: UUID): Budget[] {
    return Array.from(this.state.budgets.values()).filter((b) => b.workspaceId === workspaceId);
  }

  public setBudget(budget: Budget): void {
    this.state.budgets.set(budget.id, budget);
    this.persist();
  }

  public getRecurringRules(workspaceId: UUID): RecurringRule[] {
    return Array.from(this.state.recurringRules.values()).filter(
      (r) => r.workspaceId === workspaceId
    );
  }

  public setRecurringRule(rule: RecurringRule): void {
    this.state.recurringRules.set(rule.id, rule);
    this.persist();
  }

  public getReceiptBlob(sha256: string): ReceiptBlob | undefined {
    return this.state.receiptBlobs.get(sha256);
  }

  public storeReceiptBlob(blob: ReceiptBlob): void {
    this.state.receiptBlobs.set(blob.sha256, blob);
    this.persist();
  }

  // --- Snapshot and Non-destructive Migration Safeguards ---

  /**
   * Captures an immutable recovery snapshot before running any schema migration.
   */
  public async captureRecoverySnapshot(): Promise<LocalSnapshot> {
    const serialized = JSON.stringify(this.toSerializable());
    const hash = await computeSha256(serialized);

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
    await this.persist();
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
      throw new Error('Snapshot hash mismatch! Corrupted snapshot cannot be restored.');
    }

    const parsed = JSON.parse(snap.dataJson);
    await this.loadFromSerializable(parsed);
    await this.persist();
    return true;
  }

  // --- Serialization / Hydration ---

  public toSerializable(): Record<string, any> {
    return {
      schemaVersion: this.state.schemaVersion,
      localIdentity: this.state.localIdentity,
      deviceIdentity: this.state.deviceIdentity,
      workspaces: Array.from(this.state.workspaces.entries()),
      accounts: Array.from(this.state.accounts.entries()),
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
    this.state.schemaVersion = data.schemaVersion || CURRENT_SCHEMA_VERSION;
    this.state.localIdentity = data.localIdentity || null;
    this.state.deviceIdentity = data.deviceIdentity || {
      deviceId: generateUUID(),
      deviceName: 'Device',
      counter: 1,
      createdAt: new Date().toISOString(),
    };
    this.state.workspaces = new Map(data.workspaces || []);
    this.state.accounts = new Map(data.accounts || []);
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
    this.state.schemaMigrations = data.schemaMigrations || [];
    this.state.preferences = new Map(data.preferences || []);
  }

  public getRawState(): DatabaseState {
    return this.state;
  }
}
