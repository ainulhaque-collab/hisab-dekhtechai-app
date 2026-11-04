import type { AIIdentity } from '../ai/client';
import { validateContentDocument } from './contracts';

export async function contentRequest(origin:string,action:string,owner:string,identity:AIIdentity,extra:Record<string,unknown>={},signal?:AbortSignal,fetchFn:typeof fetch=fetch) {
  if(identity.isTestMode())throw new Error('CONTENT_AUTH_REQUIRED');
  let token:string;try{token=await identity.getValidAccessToken();}catch{throw new Error('CONTENT_AUTH_REQUIRED');}
  if(identity.getProfile()?.subjectHash!==owner)throw new Error('CONTENT_OWNER_MISMATCH');
  const response=await fetchFn(`${origin}/api/content`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...extra,action,ownerHash:owner}),credentials:'omit',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25_000)]):AbortSignal.timeout(25_000)});
  const data=await contentJson(response);
  if(signal?.aborted||identity.getProfile()?.subjectHash!==owner)throw new Error('CONTENT_OWNER_MISMATCH');
  if(action==='status'){if(typeof data.isAdmin!=='boolean'||typeof data.configured!=='boolean'||data.broadcastEnabled!==false)throw new Error('CONTENT_RESPONSE_INVALID');}
  else if(action==='list'){if(!Array.isArray(data.documents)||data.documents.length>100)throw new Error('CONTENT_RESPONSE_INVALID');data.documents=data.documents.map(validateContentDocument);}
  else if(action==='save')data.document=validateContentDocument(data.document);
  return data;
}
export async function publicArticles(origin:string,signal:AbortSignal,fetchFn:typeof fetch=fetch){
  const response=await fetchFn(`${origin}/api/articles`,{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15_000)])});
  const data=await contentJson(response);
  if(!Array.isArray(data.articles)||data.articles.length>100)throw new Error('CONTENT_RESPONSE_INVALID');
  const articles=data.articles.map(validateContentDocument);
  if(articles.some((article:any)=>article.kind!=='article'||article.status!=='published'))throw new Error('CONTENT_RESPONSE_INVALID');
  return articles;
}
async function contentJson(response:Response){
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('CONTENT_NOT_CONFIGURED');
  const text=await response.text();if(text.length>1_000_000)throw new Error('CONTENT_RESPONSE_INVALID');
  let data:any;try{data=JSON.parse(text);}catch{throw new Error('CONTENT_RESPONSE_INVALID');}
  if(!response.ok){const allowed=['CONTENT_NOT_CONFIGURED','CONTENT_AUTH_REQUIRED','CONTENT_ADMIN_REQUIRED','CONTENT_OWNER_MISMATCH','CONTENT_CONFLICT','CONTENT_REQUEST_INVALID','CONTENT_AUTH_UNAVAILABLE'];throw new Error(allowed.includes(data?.error)?data.error:'CONTENT_UNAVAILABLE');}
  return data;
}
export function contentError(error:unknown,en:boolean){
  const code=error instanceof Error?error.message:'';
  if(code==='CONTENT_NOT_CONFIGURED')return en?'The content service is awaiting database setup.':'কনটেন্ট সার্ভিসের ডেটাবেস সেটআপ বাকি।';
  if(code==='CONTENT_CONFLICT')return en?'This document changed or the request conflicts. Reload before editing again.':'লেখাটি বদলেছে বা অনুরোধে অমিল আছে। সম্পাদনার আগে আবার লোড করুন।';
  if(code==='CONTENT_ADMIN_REQUIRED')return en?'Only the approved Admin can edit or publish.':'শুধু অনুমোদিত Admin সম্পাদনা বা প্রকাশ করতে পারবেন।';
  if(code==='CONTENT_AUTH_REQUIRED'||code==='CONTENT_OWNER_MISMATCH')return en?'Connect the original Google account and try again.':'আগের Google অ্যাকাউন্ট সংযুক্ত করে আবার চেষ্টা করুন।';
  return en?'Content could not load or save. Keep your draft and try again.':'কনটেন্ট লোড বা সংরক্ষণ হয়নি। খসড়া রেখে আবার চেষ্টা করুন।';
}
