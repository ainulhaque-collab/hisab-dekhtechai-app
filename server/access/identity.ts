import { createHash } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { verifiedCustomer } from '../../src/auth/customerIdentity.js';

export class AccessError extends Error {
  constructor(readonly code:string,readonly status=400){super(code);}
}
export interface ServiceCustomer {customerId:string;ownerHash:string}
export const customerServiceHash=(customerId:string)=>createHash('sha256').update('hisab-customer:'+customerId).digest('hex');

/** Only the configured Auth server can establish an identity; JWT payloads and
 * client-supplied emails/roles are never authorization evidence. */
export function serviceCustomerVerifier(projectUrl:string,publishableKey:string,fetchFn:typeof fetch=fetch){
  const url=new URL(projectUrl);
  if(url.protocol!=='https:'||url.origin!==projectUrl||url.username||url.password||!publishableKey||publishableKey.startsWith('sb_secret_'))throw new AccessError('ACCESS_NOT_CONFIGURED',503);
  return async(token:string):Promise<ServiceCustomer>=>{
    if(!token||token.length>16_384||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(token))throw new AccessError('ACCESS_SIGN_IN_REQUIRED',401);
    let response:Response;
    try{response=await fetchFn(url.origin+'/auth/v1/user',{headers:{apikey:publishableKey,Authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12_000)});}
    catch{throw new AccessError('ACCESS_AUTH_UNAVAILABLE',503);}
    if(!response.ok)throw new AccessError(response.status>=500?'ACCESS_AUTH_UNAVAILABLE':'ACCESS_SIGN_IN_REQUIRED',response.status>=500?503:401);
    try{
      const text=await response.text();if(text.length>100_000)throw Error();
      const user=JSON.parse(text) as User,account=verifiedCustomer(user,user.id,null);
      return {customerId:account.customerId,ownerHash:customerServiceHash(account.customerId)};
    }catch{throw new AccessError('ACCESS_SIGN_IN_REQUIRED',401);}
  };
}
