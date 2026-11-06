import type { Account, BalancedJournal, JournalTransaction, SyncOperation, Workspace } from '../contracts/types';
import type { AllocationTransfer, MasterWallet, MasterWalletSummary, WalletAllocation, WalletEvent, WalletChange, WalletLifecycle } from '../contracts/wallets';
import type { DatabaseState, LocalDatabase } from './db';
import { SYSTEM_ACCOUNTS } from '../contracts/ledger';
import { generateUUID } from '../domain/journal';
import { localDate, resolveJournalTime, validateTransactionTime } from '../domain/transactionTime';
import { canonicalJson, computeSha256Sync } from '../sync/canonical';
import { isLoanLedgerAccount, readSavingsLoans } from './loanBook';
import { projectSavingsGoals } from '../domain/savingsGoals';
import { savingsRecords } from './savingsOperations';
import { isDeleteConfirmed } from '../domain/confirmation';

type State = Pick<DatabaseState,'workspaces'|'accounts'|'syncOperations'|'journalTransactions'>;
const kinds=['cash','bank','bkash','nagad','rocket','other'];
const digest=(text:string)=>computeSha256Sync(text);
const fail=(code='WALLET_INVALID_EVENT'):never=>{throw Error(code);};
function record(value:unknown,keys:string[]):Record<string,any>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)return fail();
  for(const key of Object.getOwnPropertyNames(value))if(!keys.includes(key)||!('value' in Object.getOwnPropertyDescriptor(value,key)!))return fail();
  return value as Record<string,any>;
}
function id(value:unknown):string{
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)||['constructor','prototype','__proto__'].includes(value))return fail();
  return value;
}
function text(value:unknown,max:number):string{
  if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value))return fail();return value;
}
export const walletCode=(walletId:string)=>`W-${digest(id(walletId)).slice(0,16).toUpperCase().match(/.{4}/g)!.join('-')}`;
export const isWalletOperation=(op:SyncOperation)=>!!op?.payload&&Object.hasOwn(op.payload,'walletEvent');
export const isAllocationJournal=(journalId:string)=>journalId.startsWith('wa-journal-');
export const allocationJournalId=(transferId:string,side:'source'|'destination')=>`wa-journal-${digest(`${transferId}:${side}`).slice(0,40)}`;
export function personalWalletHome(workspaces:Iterable<Workspace>,owner:string):Workspace|undefined{
  return Array.from(workspaces).filter(w=>w.ownerSubjectHash===owner&&w.kind==='personal'&&!w.deletedAt)
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))[0];
}
function readEvent(op:SyncOperation):WalletEvent{
  record(op.payload,['id','walletEvent']);const e=record(op.payload.walletEvent,['version','action','wallet','walletId','accountId','transfer','adopted','change']);
  if(e.version!==1||op.protocolVersion!==1||op.type!=='workspace.update'||op.payload.id!==op.entityId||
    !Number.isSafeInteger(op.seq)||op.seq<1||!Number.isFinite(Date.parse(op.createdAtUtc))||
    op.authorSubjectHash&&op.authorSubjectHash!==op.ownerHash||op.contentSha256!==digest(canonicalJson(op.payload)))return fail();
  if(e.action==='wallet.create'){
    record(e,['version','action','wallet','accountId','adopted']);const w=record(e.wallet,['id','code','homeWorkspaceId','name','kind','createdAt']);
    if(typeof e.adopted!=='boolean'||w.code!==walletCode(w.id)||!kinds.includes(w.kind)||!text(w.name,100).trim()||
      typeof w.createdAt!=='string'||!Number.isFinite(Date.parse(w.createdAt)))return fail();
    return{version:1,action:'wallet.create',wallet:{id:id(w.id),code:w.code,homeWorkspaceId:id(w.homeWorkspaceId),name:w.name,kind:w.kind,createdAt:w.createdAt},accountId:id(e.accountId),adopted:e.adopted};
  }
  if(e.action==='wallet.link'){
    record(e,['version','action','walletId','accountId']);return{version:1,action:'wallet.link',walletId:id(e.walletId),accountId:id(e.accountId)};
  }
  if(e.action==='wallet.change'){
    record(e,['version','action','change']);const c=record(e.change,['walletId','commandId','revision','action','name']);
    if(!Number.isSafeInteger(c.revision)||c.revision<1||!['rename','archive','restore','delete'].includes(c.action)||
      (c.action==='rename'?!text(c.name,100).trim():Object.hasOwn(c,'name')))return fail();
    return{version:1,action:'wallet.change',change:{walletId:id(c.walletId),commandId:id(c.commandId),revision:c.revision,action:c.action,...(c.action==='rename'?{name:c.name.trim()}:{})}};
  }
  if(e.action==='allocation.transfer'){
    record(e,['version','action','transfer']);const t=record(e.transfer,['id','sourceAccountId','destinationAccountId','amountMinor','effectiveDate','occurredAtUtc','occurredTimezoneOffsetMinutes','createdAtUtc','note']);
    if(typeof t.amountMinor!=='string'||!/^[1-9]\d{0,17}$/.test(t.amountMinor)||t.sourceAccountId===t.destinationAccountId||
      typeof t.effectiveDate!=='string'||typeof t.occurredAtUtc!=='string'||typeof t.createdAtUtc!=='string'||!Number.isInteger(t.occurredTimezoneOffsetMinutes))return fail();
    validateTransactionTime(t as AllocationTransfer);
    return{version:1,action:'allocation.transfer',transfer:{id:id(t.id),sourceAccountId:id(t.sourceAccountId),destinationAccountId:id(t.destinationAccountId),
      amountMinor:t.amountMinor,effectiveDate:t.effectiveDate,occurredAtUtc:t.occurredAtUtc,occurredTimezoneOffsetMinutes:t.occurredTimezoneOffsetMinutes,createdAtUtc:t.createdAtUtc,note:text(t.note,300)}};
  }
  return fail();
}
function posting(t:AllocationTransfer,side:'source'|'destination',account:Account):BalancedJournal{
  const journalId=allocationJournalId(t.id,side),source=side==='source';
  return{transaction:{id:journalId,workspaceId:account.workspaceId,transactionType:'transfer',effectiveDate:t.effectiveDate,
    occurredAtUtc:t.occurredAtUtc,occurredTimezoneOffsetMinutes:t.occurredTimezoneOffsetMinutes,createdAtUtc:t.createdAtUtc,createdOpId:'',note:t.note||'Workspace allocation transfer'},
    lines:[{id:`${journalId}-cash`,transactionId:journalId,accountId:account.id,debitMinor:source?'0':t.amountMinor,creditMinor:source?t.amountMinor:'0',categoryId:null},
      {id:`${journalId}-clearing`,transactionId:journalId,accountId:SYSTEM_ACCOUNTS.WORKSPACE_CLEARING,debitMinor:source?t.amountMinor:'0',creditMinor:source?'0':t.amountMinor,categoryId:null}]};
}
function assertPosting(actual:JournalTransaction,expected:BalancedJournal){
  const {createdOpId:ignored,...transaction}=actual;void ignored;
  const {createdOpId:unused,...definition}=expected.transaction;void unused;
  if(canonicalJson(transaction)!==canonicalJson({...definition,lines:expected.lines}))return fail('WALLET_TRANSFER_CONFLICT');
}
/** Order-independent retained history validation. Missing sync references remain pending. */
export function readWalletBook(state:State){
  const wallets=new Map<string,MasterWallet>(),links=new Map<string,WalletAllocation>();
  const states=new Map<string,WalletLifecycle>(),commands=new Map<string,WalletChange>();
  const definitions=new Map<string,string>();
  const events=Array.from(state.syncOperations.values()).filter(isWalletOperation).map(op=>({op,event:readEvent(op)}));
  let pendingReferences=0;
  for(const {op,event:e} of events){
    const ws=state.workspaces.get(op.entityId);
    if(!ws||ws.ownerSubjectHash!==op.ownerHash)return fail('WALLET_OWNER_MISMATCH');
    if(e.action!=='wallet.create')continue;
    const w=e.wallet;
    if(w.homeWorkspaceId!==op.entityId||ws.kind!=='personal'||ws.deletedAt)return fail('WALLET_HOME_REQUIRED');
    const previous=wallets.get(w.id);
    if(previous&&definitions.get(w.id)!==canonicalJson(e))return fail('WALLET_CODE_CONFLICT');
    if(Array.from(wallets.values()).some(other=>other.code===w.code&&other.id!==w.id))return fail('WALLET_CODE_CONFLICT');
    wallets.set(w.id,{...w});states.set(w.id,{revision:0,status:'active'});definitions.set(w.id,canonicalJson(e));
  }
  const transfers=new Map<string,{transfer:AllocationTransfer;owner:string}>();
  for(const {op,event:e} of events){
    if(e.action==='wallet.change')continue;
    if(e.action==='allocation.transfer'){
      const previous=transfers.get(e.transfer.id);
      if(previous&&(canonicalJson(previous.transfer)!==canonicalJson(e.transfer)||previous.owner!==op.ownerHash))return fail('WALLET_TRANSFER_CONFLICT');
      const source=state.accounts.get(e.transfer.sourceAccountId);
      if(source&&source.workspaceId!==op.entityId)return fail('WALLET_OWNER_MISMATCH');
      transfers.set(e.transfer.id,{transfer:e.transfer,owner:op.ownerHash});continue;
    }
    const walletId=e.action==='wallet.create'?e.wallet.id:e.walletId,wallet=wallets.get(walletId),account=state.accounts.get(e.accountId);
    if(!wallet||!account){pendingReferences++;continue;}
    const home=state.workspaces.get(wallet.homeWorkspaceId),ws=state.workspaces.get(account.workspaceId);
    if(home?.ownerSubjectHash!==op.ownerHash||ws?.ownerSubjectHash!==op.ownerHash||ws.deletedAt||
      (account.classification||'asset')!=='asset'||isLoanLedgerAccount(account.id)||account.kind!==wallet.kind||
      e.action==='wallet.create'&&account.workspaceId!==wallet.homeWorkspaceId||
      e.action==='wallet.link'&&op.entityId!==account.workspaceId)return fail('WALLET_OWNER_MISMATCH');
    const previous=links.get(account.id);
    if(previous&&previous.walletId!==walletId||Array.from(links.values()).some(l=>l.walletId===walletId&&l.workspaceId===account.workspaceId&&l.accountId!==account.id))return fail('WALLET_LINK_CONFLICT');
    links.set(account.id,{walletId,accountId:account.id,workspaceId:account.workspaceId});
  }
  const changes=new Map<string,Map<number,{change:WalletChange;at:string}>>();
  for(const {op,event:e} of events){
    if(e.action!=='wallet.change')continue;const c=e.change,wallet=wallets.get(c.walletId);
    if(!wallet){pendingReferences++;continue;}
    if(op.entityId!==wallet.homeWorkspaceId||state.workspaces.get(wallet.homeWorkspaceId)?.ownerSubjectHash!==op.ownerHash)return fail('WALLET_OWNER_MISMATCH');
    const command=commands.get(c.commandId);if(command&&canonicalJson(command)!==canonicalJson(c))return fail('WALLET_REVISION_CONFLICT');
    commands.set(c.commandId,c);
    const revisions=changes.get(c.walletId)||new Map(),prior=revisions.get(c.revision);
    if(prior&&canonicalJson(prior.change)!==canonicalJson(c))return fail('WALLET_REVISION_CONFLICT');
    if(!prior||op.createdAtUtc<prior.at)revisions.set(c.revision,{change:c,at:op.createdAtUtc});changes.set(c.walletId,revisions);
  }
  for(const [walletId,revisions] of changes){
    const lifecycle=states.get(walletId)!,wallet=wallets.get(walletId)!;
    for(const {change:c,at} of [...revisions.values()].sort((a,b)=>a.change.revision-b.change.revision)){
      if(c.revision!==lifecycle.revision+1){pendingReferences++;continue;}
      if(lifecycle.status==='deleted')return fail('WALLET_DELETED');
      if(c.action==='rename')wallet.name=c.name!;
      if(c.action==='archive'){if(lifecycle.status!=='active')return fail('WALLET_REVISION_CONFLICT');lifecycle.status='archived';}
      if(c.action==='restore'){if(lifecycle.status!=='archived')return fail('WALLET_ARCHIVE_REQUIRED');lifecycle.status='active';}
      if(c.action==='delete'){if(lifecycle.status!=='archived')return fail('WALLET_ARCHIVE_REQUIRED');lifecycle.status='deleted';}
      lifecycle.revision=c.revision;lifecycle.changedAt=at;
    }
  }
  const expectedJournals=new Set<string>();
  for(const {transfer:t,owner} of transfers.values())for(const side of ['source','destination'] as const){
    const accountId=side==='source'?t.sourceAccountId:t.destinationAccountId,account=state.accounts.get(accountId);
    if(!account||!links.has(accountId)){pendingReferences++;continue;}
    if(state.workspaces.get(account.workspaceId)?.ownerSubjectHash!==owner)return fail('WALLET_OWNER_MISMATCH');
    const expected=posting(t,side,account);expectedJournals.add(expected.transaction.id);
    const actual=state.journalTransactions.get(expected.transaction.id);
    if(!actual)pendingReferences++;else assertPosting(actual,expected);
  }
  // A financial side arriving before its metadata is not spendable as a settled transfer.
  for(const tx of state.journalTransactions.values())if(isAllocationJournal(tx.id)&&!expectedJournals.has(tx.id))pendingReferences++;
  // A tombstone hides a settled, empty wallet; it never erases its journal.
  for(const [walletId,lifecycle] of states)if(lifecycle.status==='deleted'){
    const blocker=deletionBlocker(state,links,walletId);if(blocker)return fail(blocker);
  }
  return{wallets,links,transfers,states,commands,pendingReferences};
}
function deletionBlocker(state:State,links:Map<string,WalletAllocation>,walletId:string):string|null{
  const accounts=[...links.values()].filter(l=>l.walletId===walletId),ids=new Set(accounts.map(a=>a.accountId));
  const balances:Record<string,string>={};
  for(const a of state.accounts.values()){
    let amount=BigInt(a.openingBalanceMinor);
    for(const tx of state.journalTransactions.values())for(const line of tx.lines)if(line.accountId===a.id&&!line.categoryId)amount+=BigInt(line.debitMinor)-BigInt(line.creditMinor);
    balances[a.id]=amount.toString();
  }
  if(accounts.some(a=>balances[a.accountId]!==undefined&&balances[a.accountId]!=='0'))return 'WALLET_BALANCE_REMAINS';
  for(const ws of new Set(accounts.map(a=>a.workspaceId))){
    const projection=projectSavingsGoals(savingsRecords(state.syncOperations.values(),ws),ws,balances,localDate());
    if(projection.orphanAllocationCount||projection.orphanReleaseCount)return 'WALLET_SYNC_INCOMPLETE';
    if(projection.goals.some(g=>g.contributions.some(c=>ids.has(c.accountId)&&c.requestedMinor!=='0')))return 'WALLET_SAVINGS_REMAIN';
  }
  if(readSavingsLoans(state).some(row=>(ids.has(row.issue.terms.sourceAccountId)||ids.has(row.issue.terms.borrowerAccountId))&&(row.pendingReferences||row.balance.totalDueMinor!=='0')))return 'WALLET_LOAN_REMAINS';
  return null;
}
/** Derived metadata only. Raw account definitions and financial history stay intact. */
export function walletAccountView(state:State,account:Account,book=readWalletBook(state)):Account{
  const link=book.links.get(account.id),lifecycle=link&&book.states.get(link.walletId),wallet=link&&book.wallets.get(link.walletId);
  if(!lifecycle||!wallet||lifecycle.status==='active')return account;
  return{...account,archivedAt:lifecycle.changedAt||wallet.createdAt};
}
export function walletDeletionBlocker(db:LocalDatabase,walletId:string):string|null{
  const book=readWalletBook(db.getRawState());
  if(book.pendingReferences)return 'WALLET_SYNC_INCOMPLETE';
  return deletionBlocker(db.getRawState(),book.links,walletId);
}
function owned(db:LocalDatabase,workspaceId:string,active=true){
  const owner=db.getIdentity()?.ownerSubjectHash||'local-owner',ws=db.getWorkspace(workspaceId);
  if(!ws||ws.ownerSubjectHash!==owner||ws.deletedAt||active&&ws.archivedAt)return fail('WALLET_OWNER_MISMATCH');return ws;
}
function accountFor(db:LocalDatabase,accountId:string){
  const a=db.getAccount(accountId);if(!a||a.archivedAt||(a.classification||'asset')!=='asset'||isLoanLedgerAccount(a.id))return fail('WALLET_ACCOUNT_UNAVAILABLE');
  owned(db,a.workspaceId);return a;
}
function settled(db:LocalDatabase){const book=readWalletBook(db.getRawState());if(book.pendingReferences)return fail('WALLET_SYNC_INCOMPLETE');return book;}
/** An employee's scoped account grant does not authorize global cash management. */
export function assertWalletOwner(db:LocalDatabase,actorHash?:string){
  if(actorHash!==undefined&&actorHash!==(db.getIdentity()?.ownerSubjectHash||'local-owner'))return fail('WALLET_OWNER_MISMATCH');
}
export function walletSummaries(db:LocalDatabase,period?:{fromDate:string;toDate:string},actorHash?:string):MasterWalletSummary[]{
  assertWalletOwner(db,actorHash);
  if(period){resolveJournalTime({effectiveDate:period.fromDate});resolveJournalTime({effectiveDate:period.toDate});if(period.fromDate>period.toDate)return fail();}
  const owner=db.getIdentity()?.ownerSubjectHash||'local-owner',book=readWalletBook(db.getRawState());
  const cache=new Map<string,ReturnType<LocalDatabase['getSavingsProjection']>>();
  return Array.from(book.wallets.values()).filter(w=>db.getWorkspace(w.homeWorkspaceId)?.ownerSubjectHash===owner).map(wallet=>{
    const allocations=Array.from(book.links.values()).filter(l=>l.walletId===wallet.id).map(link=>{
      const workspace=owned(db,link.workspaceId,false),account=db.getAccount(link.accountId)!;
      if(!cache.has(workspace.id))cache.set(workspace.id,db.getSavingsProjection(workspace.id));
      const amounts=cache.get(workspace.id)!.accounts.find(a=>a.accountId===account.id);
      const balance=amounts?.balanceMinor||'0';
      let income=0n,expense=0n;
      for(const tx of db.getTransactions(workspace.id)){
        if(tx.isDeleted||tx.isReplacedBy||period&&(tx.effectiveDate<period.fromDate||tx.effectiveDate>period.toDate))continue;
        for(const line of tx.lines)if(line.accountId===account.id&&!line.categoryId){
          if(tx.transactionType==='income')income+=BigInt(line.debitMinor)-BigInt(line.creditMinor);
          if(tx.transactionType==='expense')expense+=BigInt(line.creditMinor)-BigInt(line.debitMinor);
        }
        if(tx.transactionType==='transfer'&&tx.lines.filter(l=>l.accountId===account.id&&!l.categoryId).reduce((n,l)=>n+BigInt(l.creditMinor)-BigInt(l.debitMinor),0n)>0n)
          expense+=tx.lines.filter(l=>l.categoryId).reduce((n,l)=>n+BigInt(l.debitMinor)-BigInt(l.creditMinor),0n);
      }
      return{...link,workspaceName:workspace.name,accountName:account.name,balanceMinor:balance,reservedMinor:amounts?.allocatedMinor||'0',
        availableMinor:workspace.archivedAt||account.archivedAt?'0':amounts?.availableMinor||balance,incomeMinor:income.toString(),expenseMinor:expense.toString(),archived:!!(workspace.archivedAt||account.archivedAt)};
    });
    const sum=(field:'balanceMinor'|'reservedMinor'|'availableMinor')=>allocations.reduce((n,a)=>n+BigInt(a[field]),0n).toString();
    const balanceMinor=sum('balanceMinor'),reservedMinor=sum('reservedMinor'),allocationAvailable=BigInt(sum('availableMinor'));
    const physicalAvailable=BigInt(balanceMinor)-BigInt(reservedMinor),cap=physicalAvailable>0n?physicalAvailable:0n;
    return{wallet,lifecycle:book.states.get(wallet.id)!,allocations,balanceMinor,reservedMinor,availableMinor:(allocationAvailable<cap?allocationAvailable:cap).toString()};
  });
}
/** Existing allocation deficits must not invent spendable physical cash. Same-wallet
 * reallocation moves ownership only; it does not consume physical cash. */
export function walletOutflowLimit(db:LocalDatabase,sourceAccountId:string,destinationAccountId?:string):string|null{
  const book=settled(db),link=book.links.get(sourceAccountId);if(!link)return null;
  if(destinationAccountId&&book.links.get(destinationAccountId)?.walletId===link.walletId)return null;
  return walletSummaries(db).find(w=>w.wallet.id===link.walletId)?.availableMinor||'0';
}
export async function createMasterWallet(db:LocalDatabase,input:{id:string;name:string;kind:Account['kind'];openingBalanceMinor:string;existingAccountId?:string;actorHash?:string}){
  assertWalletOwner(db,input.actorHash);
  await db.beginTransaction();try{
    const owner=db.getIdentity()?.ownerSubjectHash||'local-owner',home=personalWalletHome(db.getRawState().workspaces.values(),owner);
    if(!home||home.archivedAt)return fail('WALLET_HOME_REQUIRED');owned(db,home.id);
    const book=settled(db),previous=book.wallets.get(input.id);
    if(previous){
      const creation=Array.from(db.getRawState().syncOperations.values()).filter(isWalletOperation).map(op=>readEvent(op)).find(e=>e.action==='wallet.create'&&e.wallet.id===input.id);
      if(!creation||creation.action!=='wallet.create'||creation.wallet.name!==input.name.trim()||previous.kind!==input.kind||
        creation.adopted!==!!input.existingAccountId||input.existingAccountId&&creation.accountId!==input.existingAccountId||
        !input.existingAccountId&&db.getAccount(creation.accountId)?.openingBalanceMinor!==input.openingBalanceMinor)return fail('WALLET_CODE_CONFLICT');
      await db.rollbackTransaction();return previous;
    }
    if(!/^(?:0|[1-9]\d{0,17})$/.test(input.openingBalanceMinor)||input.existingAccountId&&input.openingBalanceMinor!=='0')return fail();
    let account:Account;
    if(input.existingAccountId){account=accountFor(db,input.existingAccountId);if(account.workspaceId!==home.id||account.kind!==input.kind||book.links.has(account.id))return fail('WALLET_LINK_CONFLICT');}
    else account=db.createAccount(home.id,input.name.trim(),input.kind,input.openingBalanceMinor);
    const wallet:MasterWallet={id:id(input.id),code:walletCode(input.id),homeWorkspaceId:home.id,name:input.name.trim(),kind:input.kind,createdAt:new Date().toISOString()};
    db.queueSyncOp('workspace.update',home.id,{id:home.id,walletEvent:{version:1,action:'wallet.create',wallet,accountId:account.id,adopted:!!input.existingAccountId}});
    settled(db);await db.commitTransaction();return wallet;
  }catch(error){await db.rollbackTransaction();throw error;}
}
export async function linkMasterWallet(db:LocalDatabase,code:string,workspaceId:string,existingAccountId?:string,actorHash?:string){
  assertWalletOwner(db,actorHash);
  await db.beginTransaction();try{
    owned(db,workspaceId);const book=settled(db),wallet=Array.from(book.wallets.values()).find(w=>w.code===code.trim().toUpperCase()&&db.getWorkspace(w.homeWorkspaceId)?.ownerSubjectHash===(db.getIdentity()?.ownerSubjectHash||'local-owner'));
    if(!wallet)return fail('WALLET_CODE_NOT_FOUND');
    if(book.states.get(wallet.id)?.status!=='active')return fail('WALLET_ACCOUNT_UNAVAILABLE');
    const previous=Array.from(book.links.values()).find(l=>l.walletId===wallet.id&&l.workspaceId===workspaceId);
    if(previous){if(existingAccountId&&previous.accountId!==existingAccountId)return fail('WALLET_LINK_CONFLICT');const account=accountFor(db,previous.accountId);await db.rollbackTransaction();return account;}
    const account=existingAccountId?accountFor(db,existingAccountId):db.createAccount(workspaceId,wallet.name,wallet.kind,'0');
    if(account.workspaceId!==workspaceId||account.kind!==wallet.kind||book.links.has(account.id))return fail('WALLET_LINK_CONFLICT');
    db.queueSyncOp('workspace.update',workspaceId,{id:workspaceId,walletEvent:{version:1,action:'wallet.link',walletId:wallet.id,accountId:account.id}});
    settled(db);await db.commitTransaction();return account;
  }catch(error){await db.rollbackTransaction();throw error;}
}

/** Revision-bound, atomic metadata commands. DELETE is a permanent tombstone,
 * never a financial deletion or a balance adjustment. */
export async function changeMasterWallet(db:LocalDatabase,input:{walletId:string;commandId:string;expectedRevision:number;action:WalletChange['action'];name?:string;confirmation?:string;actorHash?:string}){
  assertWalletOwner(db,input.actorHash);
  if((input.action==='delete'||input.action==='archive')&&!isDeleteConfirmed(input.confirmation||''))return fail('WALLET_DELETE_CONFIRMATION');
  await db.beginTransaction();try{
    const book=settled(db),wallet=book.wallets.get(input.walletId),lifecycle=book.states.get(input.walletId);
    if(!wallet||!lifecycle)return fail('WALLET_CODE_NOT_FOUND');owned(db,wallet.homeWorkspaceId);
    const change:WalletChange={walletId:input.walletId,commandId:id(input.commandId),revision:input.expectedRevision+1,action:input.action,...(input.action==='rename'?{name:(input.name||'').trim()}:{})};
    const previous=book.commands.get(input.commandId);
    if(previous){if(canonicalJson(previous)!==canonicalJson(change))return fail('WALLET_REVISION_CONFLICT');await db.rollbackTransaction();return;}
    if(!Number.isSafeInteger(input.expectedRevision)||lifecycle.revision!==input.expectedRevision)return fail('WALLET_REVISION_CONFLICT');
    if(lifecycle.status==='deleted')return fail('WALLET_DELETED');
    if(input.action==='delete'){
      if(lifecycle.status!=='archived')return fail('WALLET_ARCHIVE_REQUIRED');
      const blocker=deletionBlocker(db.getRawState(),book.links,input.walletId);if(blocker)return fail(blocker);
    }
    db.queueSyncOp('workspace.update',wallet.homeWorkspaceId,{id:wallet.homeWorkspaceId,walletEvent:{version:1,action:'wallet.change',change}});
    if(input.action==='rename')for(const link of book.links.values())if(link.walletId===wallet.id)db.updateAccount(link.accountId,{name:change.name!});
    settled(db);await db.commitTransaction();
  }catch(error){await db.rollbackTransaction();throw error;}
}
export async function transferAllocation(db:LocalDatabase,input:{id:string;sourceAccountId:string;destinationAccountId:string;amountMinor:string;effectiveDate?:string;note?:string;actorHash?:string}){
  assertWalletOwner(db,input.actorHash);
  await db.beginTransaction();try{
    const book=settled(db),prior=book.transfers.get(input.id)?.transfer;
    if(prior){if(prior.sourceAccountId!==input.sourceAccountId||prior.destinationAccountId!==input.destinationAccountId||prior.amountMinor!==input.amountMinor||prior.note!==(input.note||'').trim()||input.effectiveDate&&prior.effectiveDate!==input.effectiveDate)return fail('WALLET_TRANSFER_CONFLICT');await db.rollbackTransaction();return input.id;}
    const source=accountFor(db,input.sourceAccountId),destination=accountFor(db,input.destinationAccountId);
    if(!book.links.has(source.id)||!book.links.has(destination.id))return fail('WALLET_ACCOUNT_UNAVAILABLE');
    const t:AllocationTransfer={id:id(input.id),sourceAccountId:source.id,destinationAccountId:destination.id,amountMinor:input.amountMinor,
      ...resolveJournalTime({effectiveDate:input.effectiveDate}),note:(input.note||'').trim()};
    const sourceProjection=db.getSavingsProjection(source.workspaceId),available=sourceProjection.accounts.find(a=>a.accountId===source.id)?.availableMinor||'0';
    if(sourceProjection.orphanAllocationCount||sourceProjection.orphanReleaseCount)return fail('WALLET_SYNC_INCOMPLETE');
    if(!/^[1-9]\d{0,17}$/.test(t.amountMinor)||BigInt(t.amountMinor)>BigInt(available))return fail('WALLET_INSUFFICIENT_ALLOCATION');
    if(source.id===destination.id)return fail('WALLET_TRANSFER_SAME_ACCOUNT');
    const physical=walletOutflowLimit(db,source.id,destination.id);
    if(physical!==null&&BigInt(t.amountMinor)>BigInt(physical))return fail('WALLET_PHYSICAL_SHORTFALL');
    for(const side of ['source','destination'] as const){
      const balanced=posting(t,side,side==='source'?source:destination);
      const op=db.queueSyncOp('journal.post',balanced.transaction.id,{balancedJournal:balanced});
      balanced.transaction.createdOpId=op.operationId;op.payload.balancedJournal.transaction.createdOpId=op.operationId;
      op.contentSha256=digest(canonicalJson(op.payload));
      db.getRawState().journalTransactions.set(balanced.transaction.id,{...balanced.transaction,lines:balanced.lines});
      for(const line of balanced.lines)db.getRawState().journalLines.set(line.id,line);
    }
    db.queueSyncOp('workspace.update',source.workspaceId,{id:source.workspaceId,walletEvent:{version:1,action:'allocation.transfer',transfer:t}});
    settled(db);await db.commitTransaction();return t.id;
  }catch(error){await db.rollbackTransaction();throw error;}
}

/** Only linked allocation accounts acquire the new hard spending boundary. */
export function assertAllocationSpend(db:LocalDatabase,balanced:BalancedJournal){
  const book=readWalletBook(db.getRawState());
  for(const accountId of new Set(balanced.lines.filter(l=>!l.categoryId).map(l=>l.accountId))){
    if(!book.links.has(accountId))continue;
    if(book.pendingReferences)return fail('WALLET_SYNC_INCOMPLETE');
    const account=accountFor(db,accountId);if(account.workspaceId!==balanced.transaction.workspaceId)return fail('WALLET_OWNER_MISMATCH');
    const debit=balanced.lines.filter(l=>l.accountId===accountId&&!l.categoryId).reduce((n,l)=>n+BigInt(l.creditMinor)-BigInt(l.debitMinor),0n);
    const p=db.getSavingsProjection(account.workspaceId),available=BigInt(p.accounts.find(a=>a.accountId===accountId)?.availableMinor||'0');
    if(debit>0n&&(p.orphanAllocationCount||p.orphanReleaseCount))return fail('WALLET_SYNC_INCOMPLETE');
    if(debit>0n&&debit>available)return fail('WALLET_INSUFFICIENT_ALLOCATION');
    const physical=debit>0n?walletOutflowLimit(db,accountId):null;
    if(physical!==null&&debit>BigInt(physical))return fail('WALLET_PHYSICAL_SHORTFALL');
  }
}
