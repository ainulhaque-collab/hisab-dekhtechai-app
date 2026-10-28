/**
 * Pure savings-backed loan calculations. No database, bank or notification access.
 * A payment proposal is never proof that a journal/payment was committed.
 */
import { canonicalJson, computeSha256Sync } from '../sync/canonical';

export interface SavingsLoanTerms {
  version: 1;
  id: string;
  ownerHash: string;
  goalId: string;
  sourceWorkspaceId: string;
  sourceAccountId: string;
  borrowerWorkspaceId: string;
  borrowerAccountId: string;
  principalMinor: string;
  issuedDate: string;
  dueDate: string;
  /** 100 basis points = 1% per month; chosen separately for every loan. */
  monthlyRateBps: number;
  interestBasis: 'daily-30' | 'completed-months';
  repaymentOrder: 'principal-first' | 'interest-first';
  timeZone: string;
  reminderMinute: number;
}

export interface SavingsLoanPayment {
  id: string;
  loanId: string;
  effectiveDate: string;
  amountMinor: string;
}

export interface LoanPaymentBreakdown extends SavingsLoanPayment {
  principalMinor: string;
  interestMinor: string;
}

export interface SavingsLoanProjection {
  principalOutstandingMinor: string;
  interestOutstandingMinor: string;
  interestAccruedMinor: string;
  principalRepaidMinor: string;
  interestRepaidMinor: string;
  totalDueMinor: string;
  overdueDays: number;
  status: 'open' | 'overdue' | 'paid';
  payments: LoanPaymentBreakdown[];
}

const DAY = 86_400_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const POSITIVE = /^[1-9]\d{0,17}$/;
const SIGNED = /^(?:0|-?[1-9]\d{0,17})$/;
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
function fail(code = 'LOAN_INVALID_INPUT'): never { throw new Error(code); }

function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null || Object.getOwnPropertySymbols(value).length) return fail();
  for (const key of Object.getOwnPropertyNames(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.includes(key) || unsafe.has(key) || !property || !('value' in property)) return fail();
  }
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value) || unsafe.has(value)) return fail();
  return value;
}
function positive(value: unknown): string {
  if (typeof value !== 'string' || !POSITIVE.test(value)) return fail();
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return fail();
  const instant = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) return fail();
  return value;
}
const daysBetween = (start: string, end: string) =>
  (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / DAY;

export function validateSavingsLoanTerms(value: unknown): SavingsLoanTerms {
  const item = object(value, ['version', 'id', 'ownerHash', 'goalId', 'sourceWorkspaceId', 'sourceAccountId',
    'borrowerWorkspaceId', 'borrowerAccountId', 'principalMinor', 'issuedDate', 'dueDate', 'monthlyRateBps',
    'interestBasis', 'repaymentOrder', 'timeZone', 'reminderMinute']);
  if (item.version !== 1 || !['daily-30', 'completed-months'].includes(item.interestBasis as string) ||
      !['principal-first', 'interest-first'].includes(item.repaymentOrder as string) ||
      !Number.isSafeInteger(item.monthlyRateBps) || (item.monthlyRateBps as number) < 0 ||
      (item.monthlyRateBps as number) > 1_000_000 || !Number.isInteger(item.reminderMinute) ||
      (item.reminderMinute as number) < 0 || (item.reminderMinute as number) > 1439 ||
      typeof item.timeZone !== 'string' || item.timeZone.length > 80) return fail();
  try { new Intl.DateTimeFormat('en-GB', { timeZone: item.timeZone as string }); } catch { return fail(); }
  const result: SavingsLoanTerms = {
    version: 1, id: id(item.id), ownerHash: id(item.ownerHash), goalId: id(item.goalId),
    sourceWorkspaceId: id(item.sourceWorkspaceId), sourceAccountId: id(item.sourceAccountId),
    borrowerWorkspaceId: id(item.borrowerWorkspaceId), borrowerAccountId: id(item.borrowerAccountId),
    principalMinor: positive(item.principalMinor), issuedDate: date(item.issuedDate), dueDate: date(item.dueDate),
    monthlyRateBps: item.monthlyRateBps as number, interestBasis: item.interestBasis as SavingsLoanTerms['interestBasis'],
    repaymentOrder: item.repaymentOrder as SavingsLoanTerms['repaymentOrder'], timeZone: item.timeZone as string,
    reminderMinute: item.reminderMinute as number,
  };
  if (result.sourceAccountId === result.borrowerAccountId || result.dueDate < result.issuedDate) return fail();
  return result;
}

function payment(value: unknown, terms: SavingsLoanTerms): SavingsLoanPayment {
  const item = object(value, ['id', 'loanId', 'effectiveDate', 'amountMinor']);
  const result = { id: id(item.id), loanId: id(item.loanId), effectiveDate: date(item.effectiveDate), amountMinor: positive(item.amountMinor) };
  if (result.loanId !== terms.id || result.effectiveDate < terms.issuedDate) return fail('LOAN_PAYMENT_REFERENCE');
  return result;
}

function anniversary(due: string, months: number): string {
  const year = Number(due.slice(0, 4)), month = Number(due.slice(5, 7)), day = Number(due.slice(8, 10));
  const serial = (year - 1) * 12 + month - 1 + months;
  const targetYear = Math.floor(serial / 12) + 1, targetMonth = serial % 12 + 1;
  const prefix = `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}`;
  for (let candidate = day; candidate >= 28; candidate--) {
    const value = `${prefix}-${String(candidate).padStart(2, '0')}`;
    if (new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value) return value;
  }
  return `${prefix}-${String(day).padStart(2, '0')}`;
}

function fullMonths(due: string, end: string): number {
  if (end <= due) return 0;
  const months = (Number(end.slice(0, 4)) - Number(due.slice(0, 4))) * 12 +
    Number(end.slice(5, 7)) - Number(due.slice(5, 7));
  return Math.max(0, months - (end < anniversary(due, months) ? 1 : 0));
}

function split(amount: bigint, principal: bigint, interest: bigint, order: SavingsLoanTerms['repaymentOrder']) {
  if (amount > principal + interest) return fail('LOAN_OVERPAYMENT');
  if (order === 'principal-first') {
    const principalPaid = amount < principal ? amount : principal;
    return { principalPaid, interestPaid: amount - principalPaid };
  }
  const interestPaid = amount < interest ? amount : interest;
  return { principalPaid: amount - interestPaid, interestPaid };
}

/**
 * Accrues before each payment on its effective date. Daily-30 accrues monthly
 * rate/30 per late day. Completed-months charges at due-date anniversaries,
 * clamped to month end. Interest never becomes principal. Fractions carry across
 * payment segments and round down once to whole paisa, avoiding daily rounding.
 */
export function projectSavingsLoan(input: SavingsLoanTerms, records: readonly SavingsLoanPayment[], asOfDate: string): SavingsLoanProjection {
  const terms = validateSavingsLoanTerms(input), asOf = date(asOfDate);
  if (asOf < terms.issuedDate || !Array.isArray(records) || records.length > 100_000) return fail();
  const unique = new Map<string, SavingsLoanPayment>();
  for (const record of records) {
    const next = payment(record, terms), existing = unique.get(next.id);
    if (existing && canonicalJson(existing) !== canonicalJson(next)) return fail('LOAN_PAYMENT_CONFLICT');
    unique.set(next.id, next);
  }
  const payments = [...unique.values()].filter(item => item.effectiveDate <= asOf)
    .sort((a, b) => a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  let principal = BigInt(terms.principalMinor), interestNumerator = 0n, interestPaid = 0n;
  let cursor = terms.issuedDate;
  const denominator = terms.interestBasis === 'daily-30' ? 300_000n : 10_000n;
  const accrue = (end: string) => {
    const start = cursor > terms.dueDate ? cursor : terms.dueDate;
    if (end > start && principal > 0n) {
      const units = terms.interestBasis === 'daily-30' ? daysBetween(start, end) : fullMonths(terms.dueDate, end) - fullMonths(terms.dueDate, start);
      interestNumerator += principal * BigInt(terms.monthlyRateBps) * BigInt(units);
    }
    cursor = end;
  };
  const breakdowns: LoanPaymentBreakdown[] = [];
  for (const item of payments) {
    accrue(item.effectiveDate);
    const paid = split(BigInt(item.amountMinor), principal, interestNumerator / denominator - interestPaid, terms.repaymentOrder);
    principal -= paid.principalPaid;
    interestPaid += paid.interestPaid;
    breakdowns.push({ ...item, principalMinor: paid.principalPaid.toString(), interestMinor: paid.interestPaid.toString() });
  }
  accrue(asOf);
  const interestAccrued = interestNumerator / denominator, remainingInterest = interestAccrued - interestPaid;
  const total = principal + remainingInterest;
  return {
    principalOutstandingMinor: principal.toString(), interestOutstandingMinor: remainingInterest.toString(),
    interestAccruedMinor: interestAccrued.toString(), principalRepaidMinor: (BigInt(terms.principalMinor) - principal).toString(),
    interestRepaidMinor: interestPaid.toString(), totalDueMinor: total.toString(),
    overdueDays: Math.max(0, daysBetween(terms.dueDate, asOf)),
    status: total === 0n ? 'paid' : asOf > terms.dueDate ? 'overdue' : 'open', payments: breakdowns,
  };
}

function jobId(terms: SavingsLoanTerms, type: 'reminder' | 'repayment', day: string): string {
  return `loan-${type}-${computeSha256Sync(canonicalJson({ version: 1, owner: terms.ownerHash, loan: terms.id, day }))}`;
}

export type LoanAutoRepaymentPlan =
  | { status: 'not-due' | 'paid' | 'no-available-money' | 'already-recorded'; amountMinor: '0' }
  | { status: 'proposal'; payment: SavingsLoanPayment; amountMinor: string; principalMinor: string; interestMinor: string };

/** availableMinor MUST exclude all other savings reservations. Caller still needs
 * a coordinated fresh-balance check and atomic financial commit, not just this ID. */
export function planLoanAutoRepayment(input: SavingsLoanTerms, records: readonly SavingsLoanPayment[], asOfDate: string,
  availableMinor: string): LoanAutoRepaymentPlan {
  const terms = validateSavingsLoanTerms(input), projected = projectSavingsLoan(terms, records, asOfDate);
  if (typeof availableMinor !== 'string' || !SIGNED.test(availableMinor)) return fail();
  if (projected.status === 'paid') return { status: 'paid', amountMinor: '0' };
  if (asOfDate < terms.dueDate) return { status: 'not-due', amountMinor: '0' };
  const paymentId = jobId(terms, 'repayment', asOfDate);
  if (records.some(record => record.id === paymentId)) return { status: 'already-recorded', amountMinor: '0' };
  const available = BigInt(availableMinor), due = BigInt(projected.totalDueMinor);
  if (available <= 0n) return { status: 'no-available-money', amountMinor: '0' };
  const amount = available < due ? available : due;
  const paid = split(amount, BigInt(projected.principalOutstandingMinor), BigInt(projected.interestOutstandingMinor), terms.repaymentOrder);
  return { status: 'proposal', payment: { id: paymentId, loanId: terms.id, effectiveDate: asOfDate, amountMinor: amount.toString() },
    amountMinor: amount.toString(), principalMinor: paid.principalPaid.toString(), interestMinor: paid.interestPaid.toString() };
}

/** One logical reminder per loan/local day; keep sending after due until paid.
 * Dedup persistence and actual push transport belong to the delivery service. */
export function planLoanReminder(input: SavingsLoanTerms, records: readonly SavingsLoanPayment[], now: Date):
  { id: string; loanId: string; localDate: string; daysUntilDue: number; kind: 'upcoming' | 'due' | 'overdue' } | null {
  const terms = validateSavingsLoanTerms(input);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return fail();
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: terms.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  const day = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
  date(day);
  if (day < terms.issuedDate) return null;
  const daysUntilDue = daysBetween(day, terms.dueDate);
  if (daysUntilDue > 7 || Number(part('hour')) * 60 + Number(part('minute')) < terms.reminderMinute ||
      projectSavingsLoan(terms, records, day).status === 'paid') return null;
  return { id: jobId(terms, 'reminder', day), loanId: terms.id, localDate: day, daysUntilDue,
    kind: daysUntilDue > 0 ? 'upcoming' : daysUntilDue === 0 ? 'due' : 'overdue' };
}
