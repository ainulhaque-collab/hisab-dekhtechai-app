/**
 * Core domain contracts and types for Hisab DekhteChai
 */

export type UUID = string;
export type PaisaString = string; // Integer minor units represented as string e.g. "25000" (৳250.00)

export type WorkspaceKind = 'personal' | 'business';

export interface Workspace {
  id: UUID;
  ownerSubjectHash: string;
  name: string;
  kind: WorkspaceKind;
  currency: 'BDT';
  archivedAt?: string | null;
  createdAt: string;
}

export type AccountKind = 'cash' | 'bank' | 'bkash' | 'nagad' | 'rocket' | 'other';

export interface Account {
  id: UUID;
  workspaceId: UUID;
  ledgerId?: UUID | null;
  name: string;
  kind: AccountKind;
  accountNumberMasked?: string;
  openingBalanceMinor: PaisaString;
  archivedAt?: string | null;
  createdAt: string;
}

export interface LedgerGroup {
  id: UUID;
  workspaceId: UUID;
  name: string;
  icon?: string;
  archivedAt?: string | null;
}

export interface Ledger {
  id: UUID;
  workspaceId: UUID;
  groupId?: UUID | null;
  name: string;
  archivedAt?: string | null;
}

export type CategoryKind = 'income' | 'expense';

export interface Category {
  id: UUID;
  workspaceId: UUID;
  parentId?: UUID | null;
  kind: CategoryKind;
  name: string;
  nameEn?: string;
  icon?: string;
  color?: string;
  archivedAt?: string | null;
}

export type TransactionType = 'opening' | 'income' | 'expense' | 'transfer' | 'reversal' | 'correction';

export interface JournalLine {
  id: UUID;
  transactionId: UUID;
  accountId: UUID;
  debitMinor: PaisaString; // integer paisa >= 0
  creditMinor: PaisaString; // integer paisa >= 0
  categoryId?: UUID | null;
}

export type PartyRole = 'partner' | 'staff' | 'customer' | 'supplier' | 'other';

export interface BusinessParty {
  id: UUID;
  workspaceId: UUID;
  name: string;
  phone?: string;
  role: PartyRole;
  openingBalanceMinor: PaisaString;
  notes?: string;
  archivedAt?: string | null;
  createdAt: string;
}

export interface JournalTransaction {
  id: UUID;
  workspaceId: UUID;
  transactionType: TransactionType;
  effectiveDate: string; // YYYY-MM-DD in Asia/Dhaka
  occurredAtUtc: string; // ISO-8601 UTC
  note?: string;
  partyId?: UUID | null; // Associated person/party in business workspace
  reversalOf?: UUID | null; // Pointer to original transaction if reversal/correction
  createdOpId: UUID; // Operation UUID that produced this transaction
  lines: JournalLine[];
  receiptBlobSha256?: string | null;
  receiptName?: string | null;
  isDeleted?: boolean;
  isReplacedBy?: UUID | null;
}

export interface BalancedJournal {
  transaction: Omit<JournalTransaction, 'lines'>;
  lines: JournalLine[];
}

export type SyncOperationType =
  | 'workspace.create'
  | 'workspace.update'
  | 'workspace.archive'
  | 'account.create'
  | 'account.update'
  | 'account.archive'
  | 'category.create'
  | 'category.update'
  | 'category.archive'
  | 'party.create'
  | 'party.update'
  | 'party.archive'
  | 'journal.post'
  | 'journal.correct'
  | 'journal.delete'
  | 'budget.set'
  | 'recurring.rule.create'
  | 'recurring.rule.update'
  | 'recurring.occurrence.post'
  | 'receipt.attach';

export interface SyncOperation {
  protocolVersion: 1;
  ownerHash: string;
  deviceId: UUID;
  seq: number;
  operationId: UUID;
  entityId: UUID;
  type: SyncOperationType;
  baseRevision?: string | null;
  createdAtUtc: string;
  payload: Record<string, any>;
  contentSha256: string; // SHA-256 over canonicalized payload
}

export type OutboxStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface SyncOutboxEntry {
  opId: UUID;
  uploadedStatus: OutboxStatus;
  remoteFileId?: string | null;
  retryCount: number;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  createdAt: string;
}

export interface SyncBatch {
  protocolVersion: 1;
  ownerHash: string;
  deviceId: UUID;
  batchId: UUID;
  fromSeq: number;
  toSeq: number;
  operations: SyncOperation[];
  batchSha256: string;
  byteLength: number;
  createdAtUtc: string;
}

export interface ConflictRecord {
  id: UUID;
  entityId: UUID;
  baseVersion: string;
  originalOpId: UUID;
  contenderOpIds: UUID[];
  status: 'needs_review' | 'resolved';
  resolutionOpId?: UUID | null;
  detectedAt: string;
  details: {
    title: string;
    description: string;
    contenders: Array<{
      opId: UUID;
      deviceId: UUID;
      timestamp: string;
      summary: string;
    }>;
  };
}

export interface Budget {
  id: UUID;
  workspaceId: UUID;
  categoryId: UUID;
  period: 'monthly' | 'weekly';
  limitMinor: PaisaString;
  alertThresholds: number[]; // e.g. [80, 100]
  updatedAt: string;
}

export interface RecurringRule {
  id: UUID;
  workspaceId: UUID;
  name: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  dayOfMonth?: number;
  dayOfWeek?: number;
  amountMinor: PaisaString;
  type: 'income' | 'expense';
  accountId: UUID;
  categoryId: UUID;
  note?: string;
  autoPostEnabled: boolean;
  active: boolean;
  generation: number;
  createdAt: string;
}

export interface RecurringOccurrence {
  id: UUID;
  ruleId: UUID;
  effectiveDate: string; // YYYY-MM-DD
  transactionId?: UUID | null;
  status: 'pending' | 'posted' | 'skipped';
}

export interface ReceiptBlob {
  sha256: string;
  fileName: string;
  contentType: string;
  byteLength: number;
  dataBase64?: string; // Stored securely
  cloudFileId?: string | null;
  uploadStatus: 'local_only' | 'uploading' | 'synced' | 'failed';
  createdAt: string;
}

export interface LocalSnapshot {
  id: UUID;
  dbSchemaVersion: number;
  hash: string;
  totalTransactions: number;
  totalLines: number;
  pendingOutboxCount: number;
  verifiedAt: string;
  createdAt: string;
  dataJson?: string;
}

export interface AccountBalanceSummary {
  accountId: UUID;
  name: string;
  kind: AccountKind;
  openingBalanceMinor: PaisaString;
  currentBalanceMinor: PaisaString;
  totalDebitsMinor: PaisaString;
  totalCreditsMinor: PaisaString;
}

export interface DashboardData {
  workspace: Workspace;
  totalConsolidatedBalanceMinor: PaisaString;
  totalIncomeThisMonthMinor: PaisaString;
  totalExpenseThisMonthMinor: PaisaString;
  netFlowThisMonthMinor: PaisaString;
  accountSummaries: AccountBalanceSummary[];
  recentTransactions: JournalTransaction[];
  topExpenseCategories: Array<{
    categoryId: UUID;
    name: string;
    amountMinor: PaisaString;
    percentage: number;
  }>;
}
