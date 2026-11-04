import type { FinancialSyncOperation } from '../../contracts/financialSync';
import { assertPushRequest, syncMinorUnits } from '../financialSyncBoundary';
import { assertJournalBalanced } from '../../domain/journal';
import { SYSTEM_ACCOUNTS } from '../../contracts/ledger';
import { validateTransactionTime } from '../../domain/transactionTime';
import type { BalancedJournal } from '../../contracts/types';

export const syncCommands = ['workspace.create','account.create','category.create','journal.post'] as const;
export const syncError = (code = 'SYNC_PAYLOAD_INVALID'): never => { throw new Error(code); };
export const isUuid = (s: unknown): s is string => typeof s==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
export const object = (s: unknown): s is Record<string, any> => s!==null && typeof s==='object' && !Array.isArray(s) && [Object.prototype,null].includes(Object.getPrototypeOf(s));
const text = (s: unknown, min:number,max:number): s is string => typeof s==='string' && [...s].length>=min && [...s].length<=max && !s.includes('\0');
function fields(s: unknown, keys: string[]): asserts s is Record<string,any> { if(!object(s)||Object.keys(s).some(k=>!keys.includes(k))) syncError(); }
const instant = (s:unknown) => typeof s==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString()===s;

/** ASCII protocol keys, safe integer JSON metadata, UTF-8 string values. No fake hash fallback. */
export function wireJson(value: unknown): string {
  if(value===null || typeof value==='boolean') return JSON.stringify(value);
  if(typeof value==='string') { if(value.includes('\0')) syncError(); return JSON.stringify(value); }
  if(typeof value==='number') { if(!Number.isSafeInteger(value)) syncError(); return JSON.stringify(value); }
  if(Array.isArray(value)) return '['+value.map(wireJson).join(',')+']';
  if(!object(value) || Object.keys(value).some(k=>!/^\w+$/.test(k))) return syncError();
  return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+wireJson(value[k])).join(',')+'}';
}
export async function operationDigest(op: Omit<FinancialSyncOperation,'contentSha256'> | FinancialSyncOperation): Promise<string> {
  const {contentSha256:_,...body}=op as FinancialSyncOperation;
  const bytes=new TextEncoder().encode(wireJson(body));
  if(bytes.length>65536 || !globalThis.crypto?.subtle) return syncError('SYNC_CRYPTO_UNAVAILABLE');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function verifyOperation(op: FinancialSyncOperation): Promise<void> {
  assertPushRequest({requestId:op.operationId,scope:{ownerId:op.workspaceId,workspaceId:op.workspaceId,deviceId:op.deviceId},operations:[op]});
  if(await operationDigest(op)!==op.contentSha256) syncError('SYNC_HASH_MISMATCH');
}

/** Shared local projection validation; server independently checks permissions and payloads. */
export function validatePayload(op: FinancialSyncOperation, owner: string): void {
  const p=op.payload, ws=op.workspaceId;
  if(op.type==='workspace.create') {
    fields(p,['workspace']); const w=p.workspace; fields(w,['id','ownerSubjectHash','name','description','kind','currency','createdAt','archivedAt','deletedAt']);
    if(w.id!==ws || op.entityId!==ws || w.ownerSubjectHash!==owner || !text(w.name,1,120) || !w.name.trim() ||
      !['personal','business'].includes(w.kind) || w.currency!=='BDT' || !instant(w.createdAt) ||
      (w.description!=null&&!text(w.description,0,1000)) || w.archivedAt!=null || w.deletedAt!=null) syncError();
  } else if(op.type==='account.create') {
    fields(p,['account']); const a=p.account; fields(a,['id','workspaceId','groupId','name','kind','classification','openingBalanceMinor','accountNumberMasked','createdAt','archivedAt']);
    if(!isUuid(a.id) || a.id!==op.entityId || a.workspaceId!==ws || !text(a.name,1,120) || !a.name.trim() ||
      !['cash','bank','bkash','nagad','rocket','other'].includes(a.kind) || a.classification!=='asset' ||
      a.groupId!=null || a.openingBalanceMinor!=='0' || !instant(a.createdAt) || a.archivedAt!=null ||
      (a.accountNumberMasked!=null&&!text(a.accountNumberMasked,0,80))) syncError();
  } else if(op.type==='category.create') {
    fields(p,['category']); const c=p.category; fields(c,['id','workspaceId','parentId','kind','name','nameEn','icon','color','archivedAt']);
    if(!isUuid(c.id) || c.id!==op.entityId || c.workspaceId!==ws || !['income','expense'].includes(c.kind) ||
      !text(c.name,1,120) || !c.name.trim() || (c.parentId!=null&&!isUuid(c.parentId)) || c.archivedAt!=null ||
      ['nameEn','icon','color'].some(k=>c[k]!=null&&!text(c[k],0,120))) syncError();
  } else if(op.type==='journal.post') {
    fields(p,['balancedJournal']); const j=p.balancedJournal; fields(j,['transaction','lines']); const t=j.transaction;
    fields(t,['id','workspaceId','transactionType','effectiveDate','occurredAtUtc','createdAtUtc','occurredTimezoneOffsetMinutes','note','createdOpId','partyId','receiptBlobSha256','receiptName','reversalOf','isDeleted','isReplacedBy']);
    if(!isUuid(t.id) || t.id!==op.entityId || t.workspaceId!==ws || t.createdOpId!==op.operationId ||
      !['opening','income','expense','transfer'].includes(t.transactionType) || !instant(t.occurredAtUtc) ||
      !text(t.effectiveDate,10,10) || !/^\d{4}-\d\d-\d\d$/.test(t.effectiveDate) ||
      !Number.isFinite(Date.parse(t.effectiveDate+'T00:00:00.000Z')) || new Date(t.effectiveDate+'T00:00:00.000Z').toISOString().slice(0,10)!==t.effectiveDate ||
      (t.note!=null&&!text(t.note,0,1000)) || t.partyId!=null || t.receiptBlobSha256!=null || t.receiptName!=null || t.reversalOf!=null ||
      (t.isDeleted!==undefined&&t.isDeleted!==false) || t.isReplacedBy!=null ||
      !Array.isArray(j.lines) || j.lines.length<2 || j.lines.length>100) syncError();
    if(t.createdAtUtc!==undefined&&!instant(t.createdAtUtc))syncError();
    validateTransactionTime(t as any);
    const ids=new Set<string>();
    for(const l of j.lines) {
      fields(l,['id','transactionId','accountId','debitMinor','creditMinor','categoryId']);
      if(!isUuid(l.id) || ids.has(l.id) || l.transactionId!==t.id ||
        (!isUuid(l.accountId)&&!Object.values(SYSTEM_ACCOUNTS).includes(l.accountId)) ||
        (l.categoryId!=null&&!isUuid(l.categoryId))) syncError();
      ids.add(l.id); if(BigInt(syncMinorUnits(l.debitMinor))<0n || BigInt(syncMinorUnits(l.creditMinor))<0n) syncError();
    }
    assertJournalBalanced(j.lines as BalancedJournal['lines']);
  } else syncError('SYNC_COMMAND_UNSUPPORTED');
}
