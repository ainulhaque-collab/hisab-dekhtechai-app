import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { validateContentDraft,validateContentDocument,type ContentDocument,type ContentDraft } from '../content/contracts';
import { createContentRouter } from '../../server/content/http';
import { contentIdentityVerifier,INITIAL_ADMIN_EMAIL } from '../../server/content/identity';
import { ownerHashForSubject } from '../../server/ai/googleIdentity';
import { contentDatabaseConfig,contentOptionsFromEnvironment } from '../../server/content/runtime';
import { ContentError,PostgresContentStore } from '../../server/content/store';
import { publicArticles } from '../content/client';

const owner='a'.repeat(64);
const draft:ContentDraft={kind:'article',language:'bn',title:'Synthetic title',body:'Synthetic educational draft',status:'draft',audience:'public',sources:['https://example.invalid/source']};
const doc:ContentDocument={...draft,id:randomUUID(),revision:1,updatedAt:'2026-10-29T10:00:00Z'};

test('content contracts permit plain text posts but never a published or public broadcast',()=>{
  assert.deepEqual(validateContentDraft({...draft,title:'  Synthetic title  '}),draft);
  assert.equal(validateContentDraft({...draft,body:'<script>alert(1)</script>'}).body,'<script>alert(1)</script>','UI must render stored plain text without HTML execution');
  for(const raw of [{...draft,isAdmin:true},{...draft,sources:['javascript:alert(1)']},{...draft,sources:['https://user:pass@example.invalid']},{...draft,kind:'announcement',audience:'public'},{...draft,kind:'announcement',audience:'opted-in',status:'published'}])assert.throws(()=>validateContentDraft(raw),/CONTENT_REQUEST_INVALID/);
  assert.throws(()=>validateContentDocument({...doc,actor_hash:owner}),/CONTENT_REQUEST_INVALID/);
});

test('Admin identity requires approved verified email plus matching introspected Google subject and audience',async()=>{
  const clientId='synthetic-client.apps.googleusercontent.com',sub='123456789';let verified=true,email=INITIAL_ADMIN_EMAIL,otherSub=sub;
  const fetchFn:typeof fetch=async(url,request)=>{
    assert.doesNotMatch(String(url),/synthetic-token/);assert.equal(new Headers(request?.headers).get('authorization'),'Bearer synthetic-token');
    return String(url).includes('tokeninfo')?Response.json({sub,aud:clientId,azp:clientId,expires_in:3600,exp:Math.floor(Date.now()/1000)+3600,scope:'openid email'}):Response.json({sub:otherSub,email,email_verified:verified});
  };
  const verify=contentIdentityVerifier([clientId],fetchFn);
  assert.deepEqual(await verify('synthetic-token'),{ownerHash:ownerHashForSubject(sub),isAdmin:true});
  verified=false;assert.equal((await verify('synthetic-token')).isAdmin,false);
  verified=true;email='another@example.invalid';assert.equal((await verify('synthetic-token')).isAdmin,false);
  email=INITIAL_ADMIN_EMAIL;otherSub='987654321';await assert.rejects(verify('synthetic-token'),/AI_AUTH_REQUIRED/);
});

test('PostgreSQL config keeps certificate verification on and resource activation explicitly Preview-only',()=>{
  const options=contentDatabaseConfig('postgresql://synthetic:synthetic@db.example.invalid/preview?sslmode=require');
  assert.deepEqual(options.ssl,{rejectUnauthorized:true});assert.equal(new URL(options.connectionString!).searchParams.has('sslmode'),false);assert.equal(options.max,2);
  for(const url of ['postgresql://a:b@db.example.invalid/db?sslmode=disable','postgresql://a:b@db.example.invalid/db?sslrootcert=/private','https://example.invalid/db'])assert.throws(()=>contentDatabaseConfig(url));
  assert.equal(contentOptionsFromEnvironment({VERCEL_ENV:'production',CONTENT_ENABLED:'true',CONTENT_DATABASE_URL:'postgresql://a:b@db.example.invalid/db'}).enabled,false);
  assert.equal(contentOptionsFromEnvironment({VERCEL_ENV:'preview'}).enabled,false);
});

test('content API denies readers and forged roles, exposes only published posts, and never accepts a send action',async t=>{
  let saved=0;
  const app=express();app.use('/api',createContentRouter({enabled:true,allowedOrigins:new Set(['https://example.invalid']),verifyToken:async token=>({ownerHash:owner,isAdmin:token==='approved-admin'}),store:{listPublished:async()=>[{...doc,status:'published'}],listDrafts:async()=>[doc],save:async()=>{saved++;return doc;}}}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  const origin=`http://127.0.0.1:${(server.address() as any).port}`;
  const post=(body:unknown,token='reader',site='https://example.invalid')=>fetch(origin+'/api/content',{method:'POST',headers:{Origin:site,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({action:'list',ownerHash:owner})).status,403);
  assert.equal((await post({action:'status',ownerHash:owner,isAdmin:true})).status,400);
  assert.equal((await post({action:'status',ownerHash:'b'.repeat(64)},'approved-admin')).status,403);
  assert.equal((await post({action:'status',ownerHash:owner},'approved-admin','https://evil.invalid')).status,403);
  const status=await(await post({action:'status',ownerHash:owner},'approved-admin')).json();assert.equal(status.isAdmin,true);assert.equal(status.broadcastEnabled,false);
  assert.equal((await post({action:'send',ownerHash:owner},'approved-admin')).status,400);
  const command={action:'save',ownerHash:owner,requestId:randomUUID(),id:doc.id,document:draft,expectedRevision:0};
  assert.equal((await post(command)).status,403);assert.equal(saved,0);
  assert.equal((await post(command,'approved-admin')).status,200);assert.equal(saved,1);
  const response=await fetch(origin+'/api/articles');assert.equal(response.headers.get('cache-control'),'no-store, private');assert.equal((await response.json()).articles[0].status,'published');
  await assert.rejects(publicArticles('https://example.invalid',new AbortController().signal,async()=>Response.json({articles:[doc]})),/CONTENT_RESPONSE_INVALID/);
});

test('PostgreSQL save uses parameters, atomic audit, revision conflicts and request-id replay',async()=>{
  const calls:{sql:string;values:any[]}[]=[];let command:any;let failAudit=false,conflict=false,released=0;
  const client={release(){released++;},async query(sql:string,values:any[]=[]){calls.push({sql,values});
    if(sql.startsWith('SELECT actor_hash'))return {rows:command?[command]:[]};
    if(sql.startsWith('INSERT INTO hisab_content_documents'))return {rows:conflict?[]:[{id:doc.id,revision:1,data:JSON.parse(values[2]),updated_at:doc.updatedAt}]};
    if(sql.startsWith('INSERT INTO hisab_content_commands')){if(failAudit)throw new Error('Synthetic audit failure');command={actor_hash:values[1],request_hash:values[2],response:JSON.parse(values[4])};}
    return {rows:[]};
  }};
  const store=new PostgresContentStore({connect:async()=>client} as any),request=randomUUID();
  const malicious={...draft,body:"Synthetic '); DROP TABLE finance; --"};
  const saved=await store.save(owner,request,doc.id,malicious,0);assert.equal(saved.body,malicious.body);assert.equal(calls.some(call=>call.sql.includes('DROP TABLE')),false);assert.equal(calls.at(-1)?.sql,'COMMIT');
  const writes=calls.filter(call=>call.sql.startsWith('INSERT INTO hisab_content_documents')).length;
  assert.deepEqual(await store.save(owner,request,doc.id,malicious,0),saved);assert.equal(calls.filter(call=>call.sql.startsWith('INSERT INTO hisab_content_documents')).length,writes);
  await assert.rejects(store.save(owner,request,doc.id,draft,0),(error:unknown)=>error instanceof ContentError&&error.code==='CONTENT_CONFLICT');assert.equal(calls.at(-1)?.sql,'ROLLBACK');
  command=null;failAudit=true;await assert.rejects(store.save(owner,randomUUID(),doc.id,draft,0),/Synthetic audit failure/);assert.equal(calls.at(-1)?.sql,'ROLLBACK');
  failAudit=false;conflict=true;await assert.rejects(store.save(owner,randomUUID(),doc.id,draft,0),/CONTENT_CONFLICT/);assert.equal(calls.at(-1)?.sql,'ROLLBACK');assert.equal(released,5);
});
