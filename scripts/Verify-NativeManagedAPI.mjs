import {readFile} from 'node:fs/promises';
const plan=JSON.parse(await readFile(new URL('../config/native-ai-preview.plan.json',import.meta.url),'utf8'));
for(const path of plan.allowedApiPaths){
  const response=await fetch(plan.apiOrigin+path,{method:'OPTIONS',headers:{Origin:plan.nativeOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status!==204||response.headers.get('access-control-allow-origin')!==plan.nativeOrigin)throw Error('NATIVE_API_CORS_INSTALL_GATE_NOT_READY');
}
for(const [path,method,status,code] of [['/api/access','POST',401,'ACCESS_SIGN_IN_REQUIRED'],['/api/ai/extract','POST',401,'AI_AUTH_REQUIRED'],['/admin','GET',404,'NATIVE_API_ROUTE_NOT_FOUND'],['/','GET',404,'NATIVE_API_ROUTE_NOT_FOUND'],['/auth/callback','GET',404,'NATIVE_API_ROUTE_NOT_FOUND']]){
  const response=await fetch(plan.apiOrigin+path,{method,headers:method==='POST'?{'Content-Type':'application/json',Origin:plan.nativeOrigin}:{},body:method==='POST'?'{}':undefined,credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(response.status!==status||!response.headers.get('content-type')?.includes('application/json'))throw Error('NATIVE_API_INSTALL_GATE_NOT_READY');
  const result=await response.json();if(result.error!==code)throw Error('NATIVE_API_INSTALL_GATE_NOT_READY');
}
console.log('NATIVE_API_PUBLIC_REACHABILITY_AUTH_AND_UI_ISOLATION_PASS');
