import { type GuideInput,guideInputHash,validateFinancialGuide } from './financialGuide';
import type { AIIdentity } from './client';
import { aiFeaturesEnabled } from './availability';

export async function requestFinancialGuide(input:GuideInput,owner:string,identity:AIIdentity,options:{endpoint:string;signal:AbortSignal;fetchFn?:typeof fetch}) {
  if(!aiFeaturesEnabled) throw new Error('AI_NOT_CONFIGURED');
  const sourceSha256=guideInputHash(input),requestId=crypto.randomUUID();
  if(identity.isTestMode()) throw new Error('AI_AUTH_REQUIRED');
  let token:string;try{token=await identity.getValidAccessToken();}catch{throw new Error('AI_AUTH_REQUIRED');}
  if(options.signal.aborted||identity.getProfile()?.subjectHash!==owner) throw new Error('AI_OWNER_MISMATCH');
  let response:Response;
  try {response=await(options.fetchFn||fetch)(options.endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({ownerHash:owner,requestId,input}),signal:AbortSignal.any([options.signal,AbortSignal.timeout(60_000)]),credentials:'same-origin',cache:'no-store',redirect:'error'});}
  catch{throw new Error(options.signal.aborted?'AI_CANCELLED':'AI_NETWORK_ERROR');}
  if(options.signal.aborted||identity.getProfile()?.subjectHash!==owner) throw new Error('AI_OWNER_MISMATCH');
  if(!response.headers.get('content-type')?.includes('application/json')) throw new Error('AI_NOT_CONFIGURED');
  const text=await response.text();if(text.length>16000) throw new Error('AI_RESPONSE_INVALID');
  let raw:any;try{raw=JSON.parse(text);}catch{throw new Error('AI_RESPONSE_INVALID');}
  if(!response.ok) {
    const allowed=['AI_AUTH_REQUIRED','AI_OWNER_MISMATCH','AI_LIMIT_REACHED','AI_NOT_CONFIGURED','AI_REQUEST_ALREADY_USED','AI_AUTH_UNAVAILABLE','AI_LIMIT_UNAVAILABLE','AI_PROVIDER_BUSY','AI_PROVIDER_QUOTA','AI_PROVIDER_AUTH_ERROR','AI_CONTENT_BLOCKED','AI_RESPONSE_INCOMPLETE','AI_MODEL_UNAVAILABLE','AI_ORIGIN_DENIED','AI_SUBSCRIPTION_REQUIRED','AI_ACCESS_BLOCKED'];
    throw new Error(allowed.includes(raw?.error)?raw.error:'AI_PROVIDER_UNAVAILABLE');
  }
  if(options.signal.aborted||identity.getProfile()?.subjectHash!==owner) throw new Error('AI_OWNER_MISMATCH');
  if(raw?.sourceSha256!==sourceSha256||raw.requestId!==requestId||!['gemini','openai'].includes(raw.provider)) throw new Error('AI_RESPONSE_INVALID');
  return validateFinancialGuide(raw.guide);
}
