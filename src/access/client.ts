import type { AIIdentity } from '../ai/client';
import { aiEndpoint } from '../ai/client';

export function accessEndpoint(base:string,origin:string,native=false){return aiEndpoint(base,origin,native).replace(/\/ai\/extract$/,'/access');}
export async function accessRequest(identity:AIIdentity,endpoint:string,body:Record<string,unknown>,signal?:AbortSignal,fetchFn:typeof fetch=fetch):Promise<any>{
  const owner=identity.getProfile()?.subjectHash;if(!owner)throw Error('ACCESS_SIGN_IN_REQUIRED');
  let token:string;try{token=await identity.getValidAccessToken();}catch{throw Error('ACCESS_SIGN_IN_REQUIRED');}
  if(identity.getProfile()?.subjectHash!==owner||signal?.aborted)throw Error('ACCESS_ACCOUNT_CHANGED');
  let response:Response;
  try{response=await fetchFn(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000)});}
  catch{throw Error('ACCESS_UNAVAILABLE');}
  const text=await response.text();if(text.length>16_000||!response.headers.get('content-type')?.includes('application/json'))throw Error('ACCESS_UNAVAILABLE');
  if(identity.getProfile()?.subjectHash!==owner||signal?.aborted)throw Error('ACCESS_ACCOUNT_CHANGED');
  let value:any;try{value=JSON.parse(text);}catch{throw Error('ACCESS_UNAVAILABLE');}
  if(!response.ok){const allowed=new Set(['ACCESS_SIGN_IN_REQUIRED','ACCESS_ADMIN_REQUIRED','ACCESS_CODE_INVALID','ACCESS_CODE_ALREADY_ISSUED','ACCESS_OWNER_PROTECTED','ACCESS_REVISION_CONFLICT','ACCESS_REQUEST_CONFLICT','ACCESS_REQUEST_INVALID','ACCESS_KEY_INVALID','ACCESS_NOT_CONFIGURED','ACCESS_LIMIT_REACHED','AI_ACCESS_BLOCKED','AI_SUBSCRIPTION_REQUIRED']);throw Error(allowed.has(value?.error)?value.error:'ACCESS_UNAVAILABLE');}
  return value;
}
export function accessErrorMessage(error:unknown,en=false){
  const code=error instanceof Error?error.message:'';
  const messages:Record<string,[string,string]>={
    ACCESS_SIGN_IN_REQUIRED:['Sign in to your account first.','আগে আপনার অ্যাকাউন্টে লগইন করুন।'],
    ACCESS_ADMIN_REQUIRED:['This account does not have Admin access.','এই অ্যাকাউন্টে অ্যাডমিন অনুমতি নেই।'],
    ACCESS_CODE_INVALID:['This code is invalid, expired or already used.','কোডটি সঠিক নয়, মেয়াদ শেষ অথবা আগেই ব্যবহার হয়েছে।'],
    ACCESS_CODE_ALREADY_ISSUED:['The code was already issued. Create a new code if the first response was lost.','কোডটি আগেই তৈরি হয়েছে। আগের উত্তর না পেলে নতুন কোড তৈরি করুন।'],
    ACCESS_OWNER_PROTECTED:['The owner account cannot be blocked.','মালিকের অ্যাকাউন্ট ব্লক করা যাবে না।'],
    ACCESS_REVISION_CONFLICT:['Settings changed. Refresh before trying again.','সেটিংস বদলেছে। রিফ্রেশ করে আবার চেষ্টা করুন।'],
    AI_ACCESS_BLOCKED:['Your access is blocked. Contact the Admin.','আপনার ব্যবহার বন্ধ আছে। অ্যাডমিনের সঙ্গে যোগাযোগ করুন।'],
    AI_SUBSCRIPTION_REQUIRED:['Redeem a code or renew your subscription to use AI.','AI ব্যবহার করতে রিডিম কোড দিন অথবা সাবস্ক্রিপশন নবায়ন করুন।'],
    ACCESS_NOT_CONFIGURED:['This service has not been enabled yet.','এই সেবাটি এখনও চালু করা হয়নি।'],
    ACCESS_KEY_INVALID:['Enter the complete API key without spaces.','ফাঁকা জায়গা ছাড়া সম্পূর্ণ API key দিন।'],
    ACCESS_LIMIT_REACHED:['Too many requests. Wait one minute and try again.','অনুরোধের সীমা হয়েছে। এক মিনিট পরে আবার চেষ্টা করুন।'],
  };
  return (messages[code]??['The request could not finish. No automatic retry was made.','অনুরোধ শেষ হয়নি। নিজে থেকে আবার চেষ্টা করা হয়নি।'])[en?0:1];
}
