import type {Account,JournalLine,SyncOperation} from '../contracts/types';
import {canonicalJson,computeSha256Sync} from '../sync/canonical';

/** Permanent IDs are never reused, including after importing an older backup. */
export function deletedAccountIds(operations:Iterable<SyncOperation>,owner:string|null):Set<string>{
 const ids=new Set<string>();
 for(const op of operations){if(op.type!=='account.delete')continue;
  const id=op.payload?.id;
  if(typeof id!=='string'||!id||id!==op.entityId||Object.keys(op.payload).some(k=>k!=='id')||
   (owner?op.ownerHash!==owner:!['local-owner','unassigned',''].includes(op.ownerHash))||
   op.protocolVersion!==1||!Number.isSafeInteger(op.seq)||op.seq<1||
   op.contentSha256&&op.contentSha256!==computeSha256Sync(canonicalJson(op.payload)))throw Error('ACCOUNT_DELETE_INVALID');
  ids.add(id);
 }
 return ids;
}
export function retainAccountDeletions(accounts:Map<string,Account>,operations:Iterable<SyncOperation>,owner:string|null,lines:Iterable<JournalLine>):Map<string,Account>{
 const deleted=deletedAccountIds(operations,owner);if(!deleted.size)return accounts;
 // A stale financial posting must cause review, never disappear with the account.
 for(const line of lines)if(deleted.has(line.accountId))throw Error('ACCOUNT_DELETE_FINANCIAL_CONFLICT');
 const result=new Map(accounts);
 for(const id of deleted){if(result.has(id)&&BigInt(result.get(id)!.openingBalanceMinor)!==0n)throw Error('ACCOUNT_DELETE_FINANCIAL_CONFLICT');result.delete(id);}
 return result;
}
