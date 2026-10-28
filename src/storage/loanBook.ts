import type { Account, BalancedJournal, Category, JournalTransaction, SyncOperation, Workspace } from '../contracts/types';
import type { DatabaseState, LocalDatabase } from './db';
import { SYSTEM_ACCOUNTS } from '../contracts/ledger';
import { projectSavingsLoan, validateSavingsLoanTerms, type SavingsLoanTerms, type SavingsLoanPayment, type SavingsLoanProjection } from '../domain/savingsLoans';
import { canonicalJson, computeSha256Sync } from '../sync/canonical';
import { savingsRecords } from './savingsOperations';

type Issue = { version: 1; action: 'issue'; terms: SavingsLoanTerms; purpose: string; executorDeviceId: string; autoRepay: boolean; releases: string[] };
type Repay = { version: 1; action: 'repay'; loanId: string; payment: SavingsLoanPayment; principalMinor: string; interestMinor: string };
type LoanEvent = Issue | Repay;
export interface SavingsLoanRow { issue: Issue; payments: SavingsLoanPayment[]; balance: SavingsLoanProjection; pendingReferences: number }
export interface NewSavingsLoan { id: string; goalId: string; sourceWorkspaceId: string; sourceAccountId: string;
  borrowerWorkspaceId: string; borrowerAccountId: string; principalMinor: string; dueDate: string;
  monthlyRateBps: number; repaymentOrder: SavingsLoanTerms['repaymentOrder']; purpose: string; autoRepay?: boolean }

const ids = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const money = /^(?:0|[1-9]\d{0,17})$/;
const zero = (value: unknown) => typeof value === 'string' && money.test(value);
function fail(code = 'LOAN_INVALID_EVENT'): never { throw new Error(code); }
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !ids.test(value) || ['constructor', 'prototype', '__proto__'].includes(value)) return fail();
  return value;
}
function object(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) return fail();
  for (const key of Object.getOwnPropertyNames(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!keys.includes(key) || !d || !('value' in d)) return fail();
  }
  return value as Record<string, any>;
}

export function loanToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const p = (type: string) => parts.find(item => item.type === type)!.value;
  return `${p('year')}-${p('month')}-${p('day')}`;
}
const digest = (text: string) => computeSha256Sync(text).slice(0, 40);
const ledgerId = (loanId: string, side: string) => `sl-account-${digest(`${loanId}:${side}`)}`;
const categoryId = (workspaceId: string, kind: string) => `sl-interest-${kind}-${digest(workspaceId)}`;
const allocationId = (paymentId: string) => `sl-allocation-${digest(paymentId)}`;
export const isLoanLedgerAccount = (id: string) => id.startsWith('sl-account-');
export const isLoanJournal = (id: string) => id.startsWith('sl-journal-');
export const isLoanOperation = (op: SyncOperation) => !!op?.payload && Object.hasOwn(op.payload, 'loanEvent');

function event(op: SyncOperation): LoanEvent {
  const p = object(op.payload, ['id', 'loanEvent']);
  const item = object(p.loanEvent, ['version', 'action', 'terms', 'purpose', 'executorDeviceId', 'autoRepay', 'releases', 'loanId', 'payment', 'principalMinor', 'interestMinor']);
  if (item.version !== 1 || op.protocolVersion !== 1 || !Number.isSafeInteger(op.seq) || op.seq < 1 ||
    typeof op.createdAtUtc !== 'string' || !Number.isFinite(Date.parse(op.createdAtUtc)) ||
    op.type !== 'workspace.update' || p.id !== op.entityId ||
    op.authorSubjectHash && op.authorSubjectHash !== op.ownerHash ||
    op.contentSha256 !== computeSha256Sync(canonicalJson(op.payload))) return fail();
  if (item.action === 'issue') {
    object(item, ['version', 'action', 'terms', 'purpose', 'executorDeviceId', 'autoRepay', 'releases']);
    const terms = validateSavingsLoanTerms(item.terms);
    if (terms.ownerHash !== op.ownerHash || terms.sourceWorkspaceId !== op.entityId ||
      terms.interestBasis !== 'daily-30' || terms.timeZone !== 'Asia/Dhaka' || terms.reminderMinute !== 1140 ||
      typeof item.autoRepay !== 'boolean' || typeof item.purpose !== 'string' || !item.purpose.trim() || item.purpose.length > 120 || /[\x00-\x1f\x7f]/.test(item.purpose) ||
      !Array.isArray(item.releases) || item.releases.length === 0 || item.releases.length > 10_000 ||
      new Set(item.releases).size !== item.releases.length) return fail();
    return { version: 1, action: 'issue', terms, purpose: item.purpose, executorDeviceId: identifier(item.executorDeviceId), autoRepay: item.autoRepay, releases: item.releases.map(identifier) };
  }
  if (item.action === 'repay') {
    object(item, ['version', 'action', 'loanId', 'payment', 'principalMinor', 'interestMinor']);
    const p = object(item.payment, ['id', 'loanId', 'effectiveDate', 'amountMinor']);
    if (typeof p.effectiveDate !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(p.effectiveDate) ||
      !Number.isFinite(Date.parse(`${p.effectiveDate}T12:00:00Z`)) || new Date(`${p.effectiveDate}T12:00:00Z`).toISOString().slice(0, 10) !== p.effectiveDate ||
      !zero(item.principalMinor) || !zero(item.interestMinor) || !zero(p.amountMinor) || p.amountMinor === '0' ||
      BigInt(item.principalMinor) + BigInt(item.interestMinor) !== BigInt(p.amountMinor) || p.loanId !== item.loanId) return fail();
    return { version: 1, action: 'repay', loanId: identifier(item.loanId), payment: { id: identifier(p.id), loanId: identifier(p.loanId),
      effectiveDate: p.effectiveDate, amountMinor: p.amountMinor }, principalMinor: item.principalMinor, interestMinor: item.interestMinor };
  }
  return fail();
}

type Posting = { id: string; workspaceId: string; type: 'transfer' | 'income' | 'expense'; entries: [string, string, string | null][] };
/** Entry amount is signed: positive debit, negative credit. */
function postings(issue: Issue, repayment?: Repay): Posting[] {
  const t = issue.terms, result: Posting[] = [], key = `${t.id}:${repayment?.payment.id || 'issue'}`;
  const principal = repayment?.principalMinor || t.principalMinor;
  const add = (role: string, workspaceId: string, type: Posting['type'], entries: Posting['entries']) =>
    result.push({ id: `sl-journal-${digest(`${key}:${role}`)}`, workspaceId, type, entries });
  if (BigInt(principal) > 0n) {
    const p = BigInt(principal), sign = repayment ? 1n : -1n;
    add('lender', t.sourceWorkspaceId, 'transfer', [[t.sourceAccountId, (p * sign).toString(), null], [ledgerId(t.id, 'receivable'), (-p * sign).toString(), null]]);
    add('borrower', t.borrowerWorkspaceId, 'transfer', [[t.borrowerAccountId, (-p * sign).toString(), null], [ledgerId(t.id, 'payable'), (p * sign).toString(), null]]);
  }
  if (repayment && BigInt(repayment.interestMinor) > 0n) {
    const i = repayment.interestMinor;
    add('interest-income', t.sourceWorkspaceId, 'income', [[t.sourceAccountId, i, null], [SYSTEM_ACCOUNTS.REVENUE_CLEARING, `-${i}`, categoryId(t.sourceWorkspaceId, 'income')]]);
    add('interest-expense', t.borrowerWorkspaceId, 'expense', [[t.borrowerAccountId, `-${i}`, null], [SYSTEM_ACCOUNTS.EXPENSE_CLEARING, i, categoryId(t.borrowerWorkspaceId, 'expense')]]);
  }
  return result;
}

/** Validate retained metadata on hydration, sync and restore. Partial batches are
 * visible as pending; no repayment may proceed until all linked records arrive. */
export function readSavingsLoans(state: Pick<DatabaseState, 'syncOperations' | 'workspaces' | 'accounts' | 'journalTransactions'>,
  asOfDate = loanToday()): SavingsLoanRow[] {
  const definitions = new Map<string, { issue: Issue; op: SyncOperation }>();
  const repayments = new Map<string, { repayment: Repay; op: SyncOperation }>();
  const released = new Set<string>();
  for (const op of state.syncOperations.values()) {
    if (!isLoanOperation(op)) continue;
    const e = event(op), ws = state.workspaces.get(op.entityId);
    if (!ws || ws.ownerSubjectHash !== op.ownerHash) return fail('LOAN_OWNER_MISMATCH');
    if (e.action === 'issue') {
      const previous = definitions.get(e.terms.id);
      if (previous && canonicalJson(previous.issue) !== canonicalJson(e)) return fail('LOAN_EVENT_CONFLICT');
      if (previous) continue;
      definitions.set(e.terms.id, { issue: e, op });
      for (const ref of e.releases) { if (released.has(ref)) return fail('LOAN_EVENT_CONFLICT'); released.add(ref); }
    } else {
      const previous = repayments.get(e.payment.id);
      if (previous && canonicalJson(previous.repayment) !== canonicalJson(e)) return fail('LOAN_EVENT_CONFLICT');
      repayments.set(e.payment.id, { repayment: e, op });
    }
  }
  const rows: SavingsLoanRow[] = [];
  for (const { issue, op } of definitions.values()) {
    const t = issue.terms;
    let pending = 0;
    for (const [wsId, accountId] of [[t.sourceWorkspaceId, t.sourceAccountId], [t.borrowerWorkspaceId, t.borrowerAccountId]]) {
      const ws = state.workspaces.get(wsId), account = state.accounts.get(accountId);
      if (!ws || !account) { pending++; continue; }
      if (ws.ownerSubjectHash !== t.ownerHash || account.workspaceId !== wsId || (account.classification || 'asset') !== 'asset' || isLoanLedgerAccount(accountId)) return fail('LOAN_OWNER_MISMATCH');
    }
    for (const [side, workspaceId, classification] of [['receivable', t.sourceWorkspaceId, 'asset'], ['payable', t.borrowerWorkspaceId, 'liability']]) {
      const a = state.accounts.get(ledgerId(t.id, side));
      if (!a) pending++;
      else if (a.workspaceId !== workspaceId || a.classification !== classification || a.openingBalanceMinor !== '0' || !a.archivedAt) return fail('LOAN_LEDGER_CONFLICT');
    }
    let releaseTotal = 0n;
    const savings = savingsRecords(state.syncOperations.values(), t.sourceWorkspaceId);
    for (const ref of issue.releases) {
      const record = savings.find(item => item.operationId === ref);
      if (!record) { pending++; continue; }
      const r = record.event;
      if (r.action !== 'allocation.release' || r.goalId !== t.goalId) return fail();
      const allocation = savings.find(item => item.event.action === 'allocation.add' && item.event.allocationId === r.allocationId)?.event;
      if (!allocation) pending++;
      else if (allocation.action !== 'allocation.add' || allocation.accountId !== t.sourceAccountId || allocation.goalId !== t.goalId) return fail();
      releaseTotal += BigInt(r.amountMinor);
    }
    if (releaseTotal > BigInt(t.principalMinor) || !issue.releases.some(ref => !state.syncOperations.has(ref)) && releaseTotal !== BigInt(t.principalMinor)) return fail();
    const payments: Repay[] = [];
    for (const { repayment, op: repaymentOp } of repayments.values()) if (repayment.loanId === t.id) {
      if (repaymentOp.ownerHash !== t.ownerHash || repaymentOp.entityId !== t.sourceWorkspaceId || repaymentOp.deviceId !== issue.executorDeviceId) return fail('LOAN_OWNER_MISMATCH');
      payments.push(repayment);
    }
    if (op.deviceId !== issue.executorDeviceId) return fail('LOAN_OWNER_MISMATCH');
    const lastDay = payments.reduce((day, p) => p.payment.effectiveDate > day ? p.payment.effectiveDate : day, asOfDate < t.issuedDate ? t.issuedDate : asOfDate);
    const complete = projectSavingsLoan(t, payments.map(p => p.payment), lastDay);
    for (const p of payments) {
      const b = complete.payments.find(item => item.id === p.payment.id)!;
      if (b.principalMinor !== p.principalMinor || b.interestMinor !== p.interestMinor) return fail('LOAN_PAYMENT_CONFLICT');
      if (BigInt(p.principalMinor) > 0n) {
        const add = savings.find(item => item.event.action === 'allocation.add' && item.event.allocationId === allocationId(p.payment.id))?.event;
        if (!add) pending++;
        else if (add.action !== 'allocation.add' || add.goalId !== t.goalId || add.accountId !== t.sourceAccountId || add.amountMinor !== p.principalMinor) return fail();
      }
    }
    for (const expected of [...postings(issue).map(p => ({ ...p, day: t.issuedDate })), ...payments.flatMap(p => postings(issue, p).map(j => ({ ...j, day: p.payment.effectiveDate })))]) {
      const actual = state.journalTransactions.get(expected.id);
      if (!actual) { pending++; continue; }
      const shape = (tx: JournalTransaction) => tx.lines.map(l => [l.accountId, (BigInt(l.debitMinor) - BigInt(l.creditMinor)).toString(), l.categoryId || null]);
      if (actual.workspaceId !== expected.workspaceId || actual.effectiveDate !== expected.day || actual.transactionType !== expected.type || actual.isDeleted || actual.isReplacedBy || canonicalJson(shape(actual)) !== canonicalJson(expected.entries)) return fail('LOAN_LEDGER_CONFLICT');
    }
    rows.push({ issue, payments: payments.map(p => p.payment), balance: projectSavingsLoan(t, payments.map(p => p.payment), asOfDate < t.issuedDate ? t.issuedDate : asOfDate), pendingReferences: pending });
  }
  return rows;
}

function ownWorkspace(db: LocalDatabase, workspaceId: string): Workspace {
  const owner = db.getIdentity()?.ownerSubjectHash, ws = db.getWorkspace(workspaceId);
  if (!owner || !ws || ws.ownerSubjectHash !== owner || ws.archivedAt || ws.deletedAt) return fail('LOAN_OWNER_MISMATCH');
  return ws;
}
function wallet(db: LocalDatabase, workspaceId: string, accountId: string): Account {
  ownWorkspace(db, workspaceId);
  const a = db.getAccount(accountId);
  if (!a || a.workspaceId !== workspaceId || a.archivedAt || isLoanLedgerAccount(a.id) || (a.classification || 'asset') !== 'asset') return fail('LOAN_WALLET_UNAVAILABLE');
  return a;
}
function appendJournal(db: LocalDatabase, p: Posting, day: string, note: string, now: Date) {
  if (db.getRawState().journalTransactions.has(p.id)) return fail('LOAN_LEDGER_CONFLICT');
  const balanced: BalancedJournal = { transaction: { id: p.id, workspaceId: p.workspaceId, transactionType: p.type,
    effectiveDate: day, occurredAtUtc: now.toISOString(), occurredTimezoneOffsetMinutes: -360, createdAtUtc: now.toISOString(), createdOpId: '', note },
    lines: p.entries.map(([accountId, amount, categoryId], index) => ({ id: `${p.id}-${index}`, transactionId: p.id, accountId,
      debitMinor: BigInt(amount) > 0n ? amount : '0', creditMinor: BigInt(amount) < 0n ? (-BigInt(amount)).toString() : '0', categoryId })) };
  const op = db.queueSyncOp('journal.post', p.id, { balancedJournal: balanced });
  balanced.transaction.createdOpId = op.operationId;
  op.payload.balancedJournal.transaction.createdOpId = op.operationId;
  op.contentSha256 = computeSha256Sync(canonicalJson(op.payload));
  db.getRawState().journalTransactions.set(p.id, { ...balanced.transaction, lines: balanced.lines });
  for (const line of balanced.lines) db.getRawState().journalLines.set(line.id, line);
}
function queueEvent(db: LocalDatabase, e: LoanEvent, workspaceId: string) {
  db.queueSyncOp('workspace.update', workspaceId, { id: workspaceId, loanEvent: e });
}
function internalAccount(db: LocalDatabase, t: SavingsLoanTerms, side: 'receivable' | 'payable', now: Date) {
  const a: Account = { id: ledgerId(t.id, side), workspaceId: side === 'receivable' ? t.sourceWorkspaceId : t.borrowerWorkspaceId,
    name: side === 'receivable' ? 'Loan receivable · not a wallet' : 'Loan payable · not a wallet', kind: 'other',
    classification: side === 'receivable' ? 'asset' : 'liability', openingBalanceMinor: '0', archivedAt: now.toISOString(), createdAt: now.toISOString() };
  if (db.getAccount(a.id)) return fail('LOAN_LEDGER_CONFLICT');
  db.getRawState().accounts.set(a.id, a);
  db.queueSyncOp('account.create', a.id, { account: a });
}

export async function issueSavingsLoan(db: LocalDatabase, input: NewSavingsLoan, now = new Date()): Promise<string> {
  await db.beginTransaction();
  try {
    ownWorkspace(db, input.sourceWorkspaceId);
    const previous = readSavingsLoans(db.getRawState(), loanToday(now)).find(r => r.issue.terms.id === input.id);
    if (previous) {
      const t = previous.issue.terms;
      for (const key of ['goalId', 'sourceWorkspaceId', 'sourceAccountId', 'borrowerWorkspaceId', 'borrowerAccountId', 'principalMinor', 'dueDate', 'monthlyRateBps', 'repaymentOrder'] as const)
        if (input[key] !== t[key]) return fail('LOAN_EVENT_CONFLICT');
      if (input.purpose.trim() !== previous.issue.purpose) return fail('LOAN_EVENT_CONFLICT');
      if ((input.autoRepay ?? false) !== previous.issue.autoRepay) return fail('LOAN_EVENT_CONFLICT');
      await db.rollbackTransaction(); return input.id;
    }
    wallet(db, input.sourceWorkspaceId, input.sourceAccountId);
    wallet(db, input.borrowerWorkspaceId, input.borrowerAccountId);
    const terms = validateSavingsLoanTerms({ version: 1, id: input.id, ownerHash: db.getIdentity()!.ownerSubjectHash,
      goalId: input.goalId, sourceWorkspaceId: input.sourceWorkspaceId, sourceAccountId: input.sourceAccountId,
      borrowerWorkspaceId: input.borrowerWorkspaceId, borrowerAccountId: input.borrowerAccountId,
      principalMinor: input.principalMinor, dueDate: input.dueDate, issuedDate: loanToday(now), monthlyRateBps: input.monthlyRateBps,
      interestBasis: 'daily-30', repaymentOrder: input.repaymentOrder, timeZone: 'Asia/Dhaka', reminderMinute: 1140 });
    const projection = db.getSavingsProjection(terms.sourceWorkspaceId);
    if (projection.orphanAllocationCount || projection.orphanReleaseCount) return fail('LOAN_SYNC_INCOMPLETE');
    const goal = projection.goals.find(g => g.goal.id === terms.goalId);
    if (!goal || goal.deleted || goal.goal.archived) return fail('LOAN_GOAL_UNAVAILABLE');
    const contributions = goal.contributions.filter(c => c.accountId === terms.sourceAccountId && BigInt(c.fundedMinor) > 0n);
    if (contributions.reduce((total, c) => total + BigInt(c.fundedMinor), 0n) < BigInt(terms.principalMinor)) return fail('LOAN_INSUFFICIENT_RESERVED');
    let remaining = BigInt(terms.principalMinor);
    const releases: string[] = [];
    for (const contribution of contributions) {
      if (!remaining) break;
      const amount = remaining < BigInt(contribution.fundedMinor) ? remaining : BigInt(contribution.fundedMinor);
      const op = db.queueSyncOp('workspace.update', terms.sourceWorkspaceId, { id: terms.sourceWorkspaceId,
        savingsEvent: { version: 1, action: 'allocation.release', goalId: terms.goalId, allocationId: contribution.allocationId, amountMinor: amount.toString() } });
      releases.push(op.operationId); remaining -= amount;
    }
    const issue: Issue = { version: 1, action: 'issue', terms, purpose: input.purpose.trim(), executorDeviceId: db.getDeviceId(), autoRepay: input.autoRepay ?? false, releases };
    internalAccount(db, terms, 'receivable', now); internalAccount(db, terms, 'payable', now);
    for (const p of postings(issue)) appendJournal(db, p, terms.issuedDate, `Savings loan: ${issue.purpose}`, now);
    queueEvent(db, issue, terms.sourceWorkspaceId);
    if (readSavingsLoans(db.getRawState(), terms.issuedDate).find(r => r.issue.terms.id === terms.id)?.pendingReferences !== 0) return fail('LOAN_SYNC_INCOMPLETE');
    await db.commitTransaction();
    return input.id;
  } catch (error) { await db.rollbackTransaction(); throw error; }
}

export async function repaySavingsLoan(db: LocalDatabase, loanId: string, requestId: string, amountMinor?: string, now = new Date()): Promise<string> {
  identifier(requestId);
  await db.beginTransaction();
  try {
    const day = loanToday(now), row = readSavingsLoans(db.getRawState(), day).find(r => r.issue.terms.id === loanId);
    if (!row) return fail('LOAN_NOT_FOUND');
    const t = row.issue.terms;
    ownWorkspace(db, t.sourceWorkspaceId); ownWorkspace(db, t.borrowerWorkspaceId);
    if (row.issue.executorDeviceId !== db.getDeviceId()) return fail('LOAN_EXECUTOR_REQUIRED');
    const existing = row.payments.find(p => p.id === requestId);
    if (existing) {
      if (amountMinor !== undefined && amountMinor !== existing.amountMinor) return fail('LOAN_PAYMENT_CONFLICT');
      await db.rollbackTransaction(); return requestId;
    }
    if (row.pendingReferences) return fail('LOAN_SYNC_INCOMPLETE');
    wallet(db, t.sourceWorkspaceId, t.sourceAccountId); wallet(db, t.borrowerWorkspaceId, t.borrowerAccountId);
    const goal = db.getSavingsProjection(t.sourceWorkspaceId).goals.find(g => g.goal.id === t.goalId);
    if (!goal || goal.deleted || goal.goal.archived) return fail('LOAN_GOAL_UNAVAILABLE');
    const projection = db.getSavingsProjection(t.borrowerWorkspaceId);
    if (projection.orphanAllocationCount || projection.orphanReleaseCount) return fail('LOAN_SYNC_INCOMPLETE');
    const available = BigInt(projection.accounts.find(a => a.accountId === t.borrowerAccountId)?.availableMinor || '0');
    const due = BigInt(row.balance.totalDueMinor), maximum = available < due ? available : due;
    const amount = amountMinor === undefined ? maximum : zero(amountMinor) ? BigInt(amountMinor) : fail();
    if (amount <= 0n || amount > available) return fail('LOAN_INSUFFICIENT_AVAILABLE');
    const payment: SavingsLoanPayment = { id: requestId, loanId, effectiveDate: day, amountMinor: amount.toString() };
    const balance = projectSavingsLoan(t, [...row.payments, payment], day);
    const paid = balance.payments.find(p => p.id === requestId)!;
    const repayment: Repay = { version: 1, action: 'repay', loanId, payment, principalMinor: paid.principalMinor, interestMinor: paid.interestMinor };
    if (BigInt(paid.interestMinor) > 0n) for (const [workspaceId, kind] of [[t.sourceWorkspaceId, 'income'], [t.borrowerWorkspaceId, 'expense']] as const) {
      const id = categoryId(workspaceId, kind), existingCategory = db.getRawState().categories.get(id);
      if (existingCategory && (existingCategory.workspaceId !== workspaceId || existingCategory.kind !== kind)) return fail('LOAN_LEDGER_CONFLICT');
      if (!existingCategory) {
        const category: Category = { id, workspaceId, kind, name: kind === 'income' ? 'ঋণের সুদ পাওয়া' : 'ঋণের সুদ পরিশোধ', nameEn: kind === 'income' ? 'Loan interest received' : 'Loan interest paid' };
        db.getRawState().categories.set(id, category); db.queueSyncOp('category.create', id, { category });
      }
    }
    for (const p of postings(row.issue, repayment)) appendJournal(db, p, day, `Loan repayment: ${row.issue.purpose}`, now);
    if (BigInt(paid.principalMinor) > 0n) db.queueSyncOp('workspace.update', t.sourceWorkspaceId, { id: t.sourceWorkspaceId,
      savingsEvent: { version: 1, action: 'allocation.add', goalId: t.goalId, allocationId: allocationId(requestId), accountId: t.sourceAccountId,
        amountMinor: paid.principalMinor, note: 'Loan principal returned' } });
    queueEvent(db, repayment, t.sourceWorkspaceId);
    if (readSavingsLoans(db.getRawState(), day).find(r => r.issue.terms.id === loanId)?.pendingReferences !== 0) return fail('LOAN_SYNC_INCOMPLETE');
    await db.commitTransaction();
    return requestId;
  } catch (error) { await db.rollbackTransaction(); throw error; }
}
