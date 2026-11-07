import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalDatabase} from '../storage/db';
import {SyncTestSqliteDriver} from './helpers/syncSqliteDriver';
import {LiveSyncService,type LiveTransport,type LiveHead} from '../sync/live/service';
import {liveCore,coreHash,baseHashes,mergeLive} from '../sync/live/state';
import {RECOVERY_KEY} from '../sync/recovery/service';
import {generateUUID,buildExpenseJournal} from '../domain/journal';
import {createMasterWallet,changeMasterWallet,walletSummaries,linkMasterWallet,readWalletBook} from '../storage/walletBook';
import {canonicalJson,computeSha256Sync} from '../sync/canonical';

const owner='synthetic-live-owner';

test('live: permanent account deletion defeats an offline rename and an older file import',async t=>{
 const {a,b,sa,sb,remote}=await setup(t);const account=a.createAccount('ws-personal-default','Synthetic unused account','bank','0');await a.waitForPendingWrites();await sa.run();await sb.run();
 const old=await a.exportBackupFile();b.updateAccount(account.id,{name:'Offline stale name'});await b.waitForPendingWrites();
 assert.equal(a.safeDeleteAccount(account.id,'DELETE').mode,'deleted');await a.waitForPendingWrites();await sa.run();await sb.run();await sa.run();
 assert.equal(sb.snapshot().phase,'synced');assert.equal(a.getAccount(account.id),undefined);assert.equal(b.getAccount(account.id),undefined);
 await b.importBackupFile(old);assert.equal(b.getAccount(account.id),undefined);await sb.run();assert.equal(remote.core!.accounts.some(([id])=>id===account.id),false);
});

test('live: archived wallet/goal can restore; permanent deletion remains hidden after stale offline sync and old backup import',async t=>{
 const {a,b,sa,sb,wallet}=await setup(t),ws='ws-personal-default';const empty=await createMasterWallet(a,{id:generateUUID(),name:'Synthetic deleted wallet',kind:'bank',openingBalanceMinor:'0'});
 const goal=await a.saveSavingsGoal(ws,{name:'Synthetic deleted goal',kind:'general',targetMinor:'10000'});await sa.run();await sb.run();const old=await b.exportBackupFile();
 await changeMasterWallet(a,{walletId:empty.id,commandId:generateUUID(),expectedRevision:0,action:'archive',confirmation:'DELETE'});await a.setSavingsGoalArchived(ws,goal.id,true);await sa.run();await sb.run();
 assert.equal(readWalletBook(b.getRawState()).states.get(empty.id)?.status,'archived');assert.equal(b.getSavingsProjection(ws).goals.find(g=>g.goal.id===goal.id)?.goal.archived,true);
 await changeMasterWallet(b,{walletId:empty.id,commandId:generateUUID(),expectedRevision:1,action:'restore'});await b.setSavingsGoalArchived(ws,goal.id,false);await sb.run();await sa.run();
 assert.equal(readWalletBook(a.getRawState()).states.get(empty.id)?.status,'active');
 await changeMasterWallet(a,{walletId:empty.id,commandId:generateUUID(),expectedRevision:2,action:'archive',confirmation:'DELETE'});await a.setSavingsGoalArchived(ws,goal.id,true);
 await changeMasterWallet(a,{walletId:empty.id,commandId:generateUUID(),expectedRevision:3,action:'delete',confirmation:'DELETE'});await a.safeDeleteSavingsGoal(ws,goal.id,'DELETE');await sa.run();
 await expense(b,walletSummaries(b).find(r=>r.wallet.id===wallet.id)!.allocations[0].accountId,'100');await sb.run();await sa.run();
 await b.importBackupFile(old);await sb.run();
 assert.equal(readWalletBook(b.getRawState()).states.get(empty.id)?.status,'deleted');assert.equal(b.getSavingsProjection(ws).goals.find(g=>g.goal.id===goal.id)?.deleted,true);
 await assert.rejects(changeMasterWallet(b,{walletId:empty.id,commandId:generateUUID(),expectedRevision:4,action:'restore'}),/WALLET_DELETED/);
});

test('live: transaction correction and offline void sync without reactivating the original or duplicating balances',async t=>{
 const {a,b,sa,sb,wallet}=await setup(t);await sa.run();await sb.run();const account=walletSummaries(a)[0].allocations[0].accountId;await expense(a,account,'12000');await sa.run();await sb.run();
 const original=a.getTransactions('ws-personal-default').find(tx=>tx.transactionType==='expense')!;
 await a.editTransaction(original.id,{amountMinor:'15000',effectiveDate:'2026-11-07',assetAccountId:account,categoryId:a.getCategories('ws-personal-default').find(c=>c.kind==='expense')!.id});await sa.run();await sb.run();
 const replacement=b.getTransaction(original.id)!.isReplacedBy!;assert.ok(replacement);await b.deleteTransaction(replacement);await sb.run();
 await expense(a,account,'500');await sa.run();await sb.run();assert.equal(sa.snapshot().phase,'synced');assert.equal(a.getTransaction(replacement)?.isDeleted,true);assert.equal(a.getTransaction(original.id)?.isReplacedBy,replacement);
 assert.equal(walletSummaries(a).find(r=>r.wallet.id===wallet.id)?.balanceMinor,'99500');assert.equal(coreHash(liveCore(a.toSerializable())),coreHash(liveCore(b.toSerializable())));
});
function cloud(){let core:ReturnType<typeof liveCore>|null=null,head:LiveHead|null=null;let lost=false;let writes=0;
 const transport:LiveTransport={head:async()=>head&&{...head},get:async()=>{if(!head||!core)throw Error('MISSING');return structuredClone({head,core});},
  put:async(datasetId,expected,input)=>{if(head&&head.datasetId!==datasetId)throw Error('LIVE_OTHER_DATASET');
    if(head&&head.revision!==expected)return{kind:'stale',head:{...head}};
    if(!head||head.sha256!==coreHash(input)){writes++;core=structuredClone(input);head={datasetId,revision:String(BigInt(head?.revision||'0')+1n),sha256:coreHash(input),updatedAt:new Date().toISOString()};}
    if(lost){lost=false;throw Error('LOST_ACK');}return{kind:'accepted',head:{...head!}};}};
 return{transport,get writes(){return writes;},set lost(v:boolean){lost=v;},get core(){return structuredClone(core);}};
}
async function setup(t:any){const dir=await mkdtemp(join(tmpdir(),'hisab-live-')),pa=join(dir,'a.sqlite'),pb=join(dir,'b.sqlite');const da=new SyncTestSqliteDriver(pa),dB=new SyncTestSqliteDriver(pb);
 const a=new LocalDatabase('live-a',da),b=new LocalDatabase('live-b',dB);await a.init();await b.init();
 a.setIdentity(owner);for(const w of a.getRawState().workspaces.values())w.ownerSubjectHash=owner;
 const wallet=await createMasterWallet(a,{id:generateUUID(),name:'Synthetic live cash',kind:'cash',openingBalanceMinor:'100000'});
 const auth={customerId:generateUUID(),generation:0},datasetId=generateUUID();a.getRawState().preferences.set(RECOVERY_KEY,{customerId:auth.customerId,datasetId,deviceId:generateUUID()});await a.persist();
 const remote=cloud(),sa=new LiveSyncService(a,()=>auth,()=>remote.transport),sb=new LiveSyncService(b,()=>auth,()=>remote.transport);
 t.after(async()=>{da.close();dB.close();await rm(dir,{recursive:true,force:true});});
 return{a,b,da,dB,pa,pb,sa,sb,remote,auth,wallet,datasetId};}
async function expense(db:LocalDatabase,accountId:string,amountMinor:string){const opId=generateUUID();const journal=buildExpenseJournal({workspaceId:'ws-personal-default',assetAccountId:accountId,amountMinor,expenseCategoryId:db.getCategories('ws-personal-default').find(c=>c.kind==='expense')!.id,opId,effectiveDate:'2026-11-07',note:'Synthetic live test'});
 await db.commitJournalWithOutbox(journal,{protocolVersion:1,ownerHash:owner,deviceId:db.getDeviceId(),seq:0,operationId:opId,entityId:journal.transaction.id,type:'journal.post',createdAtUtc:new Date().toISOString(),payload:{balancedJournal:journal},contentSha256:computeSha256Sync(canonicalJson({balancedJournal:journal}))});
}

test('live: two durable SQLite clients discover the same account dataset and converge bidirectionally without reusing device identity',async t=>{
 const {a,b,sa,sb,remote,wallet}=await setup(t),deviceB=b.getDeviceId();await sa.run();assert.equal(sa.snapshot().phase,'synced');await sb.run();assert.equal(sb.snapshot().phase,'synced');assert.equal(b.getDeviceId(),deviceB);assert.notEqual(a.getDeviceId(),b.getDeviceId());
 const account=walletSummaries(a)[0].allocations[0].accountId;await expense(a,account,'12080');await sa.run();await sb.run();assert.equal(coreHash(liveCore(a.toSerializable())),coreHash(liveCore(b.toSerializable())));
 await expense(b,account,'1000');await sb.run();await sa.run();assert.equal(coreHash(liveCore(a.toSerializable())),coreHash(liveCore(b.toSerializable())));
 assert.equal(walletSummaries(a).find(w=>w.wallet.id===wallet.id)?.balanceMinor,'86920');const writes=remote.writes;await sa.run();await sb.run();assert.equal(remote.writes,writes);
});
test('live: concurrent offline financial additions union once, lost acknowledgements retry without duplicate amounts, and metadata follows sequential revisions',async t=>{
 const {a,b,sa,sb,remote,wallet}=await setup(t);await sa.run();await sb.run();const account=walletSummaries(a)[0].allocations[0].accountId;
 await expense(a,account,'100');await expense(b,account,'200');remote.lost=true;await sa.run();assert.notEqual(sa.snapshot().phase,'synced');await sa.run();await sb.run();await sa.run();
 assert.equal(coreHash(liveCore(a.toSerializable())),coreHash(liveCore(b.toSerializable())));assert.equal(walletSummaries(a)[0].balanceMinor,'99700');
 await changeMasterWallet(a,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'rename',name:'Renamed remotely'});await sa.run();await sb.run();assert.equal(walletSummaries(b)[0].wallet.name,'Renamed remotely');
 await changeMasterWallet(b,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:1,action:'archive',confirmation:'DELETE'});await sb.run();await sa.run();assert.equal(walletSummaries(a)[0].lifecycle.status,'archived');
});
test('live: concurrent wallet edits are visible conflicts, never silent overwrite; nonempty other datasets remain untouched',async t=>{
 const {a,b,sa,sb,wallet}=await setup(t);await sa.run();await sb.run();
 await changeMasterWallet(a,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'rename',name:'Device A'});
 await changeMasterWallet(b,{walletId:wallet.id,commandId:generateUUID(),expectedRevision:0,action:'rename',name:'Device B'});
 await sa.run();const before=canonicalJson(b.toSerializable());await sb.run();assert.equal(sb.snapshot().phase,'conflict');assert.equal(canonicalJson(b.toSerializable()),before);assert.equal(walletSummaries(b)[0].wallet.name,'Device B');assert.ok(b.getPendingOutbox().length);
 b.getRawState().preferences.set(RECOVERY_KEY,{customerId:generateUUID(),datasetId:generateUUID(),deviceId:generateUUID()});await b.persist();await sb.run();assert.equal(sb.snapshot().error,'LIVE_OTHER_ACCOUNT');
});
test('live: a save while a network request is pending is preserved and subsequently uploaded',async t=>{
 const {a,sa,remote}=await setup(t);await sa.run();const account=walletSummaries(a)[0].allocations[0].accountId;await expense(a,account,'100');
 let release!:()=>void,reached!:()=>void;const held=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>reached=r),original=remote.transport.put;
 remote.transport.put=async(...args)=>{reached();await held;return original(...args);};const run=sa.run();await entered;await expense(a,account,'200');release();await run;assert.equal(sa.snapshot().phase,'synced');assert.equal(walletSummaries(a)[0].balanceMinor,'99700');assert.equal(coreHash(liveCore(a.toSerializable())),coreHash(remote.core!));
});
test('live: immutable journal tampering, stale logout replies and a failed SQLite commit never replace local finances',async t=>{
 const {a,b,sa,sb,auth,remote,dB}=await setup(t);await sa.run();await sb.run();const account=walletSummaries(a)[0].allocations[0].accountId;
 await expense(a,account,'100');await sa.run();const bBefore=coreHash(liveCore(b.toSerializable()));dB.failCommit=true;await sb.run();assert.equal(sb.snapshot().phase,'error');assert.equal(coreHash(liveCore(b.toSerializable())),bBefore);
 const reopened=new LocalDatabase('live-b',dB);await reopened.init();assert.equal(coreHash(liveCore(reopened.toSerializable())),bBefore);await sb.run();assert.equal(sb.snapshot().phase,'synced');
 const local=liveCore(a.toSerializable()),altered=structuredClone(local);altered.journalLines[0][1].debitMinor='1';assert.throws(()=>mergeLive(baseHashes(local),local,altered));
 const before=canonicalJson(b.toSerializable());let release!:()=>void,reached!:()=>void;const entered=new Promise<void>(r=>reached=r),held=new Promise<void>(r=>release=r);
 const late={...remote.transport,head:async()=>{reached();await held;return remote.transport.head(new AbortController().signal);}};let current:any=auth;const fenced=new LiveSyncService(b,()=>current,()=>late);
 const run=fenced.run();await entered;current=null;fenced.cancel();release();await run;assert.equal(canonicalJson(b.toSerializable()),before);
});
test('live: a normal financial Save waits for the background SQLite merge rather than nesting transactions',async t=>{
 const {a,b,sa,sb,dB}=await setup(t);await sa.run();await sb.run();const account=walletSummaries(a)[0].allocations[0].accountId;
 await expense(a,account,'100');await sa.run();let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>release=r),reached=new Promise<void>(r=>entered=r);
 const commit=dB.commitTransaction.bind(dB);let first=true;dB.commitTransaction=async()=>{if(first){first=false;entered();await waiting;}await commit();};
 const merging=sb.run();await reached;let saved=false;const posting=expense(b,account,'200').then(()=>{saved=true;});
 await new Promise(r=>setTimeout(r,10));assert.equal(saved,false);release();await Promise.all([merging,posting]);await sb.run();await sa.run();
 assert.equal(walletSummaries(b)[0].balanceMinor,'99700');assert.equal(coreHash(liveCore(a.toSerializable())),coreHash(liveCore(b.toSerializable())));
});
test('live: shared-wallet savings, cross-workspace loan issuance and repayment reach the second SQLite client intact',async t=>{
 const {a,b,sa,sb,wallet}=await setup(t),personal='ws-personal-default',source=walletSummaries(a)[0].allocations[0].accountId;
 const business=a.createWorkspace('Synthetic borrower','business');await a.waitForPendingWrites();const borrower=await linkMasterWallet(a,wallet.code,business.id);
 const goal=await a.saveSavingsGoal(personal,{name:'Synthetic emergency fund',kind:'general',targetMinor:'100000'});await a.allocateSavingsGoal(personal,goal.id,source,'60000');
 await sa.run();await sb.run();assert.equal(b.getSavingsProjection(personal).goals.find(g=>g.goal.id===goal.id)?.fundedMinor,'60000');
 const issued=new Date('2026-11-07T06:00:00Z'),loanId=generateUUID();await b.issueSavingsLoan({id:loanId,goalId:goal.id,sourceWorkspaceId:personal,sourceAccountId:source,borrowerWorkspaceId:business.id,borrowerAccountId:borrower.id,principalMinor:'50000',dueDate:'2026-12-07',monthlyRateBps:200,repaymentOrder:'principal-first',purpose:'Synthetic loan'},issued);
 await sb.run();await sa.run();assert.equal(a.getSavingsLoans(personal,'2026-11-07')[0].balance.principalOutstandingMinor,'50000');assert.equal(a.getSavingsProjection(personal).goals.find(g=>g.goal.id===goal.id)?.fundedMinor,'10000');
 await a.repaySavingsLoan(loanId,generateUUID(),'10000',issued);await sa.run();await sb.run();assert.equal(b.getSavingsLoans(personal,'2026-11-07')[0].balance.principalOutstandingMinor,'40000');assert.equal(coreHash(liveCore(a.toSerializable())),coreHash(liveCore(b.toSerializable())));
});
