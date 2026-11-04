import test from 'node:test';
import assert from 'node:assert/strict';
import { isShellRequest,shellResponse,isVersionedShellAsset } from '../pwa/offlineShell';

test('offline shell accepts exact static build files only and never intercepts finance/auth/API requests',()=>{
  const origin='https://example.invalid',assets=new Set(['/index.html','/assets/index-abcd1234.js']);
  const request=(path:string,method='GET',mode:RequestMode='cors')=>({url:new URL(path,origin).href,method,mode});
  assert.equal(isShellRequest(request('/','GET','navigate'),origin,assets),true);
  assert.equal(isShellRequest(request('/assets/index-abcd1234.js'),origin,assets),true);
  for(const path of ['/api/ai/extract','/api/notifications/push','/receipt/secret','/backup.json','/?code=secret','/index.html?token=secret','/oauth/callback','https://accounts.google.com/gsi/client','/assets/unlisted.js'])
    assert.equal(isShellRequest(request(path),origin,assets),false,path);
  assert.equal(isShellRequest(request('/','POST','navigate'),origin,assets),false);
  assert.equal(isVersionedShellAsset(request('/assets/old-chunk-abcd1234.js'),origin),true);
  for(const path of ['/api/private-abcd1234.js','/assets/user-media.jpg','/assets/old-chunk-abcd1234.js?token=private','https://foreign.invalid/assets/old-chunk-abcd1234.js'])assert.equal(isVersionedShellAsset(request(path),origin),false);
});

test('offline navigation serves the matching immutable shell; eviction falls back to network without writing responses',async()=>{
  const memory=new Map([['/index.html',new Response('synthetic shell')]]);
  const cache={match:async(key:string)=>memory.get(key)?.clone()} as Cache;
  const request={url:'https://example.invalid/',mode:'navigate'} as Request;
  assert.equal(await(await shellResponse(request,cache,async()=>{throw new Error('offline');})).text(),'synthetic shell');
  memory.clear();
  assert.equal((await shellResponse(request,cache,async()=>new Response('upstream unavailable',{status:503}))).status,503);
  assert.equal(memory.size,0);
});
