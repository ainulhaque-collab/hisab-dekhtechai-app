import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { AIIdentity } from '../ai/client';
import type { AccountSettingsSession } from '../auth/cloud/accountSettingsSession';

export const customerServiceHash=(id:string)=>bytesToHex(sha256(new TextEncoder().encode('hisab-customer:'+id)));
/** A request handle dies even after sign-out followed by login to the same UUID. */
export function customerRequestIdentity(session:AccountSettingsSession,customerId:string|null):AIIdentity{
  const generation=session.serviceGeneration();
  return {
    isTestMode:()=>false,
    getProfile:()=>{const state=session.getSnapshot();return customerId&&session.serviceGeneration()===generation&&state.phase==='connected'&&state.account?.customerId===customerId?{subjectHash:customerServiceHash(customerId)}:null;},
    getValidAccessToken:()=>{if(!customerId)throw Error('AI_AUTH_REQUIRED');return session.serviceToken(customerId,generation);},
  };
}
