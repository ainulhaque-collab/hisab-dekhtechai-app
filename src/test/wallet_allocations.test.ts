import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalDatabase} from '../storage/db';
import {LocalStorageFallbackDriver} from '../storage/drivers/durableStorage';
import {createMasterWallet,linkMasterWallet,transferAllocation,walletSummaries,readWalletBook,allocationJournalId,changeMasterWallet,walletDeletionBlocker} from '../storage/walletBook';
import {buildExpenseJournal,buildTransferJournal,generateUUID} from '../domain/journal';
import {canonicalJson,computeSha256Sync} from '../sync/canonical';
import {decodeBackup} from '../storage/backup';
import type {BalancedJournal} from '../contracts/types';

async function setup(){
  const driver=new LocalStorageFallbackDriver(),key=`synthetic-wallets-${generateUUID()}`,db=new LocalDatabase(key,driver);await db.init();
  db.setIdentity('synthetic-wallet-owner');for(const w of db.getRawState().workspaces.values())w.ownerSubjectHash='synthetic-wallet-owner';
  const home=db.getWorkspace('ws-personal-default')!,business=db.createWorkspace('Synthetic shop','business');
  await db.waitForPendingWrites();
  const wallet=await createMasterWallet(db,{id:generateUUID(),name:'Synthetic bKash',kind:'bkash',openingBalanceMinor:'1000000'});
  const personal=walletSummaries(db)[0].allocations[0],biz=await linkMasterWallet(db,wallet.code,business.id);
  return{db,driver,key,home,business,wallet,personal,biz};
}
async function post(db:LocalDatabase,balanced:BalancedJournal){
  const tx=balanced.transaction,op={protocolVersion:1 as const,ownerHash:'synthetic-wallet-owner',deviceId:db.getDeviceId(),seq:0,
    operationId:tx.createdOpId,entityId:tx.id,type:'journal.post' as const,createdAtUtc:new Date().toISOString(),payload:{balancedJournal:balanced},contentSha256:computeSha256Sync(canonicalJson({balancedJournal:balanced}))};
  return db.commitJournalWithOutbox(balanced,op);
}
const core=(db:LocalDatabase)=>canonicalJson({accounts:db.toSerializable().accounts,journals:db.toSerializable().journalTransactions,lines:db.toSerializable().journalLines,identity:db.getIdentity()});

test('wallets: code links zero-funded allocations; income/expense remain workspace-specific and physical cash is counted once',async()=>{
  const {db,wallet,personal,biz,business}=await setup();
  assert.equal(walletSummaries(db)[0].balanceMinor,'1000000');assert.equal(biz.openingBalanceMinor,'0');
  const transfer={id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:biz.id,amountMinor:'600000'};
  const before=db.getPendingOutbox().length;await transferAllocation(db,transfer);
  assert.equal(db.getPendingOutbox().length,before+3);
  let summary=walletSummaries(db)[0];assert.equal(summary.wallet.code,wallet.code);
  assert.deepEqual(summary.allocations.map(a=>a.balanceMinor).sort(),['400000','600000']);assert.equal(summary.balanceMinor,'1000000');
  const category=db.getCategories(business.id).find(c=>c.kind==='expense')||db.createCategory(business.id,'Synthetic expense','expense');
  await db.waitForPendingWrites();
  await post(db,buildExpenseJournal({workspaceId:business.id,assetAccountId:biz.id,expenseCategoryId:category.id,amountMinor:'100000',effectiveDate:'2026-11-05',opId:generateUUID()}));
  summary=walletSummaries(db)[0];assert.equal(summary.balanceMinor,'900000');
  assert.equal(summary.allocations.find(a=>a.accountId===personal.accountId)?.balanceMinor,'400000');
  assert.equal(summary.allocations.find(a=>a.accountId===biz.id)?.expenseMinor,'100000');
  await transferAllocation(db,{id:generateUUID(),sourceAccountId:biz.id,destinationAccountId:personal.accountId,amountMinor:'200000'});
  summary=walletSummaries(db)[0];assert.equal(summary.balanceMinor,'900000');
  assert.equal(summary.allocations.find(a=>a.accountId===personal.accountId)?.balanceMinor,'600000');
  assert.equal(db.getDashboardData(business.id).totalIncomeThisMonthMinor,'0');
  for(const w of db.getAllWorkspaces())assert.equal(db.verifyLedgerIntegrity(w.id).isValid,true);
});

test('wallets: goal earmarks remain included in physical cash and cannot be spent or transferred from either allocation',async()=>{
  const {db,home,personal,biz,business}=await setup();
  const goal=await db.saveSavingsGoal(home.id,{name:'Synthetic goal',kind:'general',targetMinor:'1000000'});
  await db.allocateSavingsGoal(home.id,goal.id,personal.accountId,'700000');
  let summary=walletSummaries(db)[0];assert.equal(summary.balanceMinor,'1000000');assert.equal(summary.reservedMinor,'700000');assert.equal(summary.availableMinor,'300000');
  await assert.rejects(transferAllocation(db,{id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:biz.id,amountMinor:'300001'}),/WALLET_INSUFFICIENT_ALLOCATION/);
  const category=db.getCategories(home.id).find(c=>c.kind==='expense')!;
  const sequenceBefore=db.getRawState().deviceIdentity.counter;
  await assert.rejects(post(db,buildExpenseJournal({workspaceId:home.id,assetAccountId:personal.accountId,expenseCategoryId:category.id,amountMinor:'300001',effectiveDate:'2026-11-05',opId:generateUUID()})),/WALLET_INSUFFICIENT_ALLOCATION/);
  assert.equal(db.getRawState().deviceIdentity.counter,sequenceBefore,'Rejected UI save must not consume an outbox sequence.');
  // The business cannot consume the personal allocation even though bKash has money.
  const expense=db.createCategory(business.id,'Synthetic expense','expense');await db.waitForPendingWrites();
  await assert.rejects(post(db,buildExpenseJournal({workspaceId:business.id,assetAccountId:biz.id,expenseCategoryId:expense.id,amountMinor:'1',effectiveDate:'2026-11-05',opId:generateUUID()})),/WALLET_INSUFFICIENT_ALLOCATION/);
  summary=walletSummaries(db)[0];assert.equal(summary.balanceMinor,'1000000');assert.equal(summary.reservedMinor,'700000');
});

test('wallets: a transfer between different physical wallets changes each wallet, not total cash or P&L',async()=>{
  const {db,personal,business}=await setup();
  const bank=await createMasterWallet(db,{id:generateUUID(),name:'Synthetic bank',kind:'bank',openingBalanceMinor:'0'});
  const receiver=await linkMasterWallet(db,bank.code,business.id);
  await transferAllocation(db,{id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:receiver.id,amountMinor:'250001'});
  const summaries=walletSummaries(db);assert.equal(summaries.reduce((n,w)=>n+BigInt(w.balanceMinor),0n),1000000n);
  assert.equal(summaries.find(w=>w.wallet.id===bank.id)?.balanceMinor,'250001');
  assert.equal(summaries.flatMap(w=>w.allocations).reduce((n,a)=>n+BigInt(a.incomeMinor)+BigInt(a.expenseMinor),0n),0n);
});

test('wallets: idempotent retry, changed request rejection and protection against editing/deleting either posted side',async()=>{
  const {db,personal,biz,wallet}=await setup(),input={id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:biz.id,amountMinor:'200000'};
  await transferAllocation(db,input);const before=canonicalJson(db.toSerializable());await transferAllocation(db,input);
  assert.equal(canonicalJson(db.toSerializable()),before);
  await assert.rejects(transferAllocation(db,{...input,amountMinor:'1'}),/WALLET_TRANSFER_CONFLICT/);
  await assert.rejects(db.deleteTransaction(allocationJournalId(input.id,'source')),/WALLET_PROTECTED_TRANSFER/);
  assert.throws(()=>db.updateAccount(biz.id,{kind:'bank'}),/WALLET_LINKED_KIND_FIXED/);
  const same=await linkMasterWallet(db,wallet.code,db.getAccount(biz.id)!.workspaceId);assert.equal(same.id,biz.id);
  await assert.rejects(createMasterWallet(db,{id:wallet.id,name:wallet.name,kind:wallet.kind,openingBalanceMinor:'1'}),/WALLET_CODE_CONFLICT/);
  const saved=canonicalJson(db.toSerializable());assert.throws(()=>db.editWorkspace(wallet.homeWorkspaceId,{kind:'business'}),/WALLET_HOME_REQUIRED/);assert.equal(canonicalJson(db.toSerializable()),saved);
  assert.throws(()=>db.archiveWorkspace(wallet.homeWorkspaceId),/WALLET_HOME_REQUIRED/);
});

test('wallets: failed durable commit restores both sides, immutable operation IDs and the outbox',async()=>{
  const {db,driver,personal,biz}=await setup();const before=canonicalJson(db.toSerializable());
  driver.faultInjection='throw_on_commit';
  await assert.rejects(transferAllocation(db,{id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:biz.id,amountMinor:'200000'}));
  driver.faultInjection='none';assert.equal(canonicalJson(db.toSerializable()),before);assert.equal(readWalletBook(db.getRawState()).pendingReferences,0);
});

test('wallets: concurrent transfers cannot consume the same source allocation twice',async()=>{
  const {db,personal,biz}=await setup();
  const results=await Promise.allSettled([1,2].map(()=>transferAllocation(db,{id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:biz.id,amountMinor:'900000'})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(walletSummaries(db)[0].balanceMinor,'1000000');
  assert.equal(walletSummaries(db)[0].allocations.find(a=>a.accountId===personal.accountId)?.balanceMinor,'100000');
});

test('wallets: retained metadata rejects foreign owners and altered financial sides; incomplete transfers stay pending',async()=>{
  const {db,personal,biz,business,wallet}=await setup();
  const foreign=db.createWorkspace('Synthetic foreign','business');foreign.ownerSubjectHash='another-owner';await db.waitForPendingWrites();
  await assert.rejects(linkMasterWallet(db,wallet.code,foreign.id),/WALLET_OWNER_MISMATCH/);
  const input={id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:biz.id,amountMinor:'100000'};await transferAllocation(db,input);
  const journalId=allocationJournalId(input.id,'destination'),journal=db.getTransaction(journalId)!;
  db.getRawState().journalTransactions.delete(journalId);assert.ok(readWalletBook(db.getRawState()).pendingReferences>0);
  await assert.rejects(transferAllocation(db,{id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:biz.id,amountMinor:'1'}),/WALLET_SYNC_INCOMPLETE/);
  db.getRawState().journalTransactions.set(journalId,journal);
  journal.lines[0].debitMinor='1';assert.throws(()=>readWalletBook(db.getRawState()),/WALLET_TRANSFER_CONFLICT/);
  journal.lines[0].debitMinor='100000';assert.equal(readWalletBook(db.getRawState()).pendingReferences,0);
  assert.equal(db.getDashboardData(business.id).totalIncomeThisMonthMinor,'0');
});

test('wallets: explicit legacy linking retains every old amount/journal; durable reload and backup preserve codes and both sides',async()=>{
  const {db,driver,key,home,business,wallet,personal,biz}=await setup();
  const legacy=db.createAccount(home.id,'Synthetic old Nagad','nagad','5000');await db.waitForPendingWrites();const before=core(db);
  const adopted=await createMasterWallet(db,{id:generateUUID(),name:'Synthetic Nagad',kind:'nagad',openingBalanceMinor:'0',existingAccountId:legacy.id});
  assert.equal(core(db),before);assert.equal(walletSummaries(db).find(w=>w.wallet.id===adopted.id)?.balanceMinor,'5000');
  await transferAllocation(db,{id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:biz.id,amountMinor:'100001'});
  const restored=new LocalDatabase(key,driver);await restored.init();assert.deepEqual(walletSummaries(restored),walletSummaries(db));
  const file=await db.exportBackupFile(),data=await decodeBackup(file);assert.equal(data.schemaVersion,6);
  const other=new LocalDatabase(`synthetic-restore-${generateUUID()}`,new LocalStorageFallbackDriver());await other.init();other.setIdentity('synthetic-wallet-owner');
  await other.importBackupFile(file);assert.deepEqual(walletSummaries(other),walletSummaries(db));
  assert.equal(other.verifyLedgerIntegrity(business.id).isValid,true);
  const restoredOps=new Map(other.getPendingOutbox().map(op=>[op.operationId,op]));
  for(const original of db.getPendingOutbox())assert.equal(canonicalJson(restoredOps.get(original.operationId)),canonicalJson(original));
  assert.equal(walletSummaries(other)[0].wallet.code,wallet.code);
});

test('wallets: v5 migration keeps exact finance definitions and a recovery copy before enabling the v6 reader guard',async()=>{
  const {db,driver,key}=await setup();const data=db.toSerializable();data.syncOperations=[];data.syncOutbox=[];data.appliedOperations=[];data.schemaVersion=5;
  const raw=JSON.stringify(data);await driver.setItem(key,raw);
  const upgraded=new LocalDatabase(key,driver);await upgraded.init();assert.equal(upgraded.getSchemaVersion(),6);
  assert.equal(await driver.getItem(`${key}_pre_migration_v6`),raw);
  for(const field of ['accounts','journalTransactions','journalLines','localIdentity'])assert.equal(canonicalJson(upgraded.toSerializable()[field]),canonicalJson(data[field]));
  assert.ok(upgraded.getSnapshots().some(s=>s.dbSchemaVersion===5));
});

test('wallets: Personal can receive a goal loan; same-wallet cash stays constant and repayment restores the source goal',async()=>{
  const {db,home,personal,wallet}=await setup();
  const other=db.createWorkspace('Synthetic other personal','personal');await db.waitForPendingWrites();
  const receiver=await linkMasterWallet(db,wallet.code,other.id);
  const goal=await db.saveSavingsGoal(home.id,{name:'Synthetic loan goal',kind:'general',targetMinor:'1000000'});
  await db.allocateSavingsGoal(home.id,goal.id,personal.accountId,'600000');
  const loan={id:generateUUID(),goalId:goal.id,sourceWorkspaceId:home.id,sourceAccountId:personal.accountId,borrowerWorkspaceId:other.id,
    borrowerAccountId:receiver.id,principalMinor:'200000',dueDate:'2026-12-01',monthlyRateBps:0,repaymentOrder:'principal-first' as const,purpose:'Synthetic Personal loan'};
  await db.issueSavingsLoan(loan,new Date('2026-11-05T06:00:00Z'));
  assert.equal(walletSummaries(db)[0].balanceMinor,'1000000');assert.equal(walletSummaries(db)[0].reservedMinor,'400000');
  const borrowersGoal=await db.saveSavingsGoal(other.id,{name:'Synthetic protected borrower goal',kind:'general',targetMinor:'100000'});
  await db.allocateSavingsGoal(other.id,borrowersGoal.id,receiver.id,'100000');
  await db.repaySavingsLoan(loan.id,generateUUID(),undefined,new Date('2026-11-06T06:00:00Z'));
  assert.equal(db.getSavingsLoans(undefined,'2026-11-06')[0].balance.principalOutstandingMinor,'100000');
  assert.equal(db.getSavingsProjection(other.id).goals.find(g=>g.goal.id===borrowersGoal.id)?.fundedMinor,'100000');
  assert.equal(db.getSavingsProjection(home.id).goals.find(g=>g.goal.id===goal.id)?.fundedMinor,'500000');
  assert.equal(walletSummaries(db)[0].balanceMinor,'1000000');
});

test('wallets: scoped employee access cannot read global cash or create/link/transfer allocations',async()=>{
  const {db,wallet,business,personal,biz}=await setup(),actorHash='synthetic-employee';const before=canonicalJson(db.toSerializable());
  assert.throws(()=>walletSummaries(db,undefined,actorHash),/WALLET_OWNER_MISMATCH/);
  await assert.rejects(createMasterWallet(db,{id:generateUUID(),name:'Synthetic forbidden',kind:'cash',openingBalanceMinor:'0',actorHash}),/WALLET_OWNER_MISMATCH/);
  await assert.rejects(linkMasterWallet(db,wallet.code,business.id,undefined,actorHash),/WALLET_OWNER_MISMATCH/);
  await assert.rejects(transferAllocation(db,{id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:biz.id,amountMinor:'1',actorHash}),/WALLET_OWNER_MISMATCH/);
  assert.equal(canonicalJson(db.toSerializable()),before);
});

test('wallets: editing an expense cannot consume goal funds; repeated correction/deletion cannot manufacture cash',async()=>{
  const {db,home,personal}=await setup(),category=db.getCategories(home.id).find(c=>c.kind==='expense')!;
  const journal=buildExpenseJournal({workspaceId:home.id,assetAccountId:personal.accountId,expenseCategoryId:category.id,amountMinor:'100000',effectiveDate:'2026-11-05',opId:generateUUID()});
  await post(db,journal);const goal=await db.saveSavingsGoal(home.id,{name:'Synthetic protected goal',kind:'general',targetMinor:'700000'});
  await db.allocateSavingsGoal(home.id,goal.id,personal.accountId,'700000');
  const command={amountMinor:'400000',effectiveDate:'2026-11-05',assetAccountId:personal.accountId,categoryId:category.id};
  const before=canonicalJson(db.toSerializable());await assert.rejects(db.editTransaction(journal.transaction.id,command),/WALLET_INSUFFICIENT_ALLOCATION/);
  assert.equal(canonicalJson(db.toSerializable()),before);
  await db.editTransaction(journal.transaction.id,{...command,amountMinor:'200000'});
  const after=canonicalJson(db.toSerializable());await assert.rejects(db.editTransaction(journal.transaction.id,command),/WALLET_TRANSACTION_ALREADY_CHANGED/);
  await assert.rejects(db.deleteTransaction(journal.transaction.id),/WALLET_TRANSACTION_ALREADY_CHANGED/);assert.equal(canonicalJson(db.toSerializable()),after);
  const replacement=db.getTransaction(journal.transaction.id)!.isReplacedBy!;await db.deleteTransaction(replacement);
  const deleted=canonicalJson(db.toSerializable());await db.deleteTransaction(replacement);assert.equal(canonicalJson(db.toSerializable()),deleted);
  assert.equal(walletSummaries(db)[0].balanceMinor,'1000000');
});

test('wallets: physical shortfalls in explicitly linked legacy allocations cap outgoing cash, while same-wallet ownership can be corrected',async()=>{
  const {db,home,business,personal,wallet,biz}=await setup();
  // A synthetic old deficit is retained, not reset or silently shifted to Personal.
  db.getRawState().accounts.get(biz.id)!.openingBalanceMinor='-900000';
  const creation=[...db.getRawState().syncOperations.values()].find(op=>op.type==='account.create'&&op.entityId===biz.id)!;
  creation.payload.account.openingBalanceMinor='-900000';creation.contentSha256=computeSha256Sync(canonicalJson(creation.payload));
  await db.persist();assert.equal(walletSummaries(db)[0].balanceMinor,'100000');assert.equal(walletSummaries(db)[0].availableMinor,'100000');
  const category=db.getCategories(home.id).find(c=>c.kind==='expense')!;
  await assert.rejects(post(db,buildExpenseJournal({workspaceId:home.id,assetAccountId:personal.accountId,expenseCategoryId:category.id,amountMinor:'100001',effectiveDate:'2026-11-05',opId:generateUUID()})),/WALLET_PHYSICAL_SHORTFALL/);
  await transferAllocation(db,{id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:biz.id,amountMinor:'500000'});
  assert.equal(walletSummaries(db)[0].balanceMinor,'100000');assert.equal(db.getAccount(biz.id)!.workspaceId,business.id);assert.equal(walletSummaries(db)[0].wallet.code,wallet.code);
});

test('wallets: fee expense and period filters do not alter the current physical balance',async()=>{
  const {db,home,personal}=await setup();const bank=await createMasterWallet(db,{id:generateUUID(),name:'Synthetic fee bank',kind:'bank',openingBalanceMinor:'0'});
  const destination=walletSummaries(db).find(w=>w.wallet.id===bank.id)!.allocations[0];const category=db.getCategories(home.id).find(c=>c.kind==='expense')!;
  await post(db,buildTransferJournal({workspaceId:home.id,fromAssetAccountId:personal.accountId,toAssetAccountId:destination.accountId,amountMinor:'500000',feeMinor:'101',feeExpenseCategoryId:category.id,effectiveDate:'2026-11-05',opId:generateUUID()}));
  const all=walletSummaries(db),older=walletSummaries(db,{fromDate:'2026-01-01',toDate:'2026-01-01'});
  assert.equal(all.reduce((n,w)=>n+BigInt(w.balanceMinor),0n),999899n);
  assert.equal(all.flatMap(w=>w.allocations).reduce((n,a)=>n+BigInt(a.expenseMinor),0n),101n);
  assert.equal(older.flatMap(w=>w.allocations).reduce((n,a)=>n+BigInt(a.expenseMinor),0n),0n);
  assert.deepEqual(older.map(w=>w.balanceMinor),all.map(w=>w.balanceMinor));
});

test('wallets: values above JavaScript safe integer preserve every paisa across a transfer and reload',async()=>{
  const {db,home,business,driver,key}=await setup();const amount='9007199254740993';
  const wallet=await createMasterWallet(db,{id:generateUUID(),name:'Synthetic exact large cash',kind:'cash',openingBalanceMinor:amount});
  const source=walletSummaries(db).find(w=>w.wallet.id===wallet.id)!.allocations[0],destination=await linkMasterWallet(db,wallet.code,business.id);
  await transferAllocation(db,{id:generateUUID(),sourceAccountId:source.accountId,destinationAccountId:destination.id,amountMinor:'9007199254740991'});
  const reloaded=new LocalDatabase(key,driver);await reloaded.init();const view=walletSummaries(reloaded).find(w=>w.wallet.id===wallet.id)!;
  assert.equal(view.balanceMinor,amount);assert.equal(view.allocations.find(a=>a.workspaceId===home.id)?.balanceMinor,'2');
});

test('wallet lifecycle: rename keeps codes, opening balances and journals; replay is idempotent and stale/foreign commands fail',async()=>{
  const {db,wallet,personal,biz}=await setup(),before=core(db),count=db.getPendingOutbox().length;
  const command={walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'rename' as const,name:'নতুন বিকাশ'};
  await changeMasterWallet(db,command);
  const retained=JSON.parse(before),after=JSON.parse(core(db));
  for(const pair of after.accounts){const original=retained.accounts.find((a:any)=>a[0]===pair[0]);if(pair[0]===personal.accountId||pair[0]===biz.id)original[1].name='নতুন বিকাশ';}
  assert.equal(canonicalJson(after),canonicalJson(retained));assert.equal(db.getPendingOutbox().length,count+3);
  assert.equal(db.getAccount(personal.accountId)?.name,'নতুন বিকাশ');assert.equal(db.getAccount(biz.id)?.name,'নতুন বিকাশ');
  assert.equal(walletSummaries(db)[0].wallet.code,wallet.code);assert.equal(walletSummaries(db)[0].balanceMinor,'1000000');
  const saved=canonicalJson(db.toSerializable());await changeMasterWallet(db,command);assert.equal(canonicalJson(db.toSerializable()),saved);
  await assert.rejects(changeMasterWallet(db,{...command,commandId:generateUUID(),name:'stale'}),/WALLET_REVISION_CONFLICT/);
  await assert.rejects(changeMasterWallet(db,{...command,commandId:generateUUID(),expectedRevision:1,actorHash:'foreign'}),/WALLET_OWNER_MISMATCH/);
  await assert.rejects(changeMasterWallet(db,{...command,commandId:generateUUID(),expectedRevision:1,name:'  '}),/WALLET_INVALID_EVENT/);
  assert.equal(canonicalJson(db.toSerializable()),saved);
  db.updateAccount(biz.id,{name:'Synthetic workspace alias'});await db.waitForPendingWrites();
  assert.equal(db.getAccount(biz.id)?.name,'Synthetic workspace alias','existing workspace account editing remains available');
  assert.equal(walletSummaries(db)[0].wallet.name,'নতুন বিকাশ');
});

test('wallet lifecycle: guarded archive blocks spending, new goal funding and linking; restore retains separately archived allocations',async()=>{
  const {db,wallet,personal,biz,home,business}=await setup();db.archiveAccount(biz.id);await db.waitForPendingWrites();
  const originalArchive=db.getRawState().accounts.get(biz.id)!.archivedAt,before=core(db);
  for(const confirmation of ['', 'delete', ' DELETE'])await assert.rejects(changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'archive',confirmation}),/WALLET_DELETE_CONFIRMATION/);
  await changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'archive',confirmation:'DELETE'});
  assert.equal(core(db),before);assert.equal(db.getAccounts(home.id).some(a=>a.id===personal.accountId),false);
  assert.equal(db.getAccounts(business.id).some(a=>a.id===biz.id),false);assert.equal(walletSummaries(db)[0].balanceMinor,'1000000');assert.equal(walletSummaries(db)[0].availableMinor,'0');
  assert.throws(()=>db.restoreAccount(personal.accountId),/WALLET_ACCOUNT_UNAVAILABLE/);
  await assert.rejects(linkMasterWallet(db,wallet.code,business.id),/WALLET_ACCOUNT_UNAVAILABLE/);
  const category=db.getCategories(home.id).find(c=>c.kind==='expense')!;
  await assert.rejects(post(db,buildExpenseJournal({workspaceId:home.id,assetAccountId:personal.accountId,expenseCategoryId:category.id,amountMinor:'1',effectiveDate:'2026-11-06',opId:generateUUID()})),/WALLET_ACCOUNT_UNAVAILABLE/);
  const goal=await db.saveSavingsGoal(home.id,{name:'Synthetic protected goal',kind:'general',targetMinor:'100'});
  await assert.rejects(db.allocateSavingsGoal(home.id,goal.id,personal.accountId,'1'),/SAVINGS_ACCOUNT_UNAVAILABLE/);
  await changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:1,action:'restore'});
  assert.equal(db.getAccounts(home.id).some(a=>a.id===personal.accountId),true);assert.equal(db.getAccount(biz.id)?.archivedAt,originalArchive);
  assert.equal(walletSummaries(db)[0].balanceMinor,'1000000');
});

test('wallet lifecycle: permanent removal requires archive and DELETE; settled journal history, backups and tombstones survive reload',async()=>{
  const {db,home,personal,driver,key}=await setup();
  const empty=await createMasterWallet(db,{id:generateUUID(),name:'Synthetic removable bank',kind:'bank',openingBalanceMinor:'0'});
  const receiver=walletSummaries(db).find(r=>r.wallet.id===empty.id)!.allocations[0];
  await transferAllocation(db,{id:generateUUID(),sourceAccountId:personal.accountId,destinationAccountId:receiver.accountId,amountMinor:'1000'});
  await transferAllocation(db,{id:generateUUID(),sourceAccountId:receiver.accountId,destinationAccountId:personal.accountId,amountMinor:'1000'});
  const finance=core(db),journals=db.getTransactions(home.id).length;
  await assert.rejects(changeMasterWallet(db,{walletId:empty.id,commandId:generateUUID(),expectedRevision:0,action:'delete',confirmation:'DELETE'}),/WALLET_ARCHIVE_REQUIRED/);
  await changeMasterWallet(db,{walletId:empty.id,commandId:generateUUID(),expectedRevision:0,action:'archive',confirmation:'DELETE'});
  await assert.rejects(changeMasterWallet(db,{walletId:empty.id,commandId:generateUUID(),expectedRevision:1,action:'delete',confirmation:'delete'}),/WALLET_DELETE_CONFIRMATION/);
  await changeMasterWallet(db,{walletId:empty.id,commandId:generateUUID(),expectedRevision:1,action:'delete',confirmation:'DELETE'});
  assert.equal(core(db),finance);assert.equal(db.getTransactions(home.id).length,journals);assert.equal(db.verifyLedgerIntegrity(home.id).isValid,true);
  assert.equal(readWalletBook(db.getRawState()).states.get(empty.id)?.status,'deleted');
  await assert.rejects(changeMasterWallet(db,{walletId:empty.id,commandId:generateUUID(),expectedRevision:2,action:'restore'}),/WALLET_DELETED/);
  assert.throws(()=>db.restoreAccount(receiver.accountId),/WALLET_ACCOUNT_UNAVAILABLE/);
  const restored=new LocalDatabase(key,driver);await restored.init();assert.deepEqual(walletSummaries(restored),walletSummaries(db));
  const copy=new LocalDatabase(`lifecycle-restore-${generateUUID()}`,new LocalStorageFallbackDriver());await copy.init();copy.setIdentity('synthetic-wallet-owner');
  await copy.importBackupFile(await db.exportBackupFile());assert.deepEqual(walletSummaries(copy),walletSummaries(db));
  assert.equal(copy.verifyLedgerIntegrity(home.id).isValid,true);
});

test('wallet lifecycle: individual nonzero allocations and unfunded goal reservations cannot be hidden by deletion',async()=>{
  const {db,wallet,home,personal,biz}=await setup();
  await changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'archive',confirmation:'DELETE'});
  await assert.rejects(changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:1,action:'delete',confirmation:'DELETE'}),/WALLET_BALANCE_REMAINS/);
  // A retained legacy deficit must not net against another workspace's money.
  db.getRawState().accounts.get(biz.id)!.openingBalanceMinor='-1000000';
  assert.equal(walletSummaries(db)[0].balanceMinor,'0');assert.equal(walletDeletionBlocker(db,wallet.id),'WALLET_BALANCE_REMAINS');
  db.getRawState().accounts.get(biz.id)!.openingBalanceMinor='0';
  await changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:1,action:'restore'});
  const goal=await db.saveSavingsGoal(home.id,{name:'Synthetic unfunded goal',kind:'general',targetMinor:'1000'});await db.allocateSavingsGoal(home.id,goal.id,personal.accountId,'1000');
  db.getRawState().accounts.get(personal.accountId)!.openingBalanceMinor='0';
  assert.equal(walletDeletionBlocker(db,wallet.id),'WALLET_SAVINGS_REMAIN');
});

test('wallet lifecycle: a zero-cash lender with outstanding principal cannot be permanently removed',async()=>{
  const {db,home,business,biz}=await setup();
  const lender=await createMasterWallet(db,{id:generateUUID(),name:'Synthetic lender',kind:'bank',openingBalanceMinor:'10000'});
  const source=walletSummaries(db).find(w=>w.wallet.id===lender.id)!.allocations[0];
  const goal=await db.saveSavingsGoal(home.id,{name:'Synthetic loan savings',kind:'general',targetMinor:'10000'});await db.allocateSavingsGoal(home.id,goal.id,source.accountId,'10000');
  await db.issueSavingsLoan({id:generateUUID(),goalId:goal.id,sourceWorkspaceId:home.id,sourceAccountId:source.accountId,borrowerWorkspaceId:business.id,borrowerAccountId:biz.id,principalMinor:'10000',dueDate:'2030-01-01',monthlyRateBps:0,repaymentOrder:'principal-first',purpose:'Synthetic outstanding loan'});
  assert.equal(walletSummaries(db).find(w=>w.wallet.id===lender.id)!.balanceMinor,'0');
  await changeMasterWallet(db,{walletId:lender.id,commandId:generateUUID(),expectedRevision:0,action:'archive',confirmation:'DELETE'});
  assert.equal(walletDeletionBlocker(db,lender.id),'WALLET_LOAN_REMAINS');
  await assert.rejects(changeMasterWallet(db,{walletId:lender.id,commandId:generateUUID(),expectedRevision:1,action:'delete',confirmation:'DELETE'}),/WALLET_LOAN_REMAINS/);
});

test('wallet lifecycle: durable failure rolls back metadata and outbox; concurrent stale edits cannot overwrite each other',async()=>{
  const {db,driver,wallet}=await setup(),before=canonicalJson(db.toSerializable());
  driver.faultInjection='throw_on_commit';await assert.rejects(changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'rename',name:'Failed'}));
  driver.faultInjection='none';assert.equal(canonicalJson(db.toSerializable()),before);
  const results=await Promise.allSettled(['First','Second'].map(name=>changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'rename',name})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(readWalletBook(db.getRawState()).states.get(wallet.id)?.revision,1);
});

test('wallet lifecycle: unordered revisions hydrate, missing revisions stay pending, forks and foreign commands are rejected',async()=>{
  const {db,wallet}=await setup();
  await changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'rename',name:'Renamed'});
  await changeMasterWallet(db,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:1,action:'archive',confirmation:'DELETE'});
  const raw=structuredClone(db.getRawState());raw.syncOperations=new Map([...raw.syncOperations].reverse());
  assert.equal(readWalletBook(raw).states.get(wallet.id)?.status,'archived');
  const rename=[...raw.syncOperations.values()].find(op=>op.payload.walletEvent?.change?.action==='rename')!;
  raw.syncOperations.delete(rename.operationId);assert.ok(readWalletBook(raw).pendingReferences>0);raw.syncOperations.set(rename.operationId,rename);
  const fork=structuredClone(rename);fork.operationId=generateUUID();fork.payload.walletEvent.change.commandId=generateUUID();fork.payload.walletEvent.change.name='Conflicting';fork.contentSha256=computeSha256Sync(canonicalJson(fork.payload));
  raw.syncOperations.set(fork.operationId,fork);assert.throws(()=>readWalletBook(raw),/WALLET_REVISION_CONFLICT/);raw.syncOperations.delete(fork.operationId);
  rename.ownerHash='foreign';assert.throws(()=>readWalletBook(raw),/WALLET_OWNER_MISMATCH/);
});
