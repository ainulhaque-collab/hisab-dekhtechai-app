import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {nativeSurfaceResponse} from '../../server/access/nativeSurface';
import {NATIVE_AI_PREVIEW_ORIGIN} from '../access/nativePreview';
import {readServiceAccess} from '../access/serviceAccess';
import {customerServiceHash} from '../access/identity';
const id='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
test('public native hostname permits only the reviewed API surface and never serves Admin or assets',async()=>{
  const plan=JSON.parse(await readFile(new URL('../../config/native-ai-preview.plan.json',import.meta.url),'utf8'));assert.equal(plan.apiOrigin,NATIVE_AI_PREVIEW_ORIGIN);
  for(const path of plan.allowedApiPaths)assert.equal(nativeSurfaceResponse(new Request(plan.apiOrigin+path)),null);
  for(const path of ['/','/admin','/admin/settings','/auth/callback?code=synthetic','/assets/private.js','/api/notifications/push','/api/access/extra','/api/access%2Fextra','/api/access/../admin','//api/access']){
    const response=nativeSurfaceResponse(new Request(plan.apiOrigin+path,{headers:{'x-forwarded-host':new URL(plan.protectedAdminOrigin).host}}));assert.equal(response?.status,404,path);assert.deepEqual(await response!.json(),{error:'NATIVE_API_ROUTE_NOT_FOUND'});
  }
  assert.equal(nativeSurfaceResponse(new Request(plan.protectedAdminOrigin+'/admin')),null,'existing protected Admin routing is preserved');
  assert.equal(nativeSurfaceResponse(new Request('http://'+new URL(plan.apiOrigin).host+'/api/access'))?.status,404);
});
test('AI permission preflight rejects foreign, contradictory and stale identity replies',async()=>{
  let current=customerServiceHash(id);const identity={isTestMode:()=>false,getProfile:()=>current?{subjectHash:current}:null,getValidAccessToken:async()=>'synthetic-token'};
  const status={customerId:id,active:true,blocked:false,expiresAt:null};
  const read=(body:unknown)=>readServiceAccess(identity,NATIVE_AI_PREVIEW_ORIGIN+'/api/access',new AbortController().signal,async()=>Response.json(body));
  assert.equal((await read(status)).active,true);assert.equal((await read({...status,active:false,blocked:true})).blocked,true);
  for(const invalid of [{...status,customerId:other},{...status,blocked:true},{...status,active:'yes'},{...status,expiresAt:'invalid'}])await assert.rejects(()=>read(invalid),/ACCESS_UNAVAILABLE/);
  await assert.rejects(()=>readServiceAccess(identity,NATIVE_AI_PREVIEW_ORIGIN+'/api/access',new AbortController().signal,async()=>{current='';return Response.json(status);}),/ACCESS_ACCOUNT_CHANGED/);
});
