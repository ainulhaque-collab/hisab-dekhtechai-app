import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildFinancialReport, previousReportPeriod, reviewSpending, validReportDate, UNALLOCATED_REPORT_CATEGORY } from '../domain/financialReports';
import { buildExpenseJournal, buildIncomeJournal, buildTransferJournal, buildReversalJournal } from '../domain/journal';
import type { Account, BalancedJournal, JournalTransaction } from '../contracts/types';

const accounts: Account[] = ['cash','bank'].map(id => ({ id, workspaceId:'workspace', name:id, kind:'cash', openingBalanceMinor:id==='cash'?'100000':'0', createdAt:'2026-01-01T00:00:00Z' }));
const tx = (journal: BalancedJournal): JournalTransaction => ({ ...journal.transaction, lines:journal.lines });
const expense = (amountMinor: string, day='2026-10-25') => tx(buildExpenseJournal({ workspaceId:'workspace', assetAccountId:'cash', expenseCategoryId:'food', amountMinor, effectiveDate:day, opId:randomUUID() }));
const income = (amountMinor: string, day='2026-10-25') => tx(buildIncomeJournal({ workspaceId:'workspace', assetAccountId:'cash', revenueCategoryId:'salary', amountMinor, effectiveDate:day, opId:randomUUID() }));
const scope = (transactions: JournalTransaction[]) => ({ workspaceId:'workspace', from:'2026-10-01', to:'2026-10-31', accounts, transactions });

test('reports replay reversed/deleted journals for cash but exclude them from active spending; transfer fees count once', () => {
  const deleted = { ...expense('20000'), isDeleted:true };
  const replacement = expense('8000');
  const replaced = { ...expense('7000'), isReplacedBy:replacement.id };
  const transfer = tx(buildTransferJournal({ workspaceId:'workspace', fromAssetAccountId:'cash', toAssetAccountId:'bank', amountMinor:'10000', feeMinor:'500', feeExpenseCategoryId:'fee', effectiveDate:'2026-10-25', opId:randomUUID() }));
  const transactions = [income('50000'),expense('12000'),transfer,deleted,tx(buildReversalJournal(deleted,randomUUID(),'cancel')),replaced,tx(buildReversalJournal(replaced,randomUUID(),'correct')),replacement];
  const frozen = JSON.stringify(transactions);
  const report = buildFinancialReport(scope(transactions));
  assert.equal(report.incomeMinor,'50000'); assert.equal(report.expenseMinor,'20500');
  assert.equal(report.netMinor,'29500'); assert.equal(report.closingWalletMinor,'129500');
  assert.equal(report.categories.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n),20500n);
  assert.equal(report.entries.length,4); assert.equal(JSON.stringify(transactions),frozen);
  const source = buildFinancialReport({ ...scope(transactions), accountIds:['cash'] });
  const target = buildFinancialReport({ ...scope(transactions), accountIds:['bank'] });
  assert.equal(source.expenseMinor,'20500'); assert.equal(source.closingWalletMinor,'119500');
  assert.equal(target.incomeMinor,'0'); assert.equal(target.expenseMinor,'0'); assert.equal(target.closingWalletMinor,'10000');
});

test('wallet scope is explicit, excludes foreign workspace/internal loan assets, and retains archived wallets', () => {
  const archived = { ...accounts[0], archivedAt:'2026-10-26T00:00:00Z' };
  const records = [income('100'),{ ...income('999999'), workspaceId:'foreign' }];
  const report = buildFinancialReport({ ...scope(records), accounts:[archived,accounts[1],{ ...accounts[0], id:'sl-account-receivable', openingBalanceMinor:'999999' },{ ...accounts[0], id:'foreign',workspaceId:'foreign',openingBalanceMinor:'888888' }] });
  assert.equal(report.closingWalletMinor,'100100'); assert.equal(report.incomeMinor,'100');
  const empty = buildFinancialReport({ ...scope(records), accountIds:[] });
  assert.equal(empty.entries.length,0); assert.equal(empty.openingWalletMinor,'0'); assert.equal(empty.closingWalletMinor,'0');
});

test('period opening/closing replay past cash and preserve integer paisa above Number safe range', () => {
  const huge = '900719925474099312345';
  const report = buildFinancialReport({ ...scope([income('123','2026-09-30'), expense('47')]), accounts:[{ ...accounts[0], openingBalanceMinor:huge }] });
  assert.equal(report.openingWalletMinor,(BigInt(huge)+123n).toString());
  assert.equal(report.closingWalletMinor,(BigInt(huge)+76n).toString());
  assert.equal(report.incomeMinor,'0'); assert.equal(report.expenseMinor,'47');
});

test('partial multi-wallet reports retain exact totals without inventing category allocation', () => {
  const record = expense('300');
  record.lines = [
    {id:'a',transactionId:record.id,accountId:'cash',debitMinor:'0',creditMinor:'100'},
    {id:'b',transactionId:record.id,accountId:'bank',debitMinor:'0',creditMinor:'200'},
    {id:'c',transactionId:record.id,accountId:'__system__expense_clearing',categoryId:'food',debitMinor:'100',creditMinor:'0'},
    {id:'d',transactionId:record.id,accountId:'__system__expense_clearing',categoryId:'fee',debitMinor:'200',creditMinor:'0'}
  ];
  const partial = buildFinancialReport({...scope([record]),accountIds:['cash']});
  assert.equal(partial.expenseMinor,'100');
  assert.deepEqual(partial.categories,[{id:UNALLOCATED_REPORT_CATEGORY,amountMinor:'100'}]);
  assert.equal(buildFinancialReport(scope([record])).categories.reduce((sum,item)=>sum+BigInt(item.amountMinor),0n),300n);
});

test('spending review suggests possible duplicates and category outliers without changing records', () => {
  const history = [1,2,3,4,5].map(day=>expense('10000',`2026-09-${String(day).padStart(2,'0')}`));
  const repeated = [expense('12000'),expense('12000')], unusual = expense('40000','2026-10-26');
  const records = [...history,...repeated,unusual]; const before = JSON.stringify(records);
  const review = reviewSpending(scope(records));
  assert.equal(review.filter(item=>item.kind==='possible-duplicate').length,1);
  assert.deepEqual(new Set(review.find(item=>item.kind==='possible-duplicate')!.transactionIds),new Set(repeated.map(item=>item.id)));
  assert.equal(review.find(item=>item.kind==='unusual-expense')?.baselineMinor,'10000');
  assert.deepEqual(review.find(item=>item.kind==='unusual-expense')?.transactionIds,[unusual.id]);
  assert.equal(JSON.stringify(records),before);
  assert.equal(reviewSpending(scope([unusual])).filter(item=>item.kind==='unusual-expense').length,0);
});

test('report dates, equal-length weekly comparison and duplicate source IDs fail safely', () => {
  assert.equal(validReportDate('2024-02-29'),true); assert.equal(validReportDate('2026-02-29'),false); assert.equal(validReportDate('0000-01-01'),false);
  assert.deepEqual(previousReportPeriod('2026-10-23','2026-10-29'),{from:'2026-10-16',to:'2026-10-22'});
  assert.deepEqual(previousReportPeriod('2024-03-01','2024-03-01'),{from:'2024-02-29',to:'2024-02-29'});
  assert.throws(()=>buildFinancialReport({...scope([]),from:'2026-11-01'}),/REPORT_DATE_INVALID/);
  const item = income('1'); assert.throws(()=>buildFinancialReport(scope([item,item])),/REPORT_DUPLICATE_TRANSACTION/);
});
