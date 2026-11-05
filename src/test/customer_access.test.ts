import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
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
import { extractEntry } from '../ai/client';
import { accessDatabaseConfig } from '../../server/access/database';
import { SUPABASE_DATABASE_CA } from '../../server/access/supabaseCA';
import { emailBatch,parseEmailBatch } from '../access/admin';

const owner='11111111-1111-4111-8111-111111111111',alice='22222222-2222-4222-8222-222222222222',bob='33333333-3333-4333-8333-333333333333';
const customer=(id:string):ServiceCustomer=>({customerId:id,ownerHash:customerServiceHash(id)});
const master='ad'.repeat(32),secret='synthetic-provider-key-never-real-123456789';
const native=process.env.HISAB_TEST_PG_URL;

test('bulk email input is bounded and never guesses Gmail aliases or customer identity',()=>{
  assert.deepEqual(parseEmailBatch(' A.Name+one@gmail.com, a.name@gmail.com\nA.NAME+one@gmail.com '),['a.name+one@gmail.com','a.name@gmail.com']);
  for(const input of [[],['not-an-email'],Array(51).fill('one@example.invalid'),['x'.repeat(6001)]])assert.throws(()=>emailBatch(input),/ACCESS_EMAILS_INVALID/);
});
test('only freshly verified Google identity emails can locate a pending permission',async()=>{
  const user={id:alice,email:'primary@example.invalid',email_confirmed_at:'2026-11-05T00:00:00Z',user_metadata:{email:'injected@example.invalid'},identities:[
    {user_id:alice,identity_id:randomUUID(),provider:'google',identity_data:{email:'VALID@example.invalid',email_verified:true}},
    {user_id:alice,identity_id:randomUUID(),provider:'google',identity_data:{email:'unverified@example.invalid',email_verified:false}},
    {user_id:bob,identity_id:randomUUID(),provider:'google',identity_data:{email:'foreign@example.invalid',email_verified:true}}
  ]};
  const verify=serviceCustomerVerifier('https://tenant.example.invalid','public',async()=>Response.json(user));
  assert.deepEqual((await verify('header.payload.signature')).verifiedEmails,['valid@example.invalid']);
});

test('protected same-origin Preview reaches verified app auth instead of an HTML hosting login',async()=>{
  const hash=customerServiceHash(alice),identity={isTestMode:()=>false,getProfile:()=>({subjectHash:hash}),getValidAccessToken:async()=>'synthetic-jwt'};
  const protectedFetch:typeof fetch=async(url,init)=>{
    // Emulate the hosting gate that precedes the application router. Cookie
    // inclusion alone does not confer Admin or subscription authority.
    if(init?.credentials!=='same-origin')return new Response('<html>Hosting login</html>',{status:401,headers:{'Content-Type':'text/html'}});
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer synthetic-jwt');
    assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
    return String(url).endsWith('/access')?Response.json({active:false,isAdmin:false}):Response.json({error:'AI_SUBSCRIPTION_REQUIRED'},{status:403});
  };
  assert.deepEqual(await accessRequest(identity,'https://preview.example.invalid/api/access',{action:'status'},undefined,protectedFetch),{active:false,isAdmin:false});
  await assert.rejects(()=>extractEntry({source:'receipt',consentToProcess:true,receipt:receiptFromBytes(Uint8Array.from([137,80,78,71,13,10,26,10,1]),'image/png','synthetic.png')},hash,identity,{endpoint:'https://preview.example.invalid/api/ai/extract',fetchFn:protectedFetch}),/AI_SUBSCRIPTION_REQUIRED/);
});

test('Supabase connection verifies the official CA and hostname without changing other PostgreSQL trust',async()=>{
  const certificate=new X509Certificate(SUPABASE_DATABASE_CA);
  assert.equal(certificate.ca,true);assert.equal(certificate.fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  assert.equal((await readFile(new URL('../../config/certificates/supabase-prod-ca-2021.crt',import.meta.url),'utf8')).replace(/\r\n/g,'\n'),SUPABASE_DATABASE_CA.replace(/\r\n/g,'\n'));
  const config=accessDatabaseConfig('postgresql://synthetic:synthetic@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full');
  const tls=config.ssl as {rejectUnauthorized:boolean;ca:string;servername:string};assert.equal(tls.rejectUnauthorized,true);assert.equal(tls.ca,SUPABASE_DATABASE_CA);assert.equal(tls.servername,'aws-0-ap-southeast-1.pooler.supabase.com');
  assert.deepEqual(accessDatabaseConfig('postgresql://synthetic:synthetic@postgres.example.invalid/app').ssl,{rejectUnauthorized:true});
  assert.throws(()=>accessDatabaseConfig('postgresql://synthetic:synthetic@postgres.example.invalid/app?sslmode=disable'));
});

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
  await exec(await readFile(new URL('../../server/access/migrations/002-preview-login-provisioner.sql',import.meta.url),'utf8'));
  await exec(await readFile(new URL('../../server/access/migrations/003-encrypted-preview-bootstrap.sql',import.meta.url),'utf8'));
  await exec(await readFile(new URL('../../server/access/migrations/004-ciphertext-only-bootstrap.sql',import.meta.url),'utf8'));
  await exec(await readFile(new URL('../../server/access/migrations/006-admin-directory.sql',import.meta.url),'utf8'));
  const store=new PostgresAccessStore(pool,owner,new ProviderKeyVault(master)),admin=customer(owner),a=customer(alice),b=customer(bob);
  await exec('SET ROLE hisab_access_preview');await sql.query('INSERT INTO hisab_access.customers(customer_id) VALUES($1)',[bob]);await exec('RESET ROLE');
  await exec('SET ROLE hisab_access_preview');await assert.rejects(()=>sql.query("SELECT hisab_access.provision_encrypted_preview('not-a-key')"),/permission denied/);await exec('RESET ROLE');
  await exec(await readFile(new URL('../../server/access/migrations/005-retire-preview-bootstrap.sql',import.meta.url),'utf8'));
  assert.equal((await sql.query("SELECT to_regprocedure('hisab_access.provision_encrypted_preview(text)') IS NULL AS retired")).rows[0].retired,true);
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
  const aliceEmails=['alice@example.invalid','alice.second@example.invalid'],bobEmail='bob@example.invalid',batch=randomUUID();
  await assert.rejects(()=>store.directory.grant(a,batch,aliceEmails,7),/ACCESS_ADMIN_REQUIRED/);
  await assert.rejects(()=>store.directory.list(a,'',null,'all'),/ACCESS_ADMIN_REQUIRED/);
  await store.directory.grant(admin,batch,[...aliceEmails,bobEmail],7);await store.directory.grant(admin,batch,[bobEmail,...aliceEmails],7);
  await assert.rejects(()=>store.directory.grant(admin,batch,aliceEmails,8),/ACCESS_REQUEST_CONFLICT/);
  assert.equal((await store.directory.list(admin,'',null,'all')).counts.pending,3);assert.equal((await store.status(a)).active,false,'email alone cannot grant before verified sign-in');
  const verifiedAlice={...a,verifiedEmails:aliceEmails};
  if(native)await Promise.all([store.directory.observe({...a,verifiedEmails:[aliceEmails[0]]}),store.directory.observe({...a,verifiedEmails:[aliceEmails[1]]})]);else await store.directory.observe(verifiedAlice);
  const claimedExpiry=(await store.status(a)).expiresAt;
  assert.equal(Number((await sql.query('SELECT count(*) FROM hisab_access.email_grant_claims WHERE request_id=$1',[batch])).rows[0].count),1);
  await store.directory.observe(verifiedAlice);assert.equal((await store.status(a)).expiresAt,claimedExpiry,'linked emails and retries add duration once per customer/batch');
  await store.directory.manage(admin,randomUUID(),[bob],'block');await store.directory.observe({...b,verifiedEmails:[bobEmail]});assert.equal((await store.status(b)).active,false);
  assert.equal((await store.directory.list(admin,'bob',null,'all')).pending.length,1,'pending email cannot bypass a block');
  const cancellation=randomUUID();await store.directory.cancel(admin,cancellation,batch,bobEmail);await store.directory.cancel(admin,cancellation,batch,bobEmail);
  await store.directory.manage(admin,randomUUID(),[bob],'unblock');await store.directory.observe({...b,verifiedEmails:[bobEmail]});assert.equal((await store.status(b)).active,false,'cancelled invitations cannot be claimed');
  await assert.rejects(()=>store.directory.manage(admin,randomUUID(),[alice,owner],'block'),/ACCESS_OWNER_PROTECTED/);assert.equal((await store.status(a)).blocked,false,'invalid batch is atomic');
  await assert.rejects(()=>store.directory.manage(admin,randomUUID(),[alice,randomUUID()],'block'),/ACCESS_CUSTOMER_NOT_FOUND/);assert.equal((await store.status(a)).blocked,false);
  const listed=await store.directory.list(admin,'alice.second',null,'active');assert.equal(listed.customers.length,1);assert.deepEqual([...listed.customers[0].emails].sort(),[...aliceEmails].sort(),'verified contacts are identical across database collations');
  assert.equal((await store.directory.list(admin,"%' OR true --",null,'all')).customers.length,0);
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
  if(native){const race=await store.issue(admin,randomUUID(),14);const results=await Promise.allSettled([store.redeem(a,randomUUID(),race.code),store.redeem(b,randomUUID(),race.code)]);assert.equal(results.filter(value=>value.status==='fulfilled').length,1,'one concurrent claimant only');
    const container=process.env.HISAB_TEST_PG_CONTAINER;
    if(container){
      assert.match(container,/^[a-f0-9]{12,64}$/);
      const docker=(args:string[],input?:Buffer)=>{const result=spawnSync('docker',['exec',...(input?['-i']:[]),container,...args],{input,maxBuffer:8*1024*1024});assert.equal(result.status,0,'isolated synthetic PostgreSQL archive command must succeed');return result.stdout;};
      const snapshot=async(client:any)=>{const result:Record<string,unknown>={};for(const table of ['customers','codes','providers','audit','commands','throttles','customer_emails','email_grants','email_grant_claims','directory_events'])result[table]=(await client.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) AS digest FROM hisab_access.${table} t`)).rows[0].digest;return result;};
      const before=await snapshot(sql),archive=docker(['pg_dump','-U','postgres','-d','hisab_contract_test','--format=custom','--schema=hisab_access','--no-owner']);
      await sql.query('CREATE DATABASE hisab_access_restored_test');
      const targetUrl=new URL(native);targetUrl.pathname='/hisab_access_restored_test';const {Pool}=await import('pg');const restored=new Pool({connectionString:targetUrl.href,max:2});
      try{
        docker(['pg_restore','-U','postgres','-d','hisab_access_restored_test','--no-owner','--exit-on-error'],archive);
        assert.deepEqual(await snapshot(restored),before,'all access/vault/audit state survives private-schema dump/restore');
        const recovered=new PostgresAccessStore(restored,owner,new ProviderKeyVault(master));assert.equal((await recovered.providerConfiguration()).apiKey,secret);assert.deepEqual((await recovered.status(a)).expiresAt,(await store.status(a)).expiresAt);
        const client=await restored.connect();try{await client.query('SET ROLE hisab_access_preview');assert.equal((await client.query('SELECT customer_id FROM hisab_access.customers WHERE customer_id=$1',[alice])).rows.length,1);}finally{await client.query('RESET ROLE');client.release();}
      }finally{await restored.query('DROP SCHEMA hisab_access CASCADE; DROP OWNED BY hisab_access_preview');await restored.end();}
    }
  }
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
