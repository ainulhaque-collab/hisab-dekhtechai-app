import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresSyncProvider,jsonSyncTransport } from '../sync/postgres/provider';
import { operationDigest,wireJson,validatePayload } from '../sync/postgres/wire';
import { generateUUID } from '../domain/journal';
import type { FinancialSyncOperation,PushRequest } from '../contracts/financialSync';

const scope={ownerId:generateUUID(),workspaceId:generateUUID(),deviceId:generateUUID()};
const request:PushRequest={requestId:generateUUID(),scope,operations:[]};
const reply={kind:'remote',requestId:request.requestId,ownerId:scope.ownerId,workspaceId:scope.workspaceId,outcomes:[]};

test('transport timeouts and cancellation settle even when an adapter ignores AbortSignal',async()=>{
  const provider=new PostgresSyncProvider({call:()=>new Promise(()=>{})},15);
  await assert.rejects(provider.push(request),/SYNC_REQUEST_ABORTED/);
  const abort=new AbortController();abort.abort();await assert.rejects(provider.push(request,abort.signal),/SYNC_REQUEST_ABORTED/);
});

test('HTTP errors, redirects, HTML login pages, oversized and malformed JSON never acknowledge',async()=>{
  for(const response of [
    new Response('{}',{status:401,headers:{'Content-Type':'application/json'}}),
    new Response('{}',{status:302,headers:{Location:'https://login.invalid'}}),
    new Response('<html>Login</html>',{headers:{'Content-Type':'text/html'}}),
    new Response('x'.repeat(1048577),{headers:{'Content-Type':'application/json'}}),
    new Response('{broken',{headers:{'Content-Type':'application/json'}}),
    new Response(JSON.stringify({...reply,ownerId:generateUUID()}),{headers:{'Content-Type':'application/json'}}),
  ]){
    const provider=new PostgresSyncProvider(jsonSyncTransport('https://synthetic.invalid/sync',async()=>response));
    await assert.rejects(provider.push(request));
  }
});

test('transport uses bounded explicit JSON requests without ambient cookies or redirect credentials',async()=>{
  const provider=new PostgresSyncProvider(jsonSyncTransport('https://synthetic.invalid/sync',async(url,init)=>{
    assert.equal(url,'https://synthetic.invalid/sync');assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');
    assert.equal(init?.cache,'no-store');assert.equal(JSON.parse(init?.body as string).method,'sync_push');
    return new Response(JSON.stringify(reply),{headers:{'Content-Type':'application/json'}});
  }));
  assert.deepEqual(await provider.push(request),reply);
  for(const url of ['http://example.com/sync','https://user:secret@example.com/sync','https://example.com/sync?token=bad','https://example.com/sync#secret'])
    assert.throws(()=>jsonSyncTransport(url,fetch),/SYNC_ENDPOINT_INVALID/);
});

test('wire rejects lossy amounts and unsupported commands without a fallback digest',async()=>{
  for(const value of [1.5,NaN,Infinity,9007199254740992,1n,{'bad-key':1},['ok',undefined]])assert.throws(()=>wireJson(value));
  const body={protocolVersion:1 as const,operationId:generateUUID(),entityId:scope.workspaceId,workspaceId:scope.workspaceId,
    deviceId:scope.deviceId,sequence:'1',type:'workspace.create' as const,createdAtUtc:'2026-11-04T08:00:00.000Z',
    payload:{workspace:{id:scope.workspaceId,ownerSubjectHash:scope.ownerId,name:'বাংলা 😀',kind:'personal',currency:'BDT',createdAt:'2026-11-04T08:00:00.000Z'}}};
  const op:FinancialSyncOperation={...body,contentSha256:await operationDigest(body)};
  validatePayload(op,scope.ownerId);
  assert.throws(()=>validatePayload({...op,type:'journal.correct'},scope.ownerId),/SYNC_COMMAND_UNSUPPORTED/);
  assert.throws(()=>validatePayload({...op,payload:{workspace:{...body.payload.workspace,archivedAt:false}}},scope.ownerId));
});
