import { writeFile,mkdir } from 'node:fs/promises';
import { LocalDatabase } from '../src/storage/db';
import { LocalStorageFallbackDriver } from '../src/storage/drivers/durableStorage';
import { buildIncomeJournal,buildExpenseJournal,generateUUID } from '../src/domain/journal';
import { canonicalJson,computeSha256Sync } from '../src/sync/canonical';

const db=new LocalDatabase(`synthetic-reports-${generateUUID()}`,new LocalStorageFallbackDriver());await db.init();
await db.beginTransaction();db.editWorkspace('ws-personal-default',{name:'Synthetic QA — পরীক্ষার হিসাব'});await db.commitTransaction();
for(let i=0;i<9;i++) {
  const journal=i===0?buildIncomeJournal({workspaceId:'ws-personal-default',assetAccountId:'acc-cash-1',revenueCategoryId:'cat-salary',amountMinor:'1000000',effectiveDate:'2026-10-01',note:'Synthetic QA income',opId:generateUUID()}):buildExpenseJournal({workspaceId:'ws-personal-default',assetAccountId:'acc-cash-1',expenseCategoryId:'cat-food',amountMinor:i===8?'40000':'10000',effectiveDate:i>=6?'2026-10-29':`2026-10-0${i+1}`,note:'Synthetic QA — খাবার',opId:generateUUID()});
  const payload={balancedJournal:journal};
  await db.commitJournalWithOutbox(journal,{protocolVersion:1,ownerHash:'local-owner',deviceId:db.getDeviceId(),seq:db.getNextDeviceSeq(),operationId:journal.transaction.createdOpId,entityId:journal.transaction.id,type:'journal.post',payload,createdAtUtc:new Date().toISOString(),contentSha256:computeSha256Sync(canonicalJson(payload))});
}
await mkdir('build/feature-selection-qa',{recursive:true});
await writeFile('build/feature-selection-qa/synthetic-reports-backup.json',await db.exportBackupFile());
console.log('SYNTHETIC_REPORT_FIXTURE_READY: 9 entries, no owner identity, no external upload.');
