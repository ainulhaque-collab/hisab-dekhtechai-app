import type { Account, JournalTransaction } from '../contracts/types';

export interface ReportScope {
  workspaceId: string;
  from: string;
  to: string;
  accounts: readonly Account[];
  transactions: readonly JournalTransaction[];
  /** Undefined means all wallets; an empty selection means no wallets. */
  accountIds?: readonly string[];
}
export interface ReportEntry {
  transaction: JournalTransaction;
  incomeMinor: string;
  expenseMinor: string;
}
export interface FinancialReport {
  from: string; to: string; workspaceId: string;
  incomeMinor: string; expenseMinor: string; netMinor: string;
  openingWalletMinor: string; closingWalletMinor: string;
  entries: ReportEntry[];
  categories: { id: string; amountMinor: string }[];
  days: { date: string; incomeMinor: string; expenseMinor: string; count: number }[];
}
export function validReportDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith('0000')) return false;
  const date = new Date(day + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}
export function shiftReportDate(day: string, delta: number): string {
  if (!validReportDate(day) || !Number.isSafeInteger(delta)) throw new Error('REPORT_DATE_INVALID');
  const date = new Date(day + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
export function previousReportPeriod(from: string, to: string) {
  if (!validReportDate(from) || !validReportDate(to) || from > to) throw new Error('REPORT_DATE_INVALID');
  const days = Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000) + 1;
  return { from: shiftReportDate(from, -days), to: shiftReportDate(from, -1) };
}
const min = (a: bigint, b: bigint) => a < b ? a : b;
const isWallet = (account: Account) => (account.classification || 'asset') === 'asset' && !account.id.startsWith('sl-account-');
const active = (tx: JournalTransaction) => !tx.isDeleted && !tx.isReplacedBy && tx.transactionType !== 'reversal';
export const UNALLOCATED_REPORT_CATEGORY = '__wallet_category_allocation_unspecified__';

/** Read-only projection. Balances replay every journal, including reversal
 * legs; income/expense use only current active nominal lines. Loan principal,
 * opening capital and internal transfers cannot become income or expense. */
export function buildFinancialReport(scope: ReportScope): FinancialReport {
  if (!validReportDate(scope.from) || !validReportDate(scope.to) || scope.from > scope.to) throw new Error('REPORT_DATE_INVALID');
  const walletIds = new Set(scope.accounts.filter(account => account.workspaceId === scope.workspaceId && isWallet(account) &&
    (scope.accountIds === undefined || scope.accountIds.includes(account.id))).map(account => account.id));
  const entries: ReportEntry[] = [], categories = new Map<string, bigint>();
  const days = new Map<string, { income: bigint; expense: bigint; count: number }>();
  let opening = 0n, closing = 0n, income = 0n, expense = 0n;
  for (const account of scope.accounts) if (walletIds.has(account.id)) {
    opening += BigInt(account.openingBalanceMinor); closing += BigInt(account.openingBalanceMinor);
  }
  const ids = new Set<string>();
  for (const tx of scope.transactions) {
    if (tx.workspaceId !== scope.workspaceId) continue;
    if (ids.has(tx.id)) throw new Error('REPORT_DUPLICATE_TRANSACTION'); ids.add(tx.id);
    if (!validReportDate(tx.effectiveDate)) throw new Error('REPORT_DATE_INVALID');
    const legs = tx.lines.filter(line => !line.categoryId && walletIds.has(line.accountId));
    if (!legs.length) continue;
    const debit = legs.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n);
    const credit = legs.reduce((sum, line) => sum + BigInt(line.creditMinor), 0n);
    if (tx.effectiveDate < scope.from) opening += debit - credit;
    if (tx.effectiveDate <= scope.to) closing += debit - credit;
    if (!active(tx) || tx.effectiveDate < scope.from || tx.effectiveDate > scope.to) continue;
    const incoming = tx.transactionType === 'income'
      ? tx.lines.filter(line => line.categoryId).reduce((sum, line) => sum + BigInt(line.creditMinor), 0n) : 0n;
    const outgoing = tx.transactionType === 'expense' || tx.transactionType === 'transfer'
      ? tx.lines.filter(line => line.categoryId).reduce((sum, line) => sum + BigInt(line.debitMinor), 0n) : 0n;
    const earned = min(debit, incoming), spent = min(credit, outgoing);
    income += earned; expense += spent;
    entries.push({ transaction: tx, incomeMinor: earned.toString(), expenseMinor: spent.toString() });
    const day = days.get(tx.effectiveDate) || { income: 0n, expense: 0n, count: 0 };
    day.income += earned; day.expense += spent; day.count++; days.set(tx.effectiveDate, day);
    if (spent > 0n) {
      const nominal = new Map<string, bigint>();
      for (const line of tx.lines) if (line.categoryId && BigInt(line.debitMinor) > 0n)
        nominal.set(line.categoryId, (nominal.get(line.categoryId) || 0n) + BigInt(line.debitMinor));
      const parts = [...nominal].sort(([a], [b]) => a.localeCompare(b));
      // A multi-wallet, multi-category journal does not say which wallet paid
      // which category. Keep its exact scoped total, never invent attribution.
      if (spent < outgoing && parts.length > 1) categories.set(UNALLOCATED_REPORT_CATEGORY,
        (categories.get(UNALLOCATED_REPORT_CATEGORY) || 0n) + spent);
      else for (const [id, amount] of parts) categories.set(id, (categories.get(id) || 0n) + (parts.length === 1 ? spent : amount));
    }
  }
  entries.sort((a, b) => b.transaction.effectiveDate.localeCompare(a.transaction.effectiveDate) ||
    b.transaction.occurredAtUtc.localeCompare(a.transaction.occurredAtUtc) || a.transaction.id.localeCompare(b.transaction.id));
  return { workspaceId: scope.workspaceId, from: scope.from, to: scope.to,
    incomeMinor: income.toString(), expenseMinor: expense.toString(), netMinor: (income - expense).toString(),
    openingWalletMinor: opening.toString(), closingWalletMinor: closing.toString(), entries,
    categories: [...categories].map(([id, amount]) => ({ id, amountMinor: amount.toString() })).sort((a, b) => {
      const delta = BigInt(b.amountMinor) - BigInt(a.amountMinor); return delta > 0n ? 1 : delta < 0n ? -1 : a.id.localeCompare(b.id);
    }), days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({ date,
      incomeMinor: day.income.toString(), expenseMinor: day.expense.toString(), count: day.count })) };
}

export interface SpendingReview { kind: 'possible-duplicate' | 'unusual-expense'; transactionIds: string[]; amountMinor: string; baselineMinor?: string }
/** Deterministic suggestions only. Repeated real purchases are valid: this
 * function never deletes, blocks or rewrites a transaction. */
export function reviewSpending(scope: ReportScope): SpendingReview[] {
  const report = buildFinancialReport(scope), groups = new Map<string, ReportEntry[]>();
  const reviews: SpendingReview[] = [];
  for (const item of report.entries) {
    if (!['expense', 'income'].includes(item.transaction.transactionType)) continue;
    const tx = item.transaction;
    const key = JSON.stringify([tx.effectiveDate, tx.transactionType, item.incomeMinor, item.expenseMinor,
      tx.lines.filter(line => !line.categoryId).map(line => line.accountId).sort(),
      tx.lines.filter(line => line.categoryId).map(line => line.categoryId).sort()]);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  for (const items of groups.values()) if (items.length > 1) reviews.push({ kind: 'possible-duplicate',
    transactionIds: items.map(item => item.transaction.id), amountMinor: (BigInt(items[0].expenseMinor) || BigInt(items[0].incomeMinor)).toString() });
  const history = buildFinancialReport({ ...scope, from: shiftReportDate(scope.from, -90), to: shiftReportDate(scope.from, -1) });
  const samples = new Map<string, bigint[]>();
  const categoryKey = (item: ReportEntry) => item.transaction.lines.filter(line => line.categoryId).map(line => line.categoryId).sort().join('|');
  for (const item of history.entries) if (item.transaction.transactionType === 'expense' && BigInt(item.expenseMinor) > 0n) {
    const key = categoryKey(item); samples.set(key, [...(samples.get(key) || []), BigInt(item.expenseMinor)]);
  }
  for (const item of report.entries) {
    if (item.transaction.transactionType !== 'expense') continue;
    const prior = [...(samples.get(categoryKey(item)) || [])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    if (prior.length < 5) continue;
    const middle = Math.floor(prior.length / 2);
    const median = prior.length % 2 ? prior[middle] : (prior[middle - 1] + prior[middle]) / 2n;
    if (median > 0n && BigInt(item.expenseMinor) >= 10000n && BigInt(item.expenseMinor) >= median * 3n)
      reviews.push({ kind: 'unusual-expense', transactionIds: [item.transaction.id], amountMinor: item.expenseMinor, baselineMinor: median.toString() });
  }
  return reviews.slice(0, 100);
}
