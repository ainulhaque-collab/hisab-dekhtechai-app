import {canonicalJson,computeSha256Sync} from '../canonical';
import {mergeBackup} from '../../storage/backup';

export const LIVE_KEY='hisab-live-sync-v1';
export const CORE_MAPS=['workspaces','accounts','accountGroups','accountPermissions','categories','parties',
  'journalTransactions','journalLines','syncOperations','budgets','recurringRules','recurringOccurrences','receiptBlobs'] as const;
export type LiveCore={schemaVersion:6;localIdentity:any}&Record<typeof CORE_MAPS[number],[string,any][]>;
export type BaseHashes=Record<string,Record<string,string>>;
export interface LiveCheckpoint {customerId:string;datasetId:string;revision:string;sha256:string;base:BaseHashes}
export class LiveConflict extends Error {constructor(readonly paths:string[]){super('LIVE_CONFLICT');}}

/** No credentials, device settings, recovery snapshots, cursor or outbox feedback. */
export function liveCore(data:Record<string,any>):LiveCore {
  const core:any={schemaVersion:6,localIdentity:data.localIdentity||null};
  for(const key of CORE_MAPS){core[key]=[...(data[key]||[])].map(([id,value]:[string,any])=>{
    const clone=structuredClone(value);
    if(key==='syncOperations'){const digest=computeSha256Sync(canonicalJson(clone.payload));if(clone.contentSha256&&clone.contentSha256!==digest)throw Error('LIVE_CHECKSUM');clone.contentSha256=digest;}
    return[id,clone];
  }).sort(([a],[b])=>a<b?-1:a>b?1:0);}
  return core;
}
export function coreHash(core:LiveCore):string{return computeSha256Sync(canonicalJson(core));}
export function baseHashes(core:LiveCore):BaseHashes{return Object.fromEntries(CORE_MAPS.map(key=>[key,Object.fromEntries(core[key].map(([id,value])=>[id,computeSha256Sync(canonicalJson(value))]))]));}
export function validateLiveCore(value:unknown):asserts value is LiveCore {
  const core=value as LiveCore;
  if(!core||core.schemaVersion!==6||Object.keys(core).some(k=>!['schemaVersion','localIdentity',...CORE_MAPS].includes(k)))throw Error('LIVE_INVALID');
  for(const key of CORE_MAPS){if(!Array.isArray(core[key]))throw Error('LIVE_INVALID');const ids=new Set<string>();
    for(const entry of core[key]){if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||ids.has(entry[0]))throw Error('LIVE_INVALID');ids.add(entry[0]);}}
  const allowed=['workspace.create','workspace.update','workspace.archive','account.create','account.update','account.archive','account.restore','account.delete','group.create','group.update','group.archive','group.restore','permission.grant','permission.revoke','category.create','category.update','category.archive','party.create','party.update','party.archive','journal.post','journal.correct','journal.delete','budget.set','recurring.rule.create','recurring.rule.update','recurring.occurrence.post','receipt.attach'];
  for(const [,op] of core.syncOperations)if(!allowed.includes(op?.type)||op.protocolVersion!==1||!/^[0-9a-f]{64}$/.test(op.contentSha256)||op.contentSha256!==computeSha256Sync(canonicalJson(op.payload)))throw Error('LIVE_VERSION');
  for(const [,budget] of core.budgets)if(typeof budget.limitMinor!=='string'||!/^\d+$/.test(budget.limitMinor))throw Error('LIVE_INVALID');
  for(const [,rule] of core.recurringRules)if(typeof rule.amountMinor!=='string'||!/^\d+$/.test(rule.amountMinor))throw Error('LIVE_INVALID');
  const data={...core,deviceIdentity:{deviceId:'live-validation',deviceName:'Validation',counter:1,createdAt:'2026-01-01T00:00:00Z'},preferences:[],syncOutbox:[],syncDeviceHeads:[],appliedOperations:[],conflicts:[]};
  mergeBackup(data,data);
}
export function mergeLive(base:BaseHashes,local:LiveCore,remote:LiveCore):LiveCore {
  if((local.localIdentity?.ownerSubjectHash||null)!==(remote.localIdentity?.ownerSubjectHash||null))throw Error('LIVE_OWNER_MISMATCH');
  // An existing journal/line/operation cannot disappear or change its immutable fields.
  for(const key of ['journalTransactions','journalLines','syncOperations'] as const){const l=new Map(local[key]),r=new Map(remote[key]);
    const immutable=(value:any)=>{if(key!=='journalTransactions')return value;const {isDeleted:_,isReplacedBy:__,...rest}=value;return rest;};
    for(const id of new Set([...l.keys(),...r.keys()])){
      if(l.has(id)&&r.has(id)&&canonicalJson(immutable(l.get(id)))!==canonicalJson(immutable(r.get(id))))throw new LiveConflict([`${key}/${id}`]);
      if(base[key]?.[id]&&(!l.has(id)||!r.has(id)))throw new LiveConflict([`${key}/${id}`]);
    }
  }
  const result:any={schemaVersion:6,localIdentity:remote.localIdentity};const conflicts:string[]=[];
  for(const key of CORE_MAPS){const l=new Map(local[key]),r=new Map(remote[key]),merged=new Map<string,any>();
    for(const id of new Set([...l.keys(),...r.keys(),...Object.keys(base[key]||{})])){
      const lv=l.get(id),rv=r.get(id),lh=l.has(id)?computeSha256Sync(canonicalJson(lv)):undefined,rh=r.has(id)?computeSha256Sync(canonicalJson(rv)):undefined,bh=base[key]?.[id];
      let value:any;
      if(lh===rh)value=lv;else if(lh===bh)value=rv;else if(rh===bh)value=lv;else{conflicts.push(`${key}/${id}`);continue;}
      if(value!==undefined)merged.set(id,structuredClone(value));
    }
    result[key]=[...merged].sort(([a],[b])=>a<b?-1:a>b?1:0);
  }
  if(conflicts.length)throw new LiveConflict(conflicts.slice(0,50));
  try{validateLiveCore(result);}catch{throw new LiveConflict(['projection']);}return result;
}
export function recoveryData(core:LiveCore,deviceIdentity:unknown){return {...core,deviceIdentity,preferences:[],syncOutbox:[],syncDeviceHeads:[],appliedOperations:core.syncOperations.map(([id])=>id),conflicts:[],localSnapshots:[],schemaMigrations:[]};}
