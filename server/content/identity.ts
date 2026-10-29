import { googleIdentityVerifier,ownerHashForSubject,AIServiceError } from '../ai/googleIdentity.js';

export const INITIAL_ADMIN_EMAIL='ainulshalkhuria@gmail.com';
/** Role comes only from verified Google responses, never request/profile claims. */
export function contentIdentityVerifier(clientIds:string[],fetchFn:typeof fetch=fetch) {
  const verify=googleIdentityVerifier(clientIds,fetchFn);
  return async(token:string)=>{
    const ownerHash=await verify(token);
    let response:Response;
    try{response=await fetchFn('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});}catch{throw new AIServiceError('AI_AUTH_UNAVAILABLE',503);}
    if(!response.ok)throw new AIServiceError('AI_AUTH_UNAVAILABLE',503);
    let info:any;try{info=await response.json();}catch{throw new AIServiceError('AI_AUTH_UNAVAILABLE',503);}
    if(typeof info?.sub!=='string'||ownerHashForSubject(info.sub)!==ownerHash)throw new AIServiceError('AI_AUTH_REQUIRED',401);
    return {ownerHash,isAdmin:info.email_verified===true&&typeof info.email==='string'&&info.email.toLowerCase()===INITIAL_ADMIN_EMAIL};
  };
}
