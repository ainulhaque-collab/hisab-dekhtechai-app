import test from 'node:test';
import assert from 'node:assert/strict';
import { planLoanAutoRepayment, planLoanReminder, projectSavingsLoan, validateSavingsLoanTerms,
  type SavingsLoanPayment, type SavingsLoanTerms } from '../domain/savingsLoans';

const terms = (overrides: Partial<SavingsLoanTerms> = {}): SavingsLoanTerms => ({
  version: 1, id: 'loan-1', ownerHash: 'owner-1', goalId: 'goal-1', sourceWorkspaceId: 'personal', sourceAccountId: 'savings',
  borrowerWorkspaceId: 'business', borrowerAccountId: 'business-cash', principalMinor: '1000000',
  issuedDate: '2026-10-01', dueDate: '2026-10-31', monthlyRateBps: 200, interestBasis: 'daily-30',
  repaymentOrder: 'principal-first', timeZone: 'Asia/Dhaka', reminderMinute: 9 * 60, ...overrides,
});
const payment = (id: string, effectiveDate: string, amountMinor: string): SavingsLoanPayment => ({ id, loanId: 'loan-1', effectiveDate, amountMinor });

test('Loans: no interest before/on due date; one month daily-30 simple interest never compounds', () => {
  for (const day of ['2026-10-01', '2026-10-30', '2026-10-31']) {
    const result = projectSavingsLoan(terms(), [], day);
    assert.equal(result.interestAccruedMinor, '0');
    assert.equal(result.totalDueMinor, '1000000');
    assert.equal(result.status, 'open');
  }
  assert.equal(projectSavingsLoan(terms(), [], '2026-11-30').interestAccruedMinor, '20000');
  assert.equal(projectSavingsLoan(terms(), [], '2026-12-30').interestAccruedMinor, '40000');
  assert.equal(projectSavingsLoan(terms(), [], '2026-12-30').principalOutstandingMinor, '1000000');
});

test('Loans: partial principal repayment reduces future simple interest without counting repayments as principal', () => {
  const records = [payment('partial', '2026-11-15', '500000')];
  const result = projectSavingsLoan(terms(), records, '2026-11-30');
  assert.equal(result.principalRepaidMinor, '500000');
  assert.equal(result.principalOutstandingMinor, '500000');
  assert.equal(result.interestAccruedMinor, '15000'); // 15 days on 10,000 + 15 days on 5,000 BDT.
  assert.equal(result.interestRepaidMinor, '0');
  assert.equal(result.totalDueMinor, '515000');
  assert.equal(projectSavingsLoan(terms(), [...records, payment('finish', '2026-11-30', '515000')], '2027-12-31').status, 'paid');
});

test('Loans: explicit interest-first allocation remains distinct and never capitalizes unpaid interest', () => {
  const contract = terms({ repaymentOrder: 'interest-first' });
  const result = projectSavingsLoan(contract, [payment('partial', '2026-11-30', '30000')], '2026-12-30');
  assert.deepEqual(result.payments.map(item => [item.principalMinor, item.interestMinor]), [['10000', '20000']]);
  assert.equal(result.principalOutstandingMinor, '990000');
  assert.equal(result.interestAccruedMinor, '39800');
  assert.equal(result.interestOutstandingMinor, '19800');
});

test('Loans: completed-month anniversaries clamp month ends and respect leap years', () => {
  const contract = terms({ issuedDate: '2028-01-01', dueDate: '2028-01-31', interestBasis: 'completed-months' });
  assert.equal(projectSavingsLoan(contract, [], '2028-02-28').interestAccruedMinor, '0');
  assert.equal(projectSavingsLoan(contract, [], '2028-02-29').interestAccruedMinor, '20000');
  assert.equal(projectSavingsLoan(contract, [], '2028-03-30').interestAccruedMinor, '20000');
  assert.equal(projectSavingsLoan(contract, [], '2028-03-31').interestAccruedMinor, '40000');
  const repayments = [payment('partial', '2028-02-29', '500000')];
  assert.equal(projectSavingsLoan(contract, repayments, '2028-03-31').interestAccruedMinor, '30000');
  const ordinary = terms({ issuedDate: '2026-01-01', dueDate: '2026-01-31', interestBasis: 'completed-months' });
  assert.equal(projectSavingsLoan(ordinary, [], '2026-02-28').interestAccruedMinor, '20000');
});

test('Loans: fractional paisa carries across repayment segments with no floating point loss', () => {
  const contract = terms({ principalMinor: '100', monthlyRateBps: 100 });
  const result = projectSavingsLoan(contract, [payment('one-paisa', '2026-11-15', '1')], '2026-12-01');
  assert.equal(result.interestAccruedMinor, '1'); // (100*100*15 + 99*100*16)/300000, rounded once.
  assert.equal(result.principalOutstandingMinor, '99');
  const large = projectSavingsLoan(terms({ principalMinor: '999999999999999999' }), [], '2026-11-30');
  assert.equal(large.interestAccruedMinor, '19999999999999999');
});

test('Loans: immutable replay deduplicates, sorts and rejects conflicts/overpayments', () => {
  const records = [payment('first', '2026-10-15', '100000'), payment('second', '2026-11-10', '50000')];
  const result = projectSavingsLoan(terms(), records, '2026-11-30');
  assert.deepEqual(projectSavingsLoan(terms(), [...records].reverse().concat(records), '2026-11-30'), result);
  assert.throws(() => projectSavingsLoan(terms(), [...records, { ...records[0], amountMinor: '1' }], '2026-11-30'), /LOAN_PAYMENT_CONFLICT/);
  assert.throws(() => projectSavingsLoan(terms(), [payment('too-much', '2026-10-31', '1000001')], '2026-10-31'), /LOAN_OVERPAYMENT/);
  assert.throws(() => projectSavingsLoan(terms(), [{ ...records[0], loanId: 'other-loan' }], '2026-11-30'), /LOAN_PAYMENT_REFERENCE/);
  assert.throws(() => projectSavingsLoan(terms(), [payment('too-early', '2026-09-30', '1')], '2026-11-30'), /LOAN_PAYMENT_REFERENCE/);
  assert.equal(projectSavingsLoan(terms(), records, '2026-10-16').principalRepaidMinor, '100000');
});

test('Loans: strict terms reject unknown fields, unsafe objects, invalid dates/rates/zones and missing policy', () => {
  const contract = terms();
  assert.deepEqual(validateSavingsLoanTerms(contract), contract);
  for (const changes of [{ version: 2 }, { principalMinor: '0' }, { principalMinor: '-1' }, { principalMinor: '1.5' },
    { principalMinor: '01' }, { dueDate: '2026-02-30' }, { dueDate: '2026-09-30' }, { timeZone: 'Not/AZone' },
    { interestBasis: 'compound' }, { repaymentOrder: undefined }, { monthlyRateBps: 0.5 }, { monthlyRateBps: -1 },
    { reminderMinute: 1440 }, { reminderMinute: -1 }, { sourceAccountId: contract.borrowerAccountId },
    { id: '__proto__' }, { unknown: true }]) {
    assert.throws(() => validateSavingsLoanTerms({ ...contract, ...changes }));
  }
  assert.throws(() => validateSavingsLoanTerms(Object.assign(Object.create({ hidden: 1 }), contract)));
  const getter = { ...contract };
  Object.defineProperty(getter, 'principalMinor', { get() { throw new Error('getter must not run'); }, enumerable: true });
  assert.throws(() => validateSavingsLoanTerms(getter), /LOAN_INVALID_INPUT/);
  assert.throws(() => projectSavingsLoan(contract, [], '2026-09-30'));
});

test('Loans: automatic partial repayment proposes only available money and becomes idempotent after commit', () => {
  const contract = terms(), before = JSON.stringify(contract);
  assert.equal(planLoanAutoRepayment(contract, [], '2026-10-30', '500000').status, 'not-due');
  for (const available of ['0', '-1000']) assert.equal(planLoanAutoRepayment(contract, [], '2026-10-31', available).status, 'no-available-money');
  const plan = planLoanAutoRepayment(contract, [], '2026-10-31', '300000');
  assert.equal(plan.status, 'proposal');
  if (plan.status !== 'proposal') throw new Error('Expected proposal');
  assert.equal(plan.amountMinor, '300000');
  assert.equal(plan.principalMinor, '300000');
  assert.equal(plan.interestMinor, '0');
  assert.deepEqual(planLoanAutoRepayment(structuredClone(contract), [], '2026-10-31', '300000'), plan);
  assert.equal(planLoanAutoRepayment(contract, [plan.payment], '2026-10-31', '0').status, 'no-available-money');
  const laterSameDay = planLoanAutoRepayment(contract, [plan.payment], '2026-10-31', '100000');
  assert.equal(laterSameDay.status, 'proposal');
  if (laterSameDay.status === 'proposal') assert.notEqual(laterSameDay.payment.id, plan.payment.id);
  const next = planLoanAutoRepayment(contract, [plan.payment], '2026-11-01', '900000');
  assert.equal(next.status, 'proposal');
  if (next.status !== 'proposal') throw new Error('Expected proposal');
  assert.equal(next.amountMinor, '700466');
  assert.equal(next.principalMinor, '700000');
  assert.equal(next.interestMinor, '466');
  assert.notEqual(next.payment.id, plan.payment.id);
  assert.equal(planLoanAutoRepayment(contract, [plan.payment, next.payment], '2027-01-01', '100').status, 'paid');
  assert.equal(JSON.stringify(contract), before, 'Planning must not mutate loan or commit money');
  assert.throws(() => planLoanAutoRepayment(contract, [], '2026-10-31', '1.00'));
});

test('Loans: reminder starts seven days before due at chosen Dhaka time and has stable daily/owner IDs', () => {
  const contract = terms();
  assert.equal(planLoanReminder(contract, [], new Date('2026-10-23T03:00:00Z')), null);
  assert.equal(planLoanReminder(contract, [], new Date('2026-10-24T02:59:59Z')), null);
  const reminder = planLoanReminder(contract, [], new Date('2026-10-24T03:00:00Z'))!;
  assert.equal(reminder.localDate, '2026-10-24');
  assert.equal(reminder.daysUntilDue, 7);
  assert.equal(reminder.kind, 'upcoming');
  assert.equal(planLoanReminder(contract, [], new Date('2026-10-24T17:59:59Z'))!.id, reminder.id);
  assert.notEqual(planLoanReminder(contract, [], new Date('2026-10-25T03:00:00Z'))!.id, reminder.id);
  assert.notEqual(planLoanReminder(terms({ ownerHash: 'owner-2' }), [], new Date('2026-10-24T03:00:00Z'))!.id, reminder.id);
  assert.equal(planLoanReminder(contract, [], new Date('2026-10-31T03:00:00Z'))!.kind, 'due');
  assert.equal(planLoanReminder(contract, [], new Date('2026-11-01T03:00:00Z'))!.kind, 'overdue');
});

test('Loans: reminder cancellation, short loans and local-date midnight work without leaking state', () => {
  const contract = terms();
  assert.equal(planLoanReminder(contract, [payment('paid', '2026-10-20', '1000000')], new Date('2026-10-24T03:00:00Z')), null);
  assert.equal(planLoanReminder(terms({ issuedDate: '2026-10-29' }), [], new Date('2026-10-28T03:00:00Z')), null);
  assert.ok(planLoanReminder(terms({ issuedDate: '2026-10-29' }), [], new Date('2026-10-29T03:00:00Z')));
  assert.equal(planLoanReminder(terms({ reminderMinute: 0 }), [], new Date('2026-10-23T18:00:00Z'))!.localDate, '2026-10-24');
  assert.throws(() => planLoanReminder(contract, [], new Date(NaN)));
  assert.equal(projectSavingsLoan(terms({ monthlyRateBps: 0 }), [payment('paid', '2027-01-01', '1000000')], '2028-01-01').status, 'paid');
});
