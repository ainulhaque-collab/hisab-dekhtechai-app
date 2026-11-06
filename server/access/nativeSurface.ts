import { NATIVE_AI_PREVIEW_ORIGIN, RETIRED_NATIVE_AI_PREVIEW_ORIGIN } from '../../src/access/nativePreview.js';
const hostname=new URL(NATIVE_AI_PREVIEW_ORIGIN).hostname;
const retiredHostname=new URL(RETIRED_NATIVE_AI_PREVIEW_ORIGIN).hostname;
const paths=new Set(['/api/access','/api/ai/extract','/api/ai/guide']);
/** The native-only hostname must never serve an Admin, OAuth or customer UI.
 * This is an additional surface restriction, not application authorization. */
export function nativeSurfaceResponse(request:Request):Response|null{
  const url=new URL(request.url);
  if(url.hostname!==hostname&&url.hostname!==retiredHostname)return null;
  if(url.hostname===hostname&&url.origin===NATIVE_AI_PREVIEW_ORIGIN&&paths.has(url.pathname))return null;
  return Response.json({error:'NATIVE_API_ROUTE_NOT_FOUND'},{status:404,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
}
