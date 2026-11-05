import { customerEmail } from '../auth/customerIdentity.js';

export function emailBatch(raw:unknown):string[]{
  if(!Array.isArray(raw)||raw.length<1||raw.length>50||raw.some(value=>typeof value!=='string')||raw.join('').length>6000)throw Error('ACCESS_EMAILS_INVALID');
  try{return [...new Set(raw.map(value=>customerEmail(value)))].sort();}catch{throw Error('ACCESS_EMAILS_INVALID');}
}
export function parseEmailBatch(text:string){return emailBatch(text.trim().split(/[\s,;]+/));}
export interface AdminCustomer {customerId:string;emails:string[];blocked:boolean;active:boolean;expiresAt:string|null;lastSeenAt:string|null}
export interface PendingEmailGrant {requestId:string;email:string;days:number;createdAt:string}
export interface AdminDirectorySnapshot {
  counts:{total:number;active:number;blocked:number;expired:number;pending:number};
  customers:AdminCustomer[];pending:PendingEmailGrant[];
  events:{sequence:string;kind:string;subject:string|null;createdAt:string}[];
  nextCursor:string|null;serverTime:string;
}
