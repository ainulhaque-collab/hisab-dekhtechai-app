import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toPaisa,
  parsePaisaString,
  paisaToDecimalString,
  formatBDT,
  toBengaliDigits,
  fromBengaliDigits,
  addPaisa,
  subPaisa
} from '../domain/money';
import {
  buildIncomeJournal,
  buildExpenseJournal,
  buildTransferJournal,
  buildOpeningBalanceJournal,
  buildReversalJournal,
  assertJournalBalanced
} from '../domain/journal';
import { computeOccurrenceId, evaluateBudget } from '../domain/recurring';
import { sanitizeCSVCell } from '../domain/csv';

test('Money domain: integer paisa conversion and exact math', () => {
  // 1250.50 BDT = 125050 paisa
  const p1 = parsePaisaString('1250.50');
  assert.equal(p1, 125050n);

  // Bengali numerals: ১২৫০.৫০
  const pBn = parsePaisaString('১২৫০.৫০');
  assert.equal(pBn, 125050n);

  // Formatting decimal string
  assert.equal(paisaToDecimalString(125050n), '1250.50');

  // South Asian grouping and Bengali display: 12500000 paisa = ৳1,25,000.00 -> ৳১,২৫,০০০.০০
  const formatted = formatBDT(12500000n, { locale: 'bn' });
  assert.equal(formatted, '৳১,২৫,০০০.০০');

  // Exact math without float errors
  const a = toPaisa('100.10'); // 10010
  const b = toPaisa('200.20'); // 20020
  assert.equal(addPaisa(a, b), 30030n);
  assert.equal(subPaisa(b, a), 10010n);
});

test('Double-entry journal: Income transaction balance invariant', () => {
  const journal = buildIncomeJournal({
    workspaceId: 'ws-1',
    assetAccountId: 'acc-cash',
    revenueCategoryId: 'cat-salary',
    amountMinor: '2500000', // ৳25,000.00 (2500000 paisa)
    effectiveDate: '2026-10-22',
    opId: 'op-1',
  });

  assert.equal(journal.lines.length, 2);
  // Debit: asset cash (2500000), Credit: 0
  const debitLine = journal.lines.find((l) => l.debitMinor === '2500000');
  assert.ok(debitLine);
  assert.equal(debitLine?.accountId, 'acc-cash');

  // Credit: revenue category (2500000), Debit: 0
  const creditLine = journal.lines.find((l) => l.creditMinor === '2500000');
  assert.ok(creditLine);
  assert.equal(creditLine?.categoryId, 'cat-salary');

  assert.doesNotThrow(() => assertJournalBalanced(journal.lines));
});

test('Double-entry journal: Transfer with fee balance invariant', () => {
  const journal = buildTransferJournal({
    workspaceId: 'ws-1',
    fromAssetAccountId: 'acc-bank',
    toAssetAccountId: 'acc-bkash',
    amountMinor: '500000', // ৳5,000.00
    feeMinor: '5000', // ৳50.00 fee
    feeExpenseCategoryId: 'cat-fee',
    effectiveDate: '2026-10-22',
    opId: 'op-2',
  });

  // Lines: Credit bank 500000, Debit bkash 500000, Credit bank 5000 (fee), Debit cat-fee 5000
  assert.equal(journal.lines.length, 4);

  // Total debits = 505000, total credits = 505000
  assert.doesNotThrow(() => assertJournalBalanced(journal.lines));
});

test('Double-entry journal: Unbalanced journal rejection', () => {
  const brokenLines = [
    {
      id: 'l1',
      transactionId: 't1',
      accountId: 'acc1',
      debitMinor: '1000',
      creditMinor: '0',
    },
    {
      id: 'l2',
      transactionId: 't1',
      accountId: 'acc2',
      debitMinor: '0',
      creditMinor: '900', // Unbalanced by 100
    },
  ];

  assert.throws(() => assertJournalBalanced(brokenLines), /Unbalanced journal entry/);
});

test('Reversal journal: inverts original debits and credits with audit reference', () => {
  const original = buildIncomeJournal({
    workspaceId: 'ws-1',
    assetAccountId: 'acc-cash',
    revenueCategoryId: 'cat-salary',
    amountMinor: '100000',
    effectiveDate: '2026-10-22',
    opId: 'op-orig',
  });

  const fullOriginal = {
    ...original.transaction,
    lines: original.lines,
  };

  const reversal = buildReversalJournal(fullOriginal, 'op-rev', 'User typo');
  assert.equal(reversal.transaction.reversalOf, fullOriginal.id);
  assert.equal(reversal.lines.length, 2);

  // Original debit line becomes credit line in reversal
  const revCredit = reversal.lines.find((l) => l.creditMinor === '100000');
  assert.ok(revCredit);
  assert.doesNotThrow(() => assertJournalBalanced(reversal.lines));
});

test('Deterministic recurring occurrence ID', () => {
  const id1 = computeOccurrenceId('rule-123', '2026-11-01', 1);
  const id2 = computeOccurrenceId('rule-123', '2026-11-01', 1);
  const idDiffDate = computeOccurrenceId('rule-123', '2026-11-02', 1);

  assert.equal(id1, id2, 'Same rule, date, and generation must yield identical occurrence ID');
  assert.notEqual(id1, idDiffDate, 'Different dates must yield different occurrence IDs');
});

test('CSV formula injection protection', () => {
  assert.equal(sanitizeCSVCell('=1+1'), `'=1+1`);
  assert.equal(sanitizeCSVCell('@SUM(A1:A10)'), `'@SUM(A1:A10)`);
  assert.equal(sanitizeCSVCell('-250'), `'-250`);
  assert.equal(sanitizeCSVCell('+8801700000000'), `'+8801700000000`);
  assert.equal(sanitizeCSVCell('Normal text'), 'Normal text');
});
