/**
 * Double-Entry Financial Journal Engine
 * Enforces debit == credit balance invariants, non-negative amounts,
 * proper account debit/credit conventions, and immutable correction trails.
 */

import {
  UUID,
  JournalTransaction,
  JournalLine,
  BalancedJournal,
  TransactionType,
  PaisaString
} from '../contracts/types';
import { toPaisa, paisaToDecimalString } from './money';

export interface PostIncomeCommand {
  workspaceId: UUID;
  assetAccountId: UUID;
  revenueCategoryId: UUID;
  amountMinor: PaisaString;
  effectiveDate: string; // YYYY-MM-DD
  note?: string;
  receiptBlobSha256?: string | null;
  receiptName?: string | null;
  opId: UUID;
  transactionId?: UUID;
}

export interface PostExpenseCommand {
  workspaceId: UUID;
  assetAccountId: UUID;
  expenseCategoryId: UUID;
  amountMinor: PaisaString;
  effectiveDate: string; // YYYY-MM-DD
  note?: string;
  receiptBlobSha256?: string | null;
  receiptName?: string | null;
  opId: UUID;
  transactionId?: UUID;
}

export interface PostTransferCommand {
  workspaceId: UUID;
  fromAssetAccountId: UUID;
  toAssetAccountId: UUID;
  amountMinor: PaisaString;
  feeMinor?: PaisaString;
  feeExpenseCategoryId?: UUID;
  effectiveDate: string; // YYYY-MM-DD
  note?: string;
  receiptBlobSha256?: string | null;
  receiptName?: string | null;
  opId: UUID;
  transactionId?: UUID;
}

export interface PostOpeningBalanceCommand {
  workspaceId: UUID;
  assetAccountId: UUID;
  amountMinor: PaisaString;
  effectiveDate: string;
  opId: UUID;
  transactionId?: UUID;
}

export function generateUUID(): UUID {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Builds and validates an Income balanced journal entry.
 * Debit: Asset Account (Cash/Bank/bKash increases)
 * Credit: Revenue Category
 */
export function buildIncomeJournal(cmd: PostIncomeCommand): BalancedJournal {
  const amount = toPaisa(cmd.amountMinor);
  if (amount <= 0n) {
    throw new Error('Income amount must be strictly positive');
  }

  const txId = cmd.transactionId || generateUUID();
  const tx: Omit<JournalTransaction, 'lines'> = {
    id: txId,
    workspaceId: cmd.workspaceId,
    transactionType: 'income',
    effectiveDate: cmd.effectiveDate,
    occurredAtUtc: new Date().toISOString(),
    note: cmd.note,
    createdOpId: cmd.opId,
    receiptBlobSha256: cmd.receiptBlobSha256 || null,
    receiptName: cmd.receiptName || null,
  };

  const lines: JournalLine[] = [
    {
      id: generateUUID(),
      transactionId: txId,
      accountId: cmd.assetAccountId,
      debitMinor: amount.toString(),
      creditMinor: '0',
      categoryId: null,
    },
    {
      id: generateUUID(),
      transactionId: txId,
      accountId: cmd.assetAccountId, // Represents the balanced equity/revenue side
      debitMinor: '0',
      creditMinor: amount.toString(),
      categoryId: cmd.revenueCategoryId,
    },
  ];

  assertJournalBalanced(lines);
  return { transaction: tx, lines };
}

/**
 * Builds and validates an Expense balanced journal entry.
 * Debit: Expense Category
 * Credit: Asset Account (Cash/Bank/bKash decreases)
 */
export function buildExpenseJournal(cmd: PostExpenseCommand): BalancedJournal {
  const amount = toPaisa(cmd.amountMinor);
  if (amount <= 0n) {
    throw new Error('Expense amount must be strictly positive');
  }

  const txId = cmd.transactionId || generateUUID();
  const tx: Omit<JournalTransaction, 'lines'> = {
    id: txId,
    workspaceId: cmd.workspaceId,
    transactionType: 'expense',
    effectiveDate: cmd.effectiveDate,
    occurredAtUtc: new Date().toISOString(),
    note: cmd.note,
    createdOpId: cmd.opId,
    receiptBlobSha256: cmd.receiptBlobSha256 || null,
    receiptName: cmd.receiptName || null,
  };

  const lines: JournalLine[] = [
    {
      id: generateUUID(),
      transactionId: txId,
      accountId: cmd.assetAccountId,
      debitMinor: '0',
      creditMinor: amount.toString(),
      categoryId: null,
    },
    {
      id: generateUUID(),
      transactionId: txId,
      accountId: cmd.assetAccountId,
      debitMinor: amount.toString(),
      creditMinor: '0',
      categoryId: cmd.expenseCategoryId,
    },
  ];

  assertJournalBalanced(lines);
  return { transaction: tx, lines };
}

/**
 * Builds and validates a Transfer balanced journal entry between two asset accounts.
 * Debit: Destination Asset Account
 * Credit: Source Asset Account
 * Optional Fee: Debit Fee Expense Category, Credit Source Asset Account
 */
export function buildTransferJournal(cmd: PostTransferCommand): BalancedJournal {
  const amount = toPaisa(cmd.amountMinor);
  if (amount <= 0n) {
    throw new Error('Transfer amount must be strictly positive');
  }
  if (cmd.fromAssetAccountId === cmd.toAssetAccountId) {
    throw new Error('Source and destination accounts must be distinct');
  }

  const fee = cmd.feeMinor ? toPaisa(cmd.feeMinor) : 0n;
  if (fee < 0n) {
    throw new Error('Transfer fee cannot be negative');
  }

  const txId = cmd.transactionId || generateUUID();
  const tx: Omit<JournalTransaction, 'lines'> = {
    id: txId,
    workspaceId: cmd.workspaceId,
    transactionType: 'transfer',
    effectiveDate: cmd.effectiveDate,
    occurredAtUtc: new Date().toISOString(),
    note: cmd.note,
    createdOpId: cmd.opId,
    receiptBlobSha256: cmd.receiptBlobSha256 || null,
    receiptName: cmd.receiptName || null,
  };

  const lines: JournalLine[] = [
    // Source account credited (money leaving)
    {
      id: generateUUID(),
      transactionId: txId,
      accountId: cmd.fromAssetAccountId,
      debitMinor: '0',
      creditMinor: amount.toString(),
      categoryId: null,
    },
    // Destination account debited (money arriving)
    {
      id: generateUUID(),
      transactionId: txId,
      accountId: cmd.toAssetAccountId,
      debitMinor: amount.toString(),
      creditMinor: '0',
      categoryId: null,
    },
  ];

  // If there is an explicit transfer fee (e.g. bKash cashout / bank charge):
  if (fee > 0n) {
    // Extra credit on source account for fee
    lines.push({
      id: generateUUID(),
      transactionId: txId,
      accountId: cmd.fromAssetAccountId,
      debitMinor: '0',
      creditMinor: fee.toString(),
      categoryId: null,
    });
    // Debit fee expense category
    lines.push({
      id: generateUUID(),
      transactionId: txId,
      accountId: cmd.fromAssetAccountId,
      debitMinor: fee.toString(),
      creditMinor: '0',
      categoryId: cmd.feeExpenseCategoryId || null,
    });
  }

  assertJournalBalanced(lines);
  return { transaction: tx, lines };
}

/**
 * Builds an Opening Balance journal entry.
 * Debit: Asset Account
 * Credit: Equity / Initial Capital
 */
export function buildOpeningBalanceJournal(cmd: PostOpeningBalanceCommand): BalancedJournal {
  const amount = toPaisa(cmd.amountMinor);
  if (amount < 0n) {
    throw new Error('Opening balance cannot be negative');
  }

  const txId = cmd.transactionId || generateUUID();
  const tx: Omit<JournalTransaction, 'lines'> = {
    id: txId,
    workspaceId: cmd.workspaceId,
    transactionType: 'opening',
    effectiveDate: cmd.effectiveDate,
    occurredAtUtc: new Date().toISOString(),
    note: 'প্রারম্ভিক ব্যালেন্স (Opening balance)',
    createdOpId: cmd.opId,
  };

  const lines: JournalLine[] = [
    {
      id: generateUUID(),
      transactionId: txId,
      accountId: cmd.assetAccountId,
      debitMinor: amount.toString(),
      creditMinor: '0',
      categoryId: null,
    },
    {
      id: generateUUID(),
      transactionId: txId,
      accountId: cmd.assetAccountId,
      debitMinor: '0',
      creditMinor: amount.toString(),
      categoryId: null,
    },
  ];

  assertJournalBalanced(lines);
  return { transaction: tx, lines };
}

/**
 * Builds a Reversal journal entry for a previously posted transaction.
 * Inverts all debits and credits of original lines.
 */
export function buildReversalJournal(
  original: JournalTransaction,
  opId: UUID,
  reason: string
): BalancedJournal {
  const reversalTxId = generateUUID();
  const tx: Omit<JournalTransaction, 'lines'> = {
    id: reversalTxId,
    workspaceId: original.workspaceId,
    transactionType: 'reversal',
    effectiveDate: original.effectiveDate,
    occurredAtUtc: new Date().toISOString(),
    note: `বাতিলকরণ (Reversal): ${reason}`,
    reversalOf: original.id,
    createdOpId: opId,
  };

  const lines: JournalLine[] = original.lines.map((origLine) => ({
    id: generateUUID(),
    transactionId: reversalTxId,
    accountId: origLine.accountId,
    // Swap debits and credits
    debitMinor: origLine.creditMinor,
    creditMinor: origLine.debitMinor,
    categoryId: origLine.categoryId,
  }));

  assertJournalBalanced(lines);
  return { transaction: tx, lines };
}

/**
 * Validates that total debits strictly equal total credits.
 * Throws an explicit error if unbalanced.
 */
export function assertJournalBalanced(lines: JournalLine[]): void {
  if (lines.length < 2) {
    throw new Error('Journal transaction must have at least 2 lines');
  }

  let totalDebits = 0n;
  let totalCredits = 0n;

  for (const line of lines) {
    const d = toPaisa(line.debitMinor);
    const c = toPaisa(line.creditMinor);

    if (d < 0n || c < 0n) {
      throw new Error('Line debit and credit must be non-negative');
    }
    // Exactly one side must be positive
    if ((d > 0n && c > 0n) || (d === 0n && c === 0n)) {
      throw new Error('Journal line must have exactly one positive side (debit or credit)');
    }

    totalDebits += d;
    totalCredits += c;
  }

  if (totalDebits !== totalCredits) {
    throw new Error(
      `Unbalanced journal entry! Total debits (${paisaToDecimalString(
        totalDebits
      )}) != total credits (${paisaToDecimalString(totalCredits)})`
    );
  }
}
