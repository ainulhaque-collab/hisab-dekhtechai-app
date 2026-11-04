import type { LocalSyncStorePort,SyncScope,SyncCursor,FinancialSyncOperation,SyncAcknowledgement,RemotePullResult,PushOutcome } from '../../contracts/financialSync';
import { LocalDatabase } from '../../storage/db';
import { validatePullPage } from '../financialSyncBoundary';
import { operationDigest,verifyOperation,validatePayload,wireJson,syncError,isUuid } from './wire';
import type { SyncOperation,JournalTransaction } from '../../contracts/types';
import { SYSTEM_ACCOUNTS } from '../../contracts/ledger';

/** Adapter over the existing LocalDatabase snapshot/transaction, not a second finance database. */
export class DatabaseSyncStore implements LocalSyncStorePort {
  private queue:Promise<unknown>=Promise.resolve();
  constructor(readonly db:LocalDatabase) {}
  assertScope(scope:SyncScope):void {
    const workspace=this.db.getWorkspace(scope.workspaceId);
    if(!isUuid(scope.ownerId)||!isUuid(scope.workspaceId)||!isUuid(scope.deviceId)||
      this.db.getIdentity()?.ownerSubjectHash!==scope.ownerId || this.db.getDeviceId()!==scope.deviceId ||
      (workspace && workspace.ownerSubjectHash!==scope.ownerId)) syncError('SYNC_LOCAL_OWNER_MISMATCH');
  }
  private key(scope:SyncScope,name:string):string {return `hisab_pg_v1:${scope.ownerId}:${scope.workspaceId}:${scope.deviceId}:${name}`;}
  private pref(scope:SyncScope,name:string):any {return this.db.getRawState().preferences.get(this.key(scope,name));}
  private async atomic<T>(scope:SyncScope,work:()=>T,active=()=>true):Promise<T> {
    const run=this.queue.catch(()=>{}).then(async()=>{
      await this.db.init();await this.db.waitForPendingWrites();this.assertScope(scope);
      if(!active()) syncError('SYNC_SESSION_CHANGED');
      await this.db.beginTransaction();
      try {this.assertScope(scope);if(!active()) syncError('SYNC_SESSION_CHANGED');const value=work();
        this.assertScope(scope);if(!active())syncError('SYNC_SESSION_CHANGED');await this.db.commitTransaction();return value;
      }catch(error){await this.db.rollbackTransaction();throw error;}
    });this.queue=run;return run;
  }
  private belongs(op:SyncOperation,scope:SyncScope):boolean {
    if(op.ownerHash!==scope.ownerId)return false;
    const p=op.payload,s=this.db.getRawState();
    const workspace=p.workspace?.id??p.account?.workspaceId??p.category?.workspaceId??p.group?.workspaceId??p.grant?.workspaceId??
      p.balancedJournal?.transaction?.workspaceId??p.workspaceId??s.workspaces.get(op.entityId)?.id??
      s.accounts.get(op.entityId)?.workspaceId??s.categories.get(op.entityId)?.workspaceId??
      s.accountGroups.get(op.entityId)?.workspaceId??s.accountPermissions.get(op.entityId)?.workspaceId??
      s.parties.get(op.entityId)?.workspaceId??s.journalTransactions.get(op.entityId)?.workspaceId??
      s.budgets.get(op.entityId)?.workspaceId??s.recurringRules.get(op.entityId)?.workspaceId;
    // An unmapped pending command must never disappear behind a false 'caught up' status.
    if(!workspace)syncError('SYNC_LOCAL_MAPPING_REQUIRED');return workspace===scope.workspaceId;
  }
  pendingCount(scope:SyncScope):number {this.assertScope(scope);return this.db.getPendingOutbox().filter(op=>this.belongs(op,scope)).length;}
  private body(op:SyncOperation,scope:SyncScope):Omit<FinancialSyncOperation,'contentSha256'> {
    if(op.deviceId!==scope.deviceId || !Number.isSafeInteger(op.seq) || op.seq<1 || op.authorSubjectHash || op.grantId)syncError('SYNC_LOCAL_MAPPING_REQUIRED');
    return {protocolVersion:1,operationId:op.operationId,workspaceId:scope.workspaceId,deviceId:op.deviceId,
      sequence:String(op.seq),entityId:op.entityId,type:op.type,createdAtUtc:op.createdAtUtc,payload:JSON.parse(wireJson(op.payload))};
  }
  async readPending(scope:SyncScope,limit:number):Promise<readonly FinancialSyncOperation[]> {
    await this.db.init();this.assertScope(scope);if(!Number.isInteger(limit)||limit<1||limit>100)syncError();
    const pending=this.db.getPendingOutbox().filter(op=>this.belongs(op,scope)).slice(0,limit);
    const prepared=await Promise.all(pending.map(async op=>{const body=this.body(op,scope);return{...body,contentSha256:await operationDigest(body)};}));
    await this.atomic(scope,()=>{for(const op of prepared){const current=this.db.getRawState().syncOperations.get(op.operationId);
      if(!current||wireJson(this.body(current,scope))!==wireJson((({contentSha256:_,...body})=>body)(op)))syncError('SYNC_LOCAL_CHANGED');
      const old=this.pref(scope,'wire:'+op.operationId);if(old&&wireJson(old)!==wireJson(op))syncError('SYNC_IMMUTABLE_CONFLICT');
      this.db.getRawState().preferences.set(this.key(scope,'wire:'+op.operationId),op);
    }});return prepared;
  }
  async readCursor(scope:SyncScope):Promise<SyncCursor> {await this.db.init();this.assertScope(scope);return this.pref(scope,'cursor')??null;}
  async acknowledge(scope:SyncScope,expected:readonly SyncAcknowledgement[],active=()=>true):Promise<void> {
    await this.atomic(scope,()=>{for(const ack of expected){
      const cached=this.pref(scope,'wire:'+ack.operationId) as FinancialSyncOperation|undefined;
      const current=this.db.getRawState().syncOperations.get(ack.operationId),entry=this.db.getRawState().syncOutbox.get(ack.operationId);
      if(!cached||!current||!entry||cached.contentSha256!==ack.contentSha256||!this.belongs(current,scope)||
        wireJson(this.body(current,scope))!==wireJson((({contentSha256:_,...body})=>body)(cached)))syncError('SYNC_ACK_STALE');
    }
    for(const ack of expected){const entry=this.db.getRawState().syncOutbox.get(ack.operationId)!;
      entry.uploadedStatus='uploaded';entry.remoteFileId='postgres:'+ack.operationId;entry.lastError=null;
    }},active);
  }
  async recordOutcomes(scope:SyncScope,outcomes:readonly PushOutcome[]):Promise<void> {
    if(!outcomes.length)return;
    await this.atomic(scope,()=>{for(const outcome of outcomes){
      this.db.getRawState().preferences.set(this.key(scope,'outcome:'+outcome.operationId),outcome.outcome);
      if(outcome.outcome==='conflict'){
        const op=this.db.getRawState().syncOperations.get(outcome.operationId);if(!op)throw Error('SYNC_LOCAL_CHANGED');
        this.quarantine(scope,op.entityId,[outcome.operationId]);
      }
    }});
  }
  private quarantine(scope:SyncScope,entityId:string,operations:string[]):void {
    const id=operations[0];this.db.getRawState().conflicts.set(id,{id,entityId,baseVersion:'postgres-v1',
      originalOpId:id,contenderOpIds:operations,status:'needs_review',detectedAt:new Date().toISOString(),
      details:{title:'Sync conflict needs review',description:'Local records are preserved. No financial entry was replaced.',
        contenders:operations.map(opId=>({opId,deviceId:scope.deviceId,timestamp:new Date().toISOString(),summary:'Immutable operation conflict'}))}});
  }
  async applyPullPageAtomically(scope:SyncScope,expected:SyncCursor,page:RemotePullResult,active=()=>true):Promise<void> {
    validatePullPage({requestId:page.requestId,scope,cursor:expected,limit:100},page);
    for(const change of page.changes){await verifyOperation(change.operation);validatePayload(change.operation,scope.ownerId);}
    const prefix=`h1:${scope.ownerId}:${scope.workspaceId}:`;
    const position=(cursor:SyncCursor):bigint=>{
      if(cursor===null)return 0n;
      if(!cursor.startsWith(prefix)||!/^(0|[1-9][0-9]{0,18})$/.test(cursor.slice(prefix.length)))return syncError('SYNC_CURSOR_INVALID');
      const seq=BigInt(cursor.slice(prefix.length));if(seq>9223372036854775807n)syncError('SYNC_CURSOR_INVALID');return seq;
    };
    let last=position(expected);
    for(const change of page.changes){if(change.changeId!==String(++last))syncError('SYNC_STREAM_GAP');}
    if(page.nextCursor!==prefix+last||position(page.nextCursor)!==last)syncError('SYNC_CURSOR_INVALID');
    try {await this.atomic(scope,()=>{
      if((this.pref(scope,'cursor')??null)!==expected)syncError('SYNC_CURSOR_STALE');
      for(const change of page.changes){const op=change.operation;
        const prior=this.pref(scope,'seen:'+op.operationId)||this.pref(scope,'wire:'+op.operationId)?.contentSha256;
        if(this.db.getRawState().appliedOperations.has(op.operationId)){
          if(prior!==op.contentSha256)syncError('SYNC_IMMUTABLE_CONFLICT');
        }else this.merge(scope,op);
        this.db.getRawState().preferences.set(this.key(scope,'seen:'+op.operationId),op.contentSha256);
      }
      this.db.getRawState().preferences.set(this.key(scope,'cursor'),page.nextCursor);
    },active);}catch(error){
      if((error as Error).message==='SYNC_IMMUTABLE_CONFLICT')await this.atomic(scope,()=>{
        for(const {operation:op} of page.changes){this.quarantine(scope,op.entityId,[op.operationId]);
          this.db.getRawState().preferences.set(this.key(scope,'quarantine:'+op.operationId),op);
        }
      },active);throw error;
    }
  }
  private merge(scope:SyncScope,op:FinancialSyncOperation):void {
    const state=this.db.getRawState(),p=op.payload as any;
    if(op.type==='workspace.create'){
      if(state.workspaces.has(op.entityId))syncError('SYNC_IMMUTABLE_CONFLICT');state.workspaces.set(op.entityId,structuredClone(p.workspace));
    }else{
      if(!state.workspaces.has(scope.workspaceId))syncError('SYNC_DEPENDENCY_MISSING');
      if(op.type==='account.create'){
        if(state.accounts.has(op.entityId))syncError('SYNC_IMMUTABLE_CONFLICT');state.accounts.set(op.entityId,structuredClone(p.account));
      }else if(op.type==='category.create'){
        const c=p.category,parent=c.parentId?state.categories.get(c.parentId):null;
        if(c.parentId&&(!parent||parent.workspaceId!==scope.workspaceId||parent.kind!==c.kind||parent.parentId))syncError('SYNC_DEPENDENCY_MISSING');
        if(state.categories.has(op.entityId))syncError('SYNC_IMMUTABLE_CONFLICT');state.categories.set(op.entityId,structuredClone(c));
      }else if(op.type==='journal.post'){
        const j=p.balancedJournal,tx=j.transaction;
        if(state.journalTransactions.has(tx.id))syncError('SYNC_IMMUTABLE_CONFLICT');
        const assetDebits:string[]=[],assetCredits:string[]=[];
        for(const l of j.lines){
          const a=state.accounts.get(l.accountId),system=Object.values(SYSTEM_ACCOUNTS).includes(l.accountId);
          if(!system&&(!a||a.workspaceId!==scope.workspaceId||a.archivedAt))syncError('SYNC_DEPENDENCY_MISSING');
          const cat=l.categoryId?state.categories.get(l.categoryId):null;
          if(l.categoryId&&(!cat||cat.workspaceId!==scope.workspaceId||cat.archivedAt))syncError('SYNC_DEPENDENCY_MISSING');
          const debit=BigInt(l.debitMinor)>0n,credit=BigInt(l.creditMinor)>0n,asset=a?.classification==='asset',noCategory=l.categoryId==null;
          const revenue=l.accountId===SYSTEM_ACCOUNTS.REVENUE_CLEARING&&credit&&cat?.kind==='income';
          const expense=l.accountId===SYSTEM_ACCOUNTS.EXPENSE_CLEARING&&debit&&cat?.kind==='expense';
          const valid=tx.transactionType==='income'?(asset&&debit&&noCategory)||revenue:
            tx.transactionType==='expense'?(asset&&credit&&noCategory)||expense:
            tx.transactionType==='opening'?noCategory&&((asset&&debit)||(l.accountId===SYSTEM_ACCOUNTS.OPENING_EQUITY&&credit)):
            tx.transactionType==='transfer'?(asset&&noCategory)||expense:false;
          if(!valid)syncError('SYNC_JOURNAL_KIND_INVALID');
          if(asset&&debit)assetDebits.push(l.accountId);if(asset&&credit)assetCredits.push(l.accountId);
          if(state.journalLines.has(l.id))syncError('SYNC_IMMUTABLE_CONFLICT');
        }
        if(tx.transactionType!=='transfer'&&j.lines.length!==2)syncError('SYNC_JOURNAL_KIND_INVALID');
        if(tx.transactionType==='opening'&&assetDebits.length!==1)syncError('SYNC_JOURNAL_KIND_INVALID');
        if(tx.transactionType==='transfer'&&(j.lines.length>4||assetDebits.length!==1||assetCredits.length!==1||assetDebits[0]===assetCredits[0]))syncError('SYNC_JOURNAL_KIND_INVALID');
        const full:JournalTransaction={...structuredClone(tx),lines:structuredClone(j.lines)};
        state.journalTransactions.set(tx.id,full);for(const l of full.lines)state.journalLines.set(l.id,l);
      }
    }
    state.appliedOperations.add(op.operationId);
  }
}
