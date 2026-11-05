/**
 * Chart of Accounts Classification
 * Implements GAAP-compliant account type classification for correct double-entry posting.
 *
 * Account Normal Balances:
 *   Asset     → Debit increases balance  (Cash, bKash, Bank)
 *   Liability → Credit increases balance (Payables)
 *   Equity    → Credit increases balance (Opening Capital, Retained Earnings)
 *   Revenue   → Credit increases balance (Income categories)
 *   Expense   → Debit increases balance  (Expense categories)
 */

export type AccountClassification = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

/**
 * Reserved virtual account IDs used as the contra-side in double-entry postings.
 * These are nominal accounts that never hold real cash but balance each transaction.
 */
export const SYSTEM_ACCOUNTS = {
  /** Equity/Capital account: contra-side for opening balance entries */
  OPENING_EQUITY: '__system__opening_equity',
  /** Revenue clearing account: contra-side for income entries */
  REVENUE_CLEARING: '__system__revenue_clearing',
  /** Expense clearing account: contra-side for expense entries */
  EXPENSE_CLEARING: '__system__expense_clearing',
  /** Paired allocation transfers between workspace books; never income/expense. */
  WORKSPACE_CLEARING: '__system__workspace_clearing',
} as const;

export type SystemAccountId = typeof SYSTEM_ACCOUNTS[keyof typeof SYSTEM_ACCOUNTS];

/**
 * Returns the normal-balance side for an account classification.
 * Assets and Expenses have debit normal balances.
 * Liabilities, Equity, and Revenue have credit normal balances.
 */
export function normalBalanceIsDebit(classification: AccountClassification): boolean {
  return classification === 'asset' || classification === 'expense';
}

/**
 * Returns the account classification for a known system account ID.
 */
export function getSystemAccountClassification(id: SystemAccountId): AccountClassification {
  switch (id) {
    case SYSTEM_ACCOUNTS.OPENING_EQUITY:
    case SYSTEM_ACCOUNTS.WORKSPACE_CLEARING:
      return 'equity';
    case SYSTEM_ACCOUNTS.REVENUE_CLEARING:
      return 'revenue';
    case SYSTEM_ACCOUNTS.EXPENSE_CLEARING:
      return 'expense';
  }
}
