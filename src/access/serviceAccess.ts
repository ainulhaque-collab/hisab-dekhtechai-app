import type { AIIdentity } from '../ai/client';
import { accessRequest } from './client';
import { customerUuid } from '../auth/customerIdentity';
import { customerServiceHash } from './identity';
export interface ServiceAccessStatus {customerId:string;active:boolean;blocked:boolean;expiresAt:string|null}
/** Hosting permission and a client label never authorize a chargeable call. */
export async function readServiceAccess(identity:AIIdentity,endpoint:string,signal:AbortSignal,fetchFn?:typeof fetch):Promise<ServiceAccessStatus>{
  const status=await accessRequest(identity,endpoint,{action:'status'},signal,fetchFn);
  if(!status||!customerUuid(status.customerId)||customerServiceHash(status.customerId)!==identity.getProfile()?.subjectHash||typeof status.active!=='boolean'||typeof status.blocked!=='boolean'||status.blocked&&status.active||status.expiresAt!==null&&(typeof status.expiresAt!=='string'||!Number.isFinite(Date.parse(status.expiresAt))))throw Error('ACCESS_UNAVAILABLE');
  return {customerId:status.customerId,active:status.active,blocked:status.blocked,expiresAt:status.expiresAt};
}
