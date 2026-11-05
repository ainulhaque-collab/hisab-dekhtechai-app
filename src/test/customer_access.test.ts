import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { ProviderKeyVault } from '../../server/access/vault';
import { AccessError,customerServiceHash,serviceCustomerVerifier,type ServiceCustomer } from '../../server/access/identity';
import { PostgresAccessStore,type AccessPool } from '../../server/access/store';
import { createAccessRouter } from '../../server/access/http';
import { accessOptionsFromEnvironment } from '../../server/access/runtime';
import { createAIRouter } from '../../server/ai/http';
import { aiOptionsFromEnvironment } from '../../server/ai/runtime';
import { AIServiceError } from '../../server/ai/googleIdentity';
import { receiptFromBytes } from '../storage/receipts';
import { validateEntryDraft } from '../ai/entryDraft';
import { AccountSettingsSession,type AccountSettingsRuntime } from '../auth/cloud/accountSettingsSession';
import { customerRequestIdentity,customerServiceHash as browserHash } from '../access/identity';
import { accessRequest } from '../access/client';

const owner='11111111-1111-4111-8111-111111111111',alice='22222222-2222-4222-8222-222222222222',bob='33333333-3333-4333-8333-333333333333';
const customer=(id:string):ServiceCustomer=>({customerId:id,ownerHash:customerServiceHash(id)});
const master='ad'.repeat(32),secret='synthetic-provider-key-never-real-123456789';
const native=process.env.HISAB_TEST_PG_URL;

test('provider vault binds encryption to provider/revision; tampering and wrong wrapping key fail closed',()=>{
  const vault=new ProviderKeyVault(master),sealed=vault.seal(secret,'gemini',1);
  assert.equal(vault.open(sealed,'gemini',1),secret);assert.ok(!JSON.stringify(sealed).includes(secret));
  assert.notEqual(vault.seal(secret,'gemini',1).ciphertext,sealed.ciphertext);
  for(const attempt of [()=>vault.open(sealed,'gemini',2),()=>vault.open(sealed,'openai',1),()=>new ProviderKeyVault('cd'.repeat(32)).open(sealed,'gemini',1),()=>vault.open({...sealed,tag:'00'.repeat(16)},'gemini',1)])assert.throws(attempt,/ACCESS_KEY_UNAVAILABLE/);
  assert.throws(()=>vault.seal('bad key','gemini',1),/ACCESS_KEY_INVALID/);assert.throws(()=>new ProviderKeyVault('invalid'),/ACCESS_NOT_CONFIGURED/);
});

test('service identity is the online verified stable customer UUID, never email/metadata/JWT payload',async()=>{
  let calls=0;const user:any={id:alice,email:'one@example.invalid',email_confirmed_at:'2026-11-05T00:00:00Z',identities:[{user_id:alice,identity_id:randomUUID(),provider:'google',identity_data:{email:'one@example.invalid'}}],user_metadata:{isAdmin:true,customerId:owner}};
  const verify=serviceCustomerVerifier('https://tenant.example.invalid','sb_publishable_synthetic',async(input,init)=>{
    calls++;assert.equal(String(input),'https://tenant.example.invalid/auth/v1/user');assert.equal(init?.redirect,'error');assert.equal((init?.headers as any).Authorization,'Bearer header.payload.signature');return Response.json(user);
  });
  const first=await verify('header.payload.signature');assert.equal(first.customerId,alice);assert.equal(first.ownerHash,browserHash(alice));
  user.email='two@example.invalid';user.identities.push({...user.identities[0],identity_id:randomUUID()});assert.deepEqual(await verify('header.payload.signature'),first);
  await assert.rejects(()=>verify('opaque-google-token'),/ACCESS_SIGN_IN_REQUIRED/);assert.equal(calls,2);
  user.is_anonymous=true;await assert.rejects(()=>verify('header.payload.signature'),/ACCESS_SIGN_IN_REQUIRED/);
  assert.throws(()=>serviceCustomerVerifier('http://tenant.example.invalid','public'),/ACCESS_NOT_CONFIGURED/);
  const rejected=serviceCustomerVerifier('https://tenant.example.invalid','public',async()=>Response.json({error:'foreign issuer'},{status:401}));await assert.rejects(()=>rejected('header.payload.signature'),/ACCESS_SIGN_IN_REQUIRED/);
});

test(`access SQL commands on ${native?'isolated native PostgreSQL':'PGlite'}`,async t=>{
  let sql:any,pool:AccessPool,close:()=>Promise<void>;
  if(native){const url=new URL(native);assert.equal(process.env.HISAB_SQL_TEST_MODE,'isolated');assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/hisab_contract_test');
    const {Pool}=await import('pg');const pg=new Pool({connectionString:native,max:8});sql=await pg.connect();pool=pg;close=async()=>{sql.release();await pg.end();};
  }else{const {PGlite}=await import('@electric-sql/pglite');sql=new PGlite();pool={connect:async()=>({query:(text,values)=>sql.query(text,values),release:()=>{}})};close=()=>sql.close();}
  const exec=(text:string)=>native?sql.query(text):sql.exec(text);
  t.after(async()=>{await exec('DROP SCHEMA IF EXISTS hisab_access CASCADE; DROP OWNED BY hisab_access_preview; DROP ROLE hisab_access_preview');await close();});
  await exec('DROP SCHEMA IF EXISTS hisab_access CASCADE');await exec(await readFile(new URL('../../server/access/migrations/001-access.sql',import.meta.url),'utf8'));
  const store=new PostgresAccessStore(pool,owner,new ProviderKeyVault(master)),admin=customer(owner),a=customer(alice),b=customer(bob);
  await exec('SET ROLE hisab_access_preview');await sql.query('INSERT INTO hisab_access.customers(customer_id) VALUES($1)',[bob]);await exec('RESET ROLE');
  assert.equal((await store.status(a)).active,false);assert.equal((await store.status(admin)).isAdmin,true);
  await assert.rejects(()=>store.requireActive(a),/AI_SUBSCRIPTION_REQUIRED/);
  await assert.rejects(()=>store.issue(a,randomUUID(),30),/ACCESS_ADMIN_REQUIRED/);
  const issueId=randomUUID(),issued=await store.issue(admin,issueId,30);assert.match(issued.code,/^[A-F0-9]{32}$/);
  await assert.rejects(()=>store.issue(admin,issueId,30),/ACCESS_CODE_ALREADY_ISSUED/);
  await assert.rejects(()=>store.issue(admin,issueId,31),/ACCESS_REQUEST_CONFLICT/);
  const redeemId=randomUUID(),active=await store.redeem(a,redeemId,issued.code);assert.equal(active.active,true);
  const same=await store.redeem(a,redeemId,issued.code);assert.equal(same.expiresAt,active.expiresAt);
  assert.equal((await store.redeem(a,randomUUID(),issued.code)).expiresAt,active.expiresAt);
  await assert.rejects(()=>store.redeem(b,randomUUID(),issued.code),/ACCESS_CODE_INVALID/);
  await assert.rejects(()=>store.redeem(b,redeemId,issued.code),/ACCESS_REQUEST_CONFLICT/);
  await store.requireActive(a);await store.manage(admin,randomUUID(),alice,'block');await assert.rejects(()=>store.requireActive(a),/AI_ACCESS_BLOCKED/);
  const blockedCode=await store.issue(admin,randomUUID(),7);await assert.rejects(()=>store.redeem(a,randomUUID(),blockedCode.code),/AI_ACCESS_BLOCKED/);
  assert.equal((await sql.query('SELECT claimed_by FROM hisab_access.codes WHERE issue_request IS NOT NULL AND days=7')).rows[0].claimed_by,null);
  await store.manage(admin,randomUUID(),alice,'unblock');await store.requireActive(a);
  await assert.rejects(()=>store.manage(admin,randomUUID(),owner,'block'),/ACCESS_OWNER_PROTECTED/);
  await sql.query("UPDATE hisab_access.customers SET expires_at=now()-interval '1 second' WHERE customer_id=$1",[alice]);await assert.rejects(()=>store.requireActive(a),/AI_SUBSCRIPTION_REQUIRED/);
  const expired=await store.issue(admin,randomUUID(),1);await sql.query("UPDATE hisab_access.codes SET claim_before=now()-interval '1 second' WHERE issue_request=$1",[(await sql.query('SELECT issue_request FROM hisab_access.codes WHERE days=1')).rows[0].issue_request]);await assert.rejects(()=>store.redeem(b,randomUUID(),expired.code),/ACCESS_CODE_INVALID/);
  const vaultId=randomUUID();await store.configureProvider(admin,vaultId,'auto',secret,0);assert.equal((await store.providerConfiguration()).apiKey,secret);
  const publicStatus=await store.providerStatus(admin);assert.equal(publicStatus.revision,1);assert.ok(!JSON.stringify(publicStatus).includes(secret));
  await assert.rejects(()=>store.providerStatus(a),/ACCESS_ADMIN_REQUIRED/);await assert.rejects(()=>store.configureProvider(a,randomUUID(),'auto',secret,1),/ACCESS_ADMIN_REQUIRED/);
  await assert.rejects(()=>store.configureProvider(admin,randomUUID(),'auto',secret,0),/ACCESS_REVISION_CONFLICT/);
  await store.configureProvider(admin,vaultId,'auto',secret,0);assert.equal((await store.providerStatus(admin)).revision,1);
  await store.configureProvider(admin,randomUUID(),'auto',secret+'-replacement',1);assert.equal((await store.providerConfiguration()).apiKey,secret+'-replacement');
  await store.disableProvider(admin,randomUUID());await assert.rejects(()=>store.providerConfiguration(),/AI_NOT_CONFIGURED/);
  const revision=(await store.providerStatus(admin)).revision;await store.configureProvider(admin,randomUUID(),'auto',secret,revision);assert.equal((await store.providerConfiguration()).apiKey,secret);
  for(const table of ['codes','providers','commands','audit']){const data=JSON.stringify((await sql.query('SELECT * FROM hisab_access.'+table)).rows);assert.ok(!data.includes(secret));assert.ok(!data.includes(issued.code));}
  const role='hisab_access_test_reader';await exec(`CREATE ROLE ${role}; GRANT USAGE ON SCHEMA hisab_access TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA hisab_access TO ${role}; SET ROLE ${role}`);
  assert.equal((await sql.query('SELECT * FROM hisab_access.customers')).rows.length,0,'RLS denies a role even when SELECT is accidentally granted');await exec(`RESET ROLE; DROP OWNED BY ${role}; DROP ROLE ${role}`);
  await store.checkRate(b);
  // Seed an exhausted server minute rather than relying on 61 HTTP/SQL calls
  // finishing before a real clock minute rolls over on a slow CI runner.
  let checkedLimit=false;
  for(let attempt=0;attempt<3&&!checkedLimit;attempt++){
    const window=(await sql.query("UPDATE hisab_access.throttles SET minute=date_trunc('minute',clock_timestamp()),hits=60 WHERE bucket=$1 RETURNING minute",[bob])).rows[0].minute;
    const failure=await store.checkRate(b).then(()=>null,error=>error);
    const after=(await sql.query("SELECT date_trunc('minute',clock_timestamp()) AS minute")).rows[0].minute;
    if(new Date(window).getTime()===new Date(after).getTime()){assert.match(failure?.message??'',/ACCESS_LIMIT_REACHED/);checkedLimit=true;}
  }
  assert.equal(checkedLimit,true);
  if(native){const race=await store.issue(admin,randomUUID(),14);const results=await Promise.allSettled([store.redeem(a,randomUUID(),race.code),store.redeem(b,randomUUID(),race.code)]);assert.equal(results.filter(value=>value.status==='fulfilled').length,1,'one concurrent claimant only');}
});

test('AI rejects expired/blocked service access before quota and generation; legacy configuration cannot bypass access mode',async t=>{
  let quota=0,generations=0,allowed=false;
  const ownerHash=customerServiceHash(alice),app=express();app.use('/api/ai',createAIRouter({enabled:true,allowedOrigins:new Set(['https://localhost']),verifyToken:async()=>{throw Error('legacy verifier must not run');},verifyCustomer:async()=>({owner:ownerHash,assertAccess:async()=>{if(!allowed)throw new AIServiceError('AI_SUBSCRIPTION_REQUIRED',403);}}),budget:{reserve:async()=>{quota++;}},provider:{provider:'gemini',extract:async input=>{generations++;return {provider:'gemini',sourceSha256:input.source==='receipt'?input.receipt.sha256:'',draft:validateEntryDraft({transactionType:'expense',amountDecimal:'120.00',currency:'BDT',merchant:null,transactionDate:null,transactionTime:null,transcript:null,note:'',warnings:[]})};}}}));
  const server=app.listen(0,'127.0.0.1');t.after(()=>{server.closeAllConnections();server.close();});await new Promise<void>(resolve=>server.once('listening',resolve));const port=(server.address() as any).port;
  const input={source:'receipt',consentToProcess:true,receipt:receiptFromBytes(Uint8Array.from([137,80,78,71,13,10,26,10,1]),'image/png','synthetic.png')};
  const post=()=>fetch(`http://127.0.0.1:${port}/api/ai/extract`,{method:'POST',headers:{Authorization:'Bearer test',Origin:'https://localhost','Content-Type':'application/json'},body:JSON.stringify({ownerHash,requestId:randomUUID(),input})});
  assert.equal((await post()).status,403);assert.equal(quota,0);assert.equal(generations,0);allowed=true;assert.equal((await post()).status,200);assert.equal(generations,1);
  assert.equal(aiOptionsFromEnvironment({AI_ENABLED:'true',ACCESS_ENABLED:'true',AI_AUTH_MODE:'google',GOOGLE_OAUTH_CLIENT_IDS:'client',AI_ALLOWED_ORIGINS:'https://localhost',GEMINI_API_KEY:secret}).enabled,false);
  assert.equal(accessOptionsFromEnvironment({ACCESS_ENABLED:'true',VERCEL_ENV:'production'}).enabled,false);
});

test('access HTTP strips raw errors, rejects injected fields/origin and never exposes provider key',async t=>{
  const app=express();let checked=0;app.use('/api/access',createAccessRouter({enabled:true,allowedOrigins:new Set(['https://localhost']),verify:async token=>{if(token!=='test')throw new AccessError('ACCESS_SIGN_IN_REQUIRED',401);return customer(alice);},store:{checkRate:async()=>{},status:async()=>({active:false}),providerStatus:async()=>{checked++;throw new AccessError('ACCESS_ADMIN_REQUIRED',403);},configureProvider:async()=>{throw Error('SYNTHETIC_PRIVATE_ERROR');}} as any}));
  const server=app.listen(0,'127.0.0.1');t.after(()=>{server.closeAllConnections();server.close();});await new Promise<void>(resolve=>server.once('listening',resolve));const endpoint=`http://127.0.0.1:${(server.address() as any).port}/api/access`;
  const post=(body:unknown,origin='https://localhost')=>fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer test',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({action:'status'})).status,200);assert.equal((await post({action:'status',isAdmin:true})).status,400);assert.equal((await post({action:'status'},'https://foreign.invalid')).status,403);
  assert.equal((await post({action:'providerStatus'})).status,403);assert.equal(checked,1);
  const reply=await post({action:'configureProvider',requestId:randomUUID(),model:'auto',apiKey:secret,expectedRevision:0});assert.equal(reply.status,503);assert.equal(await reply.text(),'{"error":"ACCESS_UNAVAILABLE"}');
});

test('in-flight service handles die on sign-out, including re-login with the same linked customer',async()=>{
  const account={customerId:alice,email:'one@example.invalid',phone:null,googleIdentities:[]};let release!:(value:{customerId:string;token:string})=>void,current:typeof account|null=account;
  const runtime:AccountSettingsRuntime={read:async()=>current,changes:()=>({readPendingChange:async()=>null} as any),signIn:async()=>{},openLink:async()=>{},close:async()=>{},signOut:async()=>{current=null;return {serverRevoked:true};},serviceAuthorization:()=>new Promise(resolve=>{release=resolve;})};
  const session=new AccountSettingsSession({create:async()=>runtime,online:()=>true,contactChangesEnabled:false});await session.start();
  const old=customerRequestIdentity(session,alice),pending=old.getValidAccessToken();await session.signOut();release({customerId:alice,token:'synthetic-jwt'});await assert.rejects(()=>pending,/CUSTOMER_SIGN_IN_REQUIRED/);assert.equal(old.getProfile(),null);
  current=account;await session.start();assert.equal(old.getProfile(),null);assert.equal(customerRequestIdentity(session,alice).getProfile()?.subjectHash,customerServiceHash(alice));
  let ownerNow=customerServiceHash(alice);const identity={isTestMode:()=>false,getProfile:()=>ownerNow?{subjectHash:ownerNow}:null,getValidAccessToken:async()=>'synthetic-jwt'};
  await assert.rejects(()=>accessRequest(identity,'https://example.invalid/api/access',{action:'status'},undefined,async()=>{ownerNow='';return Response.json({isAdmin:true});}),/ACCESS_ACCOUNT_CHANGED/);
});
