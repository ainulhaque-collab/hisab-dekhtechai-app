import test from 'node:test';
import assert from 'node:assert/strict';
import { reportDocument } from '../domain/reportDocument';
import { buildFinancialReport } from '../domain/financialReports';
import { buildIncomeJournal } from '../domain/journal';
import type { Account } from '../contracts/types';

test('print document escapes private text, embeds no remote resources, and preserves scoped integer amounts',()=>{
  const journal=buildIncomeJournal({workspaceId:'test',assetAccountId:'cash',revenueCategoryId:'salary',amountMinor:'9007199254740993123',effectiveDate:'2026-10-29',opId:'synthetic',note:'<img src="https://evil.invalid"> & বাংলা'});
  const report=buildFinancialReport({workspaceId:'test',from:'2026-10-01',to:'2026-10-31',accounts:[{id:'cash',workspaceId:'test',classification:'asset',openingBalanceMinor:'0'} as Account],transactions:[{...journal.transaction,lines:journal.lines}]});
  const html=reportDocument(report,{workspace:'<script>owner</script>',scope:'Cash & bank',language:'bn'});
  assert.match(html,/&lt;script&gt;owner&lt;\/script&gt;/);assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<script|<img|NaN|Infinity|\bfetch\(/);
  assert.match(html,/font-src data:/);assert.match(html,/বাংলা/);assert.match(html,/৯/);
  assert.equal((html.match(/<tr>/g)||[]).length,2);
  assert.throws(()=>reportDocument({...report,entries:Array(2001).fill(report.entries[0])},{workspace:'',scope:'',language:'en'}),/REPORT_TOO_LARGE/);
});
