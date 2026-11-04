import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,unlink,rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CloudAuth } from '../auth/cloud/cloudAuth';
import { cloudAuthConfig } from '../auth/cloud/config';
import { customerEmail,customerPhone,verifiedCustomer } from '../auth/customerIdentity';
import { LocalDatabase } from '../storage/db';
import { SyncTestSqliteDriver } from './helpers/syncSqliteDriver';
import { buildIncomeJournal,generateUUID } from '../domain/journal';
import { canonicalJson,computeSha256 } from '../sync/canonical';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const googleA='33333333-3333-4333-8333-333333333333',googleB='44444444-4444-4444-8444-444444444444';
const config=cloudAuthConfig({enabled:'true',projectUrl:'https://sfzitbasxrpmtmldujbm.supabase.co',publishableKey:'sb_publishable_synthetic',webOrigin:'https://hisab.example.invalid',android:false})!;
const callback=config.redirectTo+'?code=synthetic-code-12345';

/** Real pinned SDK, deterministic Auth HTTP fixture, and a TEST-ONLY secret-store double. */
function environment(){
  let now=Date.now(),challenge='',linking=false,nextId:string|null=null,pendingPhone:string|null=null,pendingEmail:string|null=null,phoneLogin:string|null=null,oldSignIn=false;
  let unavailable=false,wrongPhone=false,alreadyOwned=false,hold:Promise<void>|null=null,entered:(()=>void)|null=null;
  const storageMap=new Map<string,string>(),calls={updates:0,verifies:0,links:0,unlinks:0,tokens:0};
  const storage={getItem:async(key:string)=>storageMap.get(key)??null,setItem:async(key:string,value:string)=>{storageMap.set(key,value);},
    removeItem:async(key:string)=>{storageMap.delete(key);},clear:async()=>{storageMap.clear();}};
  const user:any={id:owner,email:'original@example.invalid',email_confirmed_at:new Date(now).toISOString(),phone:'8801712345678',phone_confirmed_at:new Date(now).toISOString(),
    aud:'authenticated',created_at:new Date(now).toISOString(),last_sign_in_at:new Date(now).toISOString(),app_metadata:{provider:'google'},user_metadata:{},
    identities:[{id:'synthetic-google-A',identity_id:googleA,user_id:owner,provider:'google',identity_data:{email:'original@example.invalid',email_verified:true}},
      {id:'synthetic-phone',identity_id:generateUUID(),user_id:owner,provider:'phone',identity_data:{}}]};
  const snapshot=()=>({...structuredClone(user),last_sign_in_at:oldSignIn?new Date(now-600001).toISOString():user.last_sign_in_at});
  const session=()=>({access_token:[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'synthetic'].join('.'),
    refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,user:snapshot()});
  const fetchFn:typeof fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url),method=init?.method??'GET';
    assert.equal(url.origin,config.projectUrl);
    if(url.pathname==='/auth/v1/token'){
      calls.tokens++;const body=JSON.parse(init!.body as string);
      if(url.searchParams.get('grant_type')==='pkce'){
        assert.equal(body.auth_code,'synthetic-code-12345');
        assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.code_verifier))).toString('base64url'),challenge);
        if(linking&&!user.identities.some((v:any)=>v.identity_id===googleB))user.identities.push({id:'synthetic-google-B',identity_id:googleB,user_id:owner,provider:'google',identity_data:{email:'replacement@example.invalid',email_verified:true}});
        if(nextId){user.id=nextId;user.identities=user.identities.map((v:any)=>({...v,user_id:nextId}));}linking=false;
      }else assert.equal(url.searchParams.get('grant_type'),'refresh_token');
      return Response.json(session());
    }
    if(url.pathname==='/auth/v1/user/identities/authorize'){
      calls.links++;if(alreadyOwned)return Response.json({code:'identity_already_exists',msg:'synthetic already-owned identity'},{status:422});
      assert.ok((init?.headers as Record<string,string>).Authorization);assert.equal(url.searchParams.get('provider'),'google');
      assert.equal(url.searchParams.get('redirect_to'),config.redirectTo);assert.equal(url.searchParams.get('code_challenge_method'),'s256');
      challenge=url.searchParams.get('code_challenge')!;linking=true;
      const oauth=new URL('https://accounts.google.com/o/oauth2/v2/auth');oauth.searchParams.set('redirect_uri',config.projectUrl+'/auth/v1/callback');
      oauth.searchParams.set('response_type','code');return Response.json({url:oauth.href});
    }
    if(url.pathname==='/auth/v1/user'&&method==='PUT'){
      calls.updates++;const body=JSON.parse(init!.body as string);
      if(body.email){if(alreadyOwned)return Response.json({code:'email_exists',msg:'synthetic already-owned email'},{status:422});pendingEmail=body.email;return Response.json({...snapshot(),new_email:pendingEmail});}
      assert.deepEqual(Object.keys(body).filter(k=>!k.startsWith('code_')),['phone']);
      pendingPhone=body.phone;entered?.();if(hold)await hold;
      return unavailable?Response.json({msg:'temporary',code:'unexpected_failure'},{status:400}):Response.json({...snapshot(),new_phone:pendingPhone});
    }
    if(url.pathname==='/auth/v1/otp'){
      const body=JSON.parse(init!.body as string);assert.equal(body.create_user,false,'phone login must not create or merge customers');phoneLogin=body.phone;return Response.json({});
    }
    if(url.pathname==='/auth/v1/verify'){
      calls.verifies++;const body=JSON.parse(init!.body as string);
      if(body.token!=='123456')return Response.json({msg:'synthetic invalid OTP',code:'otp_expired'},{status:403});
      if(body.type==='sms'){assert.equal(body.phone,phoneLogin);assert.equal(customerPhone(user.phone),phoneLogin);}
      else{assert.equal(body.type,'phone_change');assert.equal(body.phone,pendingPhone);user.phone=(wrongPhone?'+8801812345678':pendingPhone!).replace(/^\+/,'');user.phone_confirmed_at=new Date(now).toISOString();}
      if(nextId){user.id=nextId;user.identities=user.identities.map((v:any)=>({...v,user_id:nextId}));}
      return Response.json(session());
    }
    if(url.pathname.startsWith('/auth/v1/user/identities/')&&method==='DELETE'){
      calls.unlinks++;const id=url.pathname.split('/').at(-1);user.identities=user.identities.filter((v:any)=>v.identity_id!==id);return Response.json({});
    }
    if(url.pathname==='/auth/v1/user')return unavailable?Response.json({msg:'temporary'},{status:400}):Response.json(snapshot());
    if(url.pathname==='/auth/v1/logout')return new Response(null,{status:204});
    throw Error('UNEXPECTED_SYNTHETIC_AUTH_ENDPOINT');
  };
  const make=()=>CloudAuth.create(config,storage,{fetch:fetchFn,now:()=>now});
  const signIn=async(auth:CloudAuth)=>{const url=new URL(await auth.beginGoogleSignIn(owner));challenge=url.searchParams.get('code_challenge')!;await auth.handleCallback(callback);};
  return{make,signIn,storageMap,calls,user,snapshot,confirmEmail:()=>{assert.ok(pendingEmail);user.email=pendingEmail;user.email_confirmed_at=new Date(now).toISOString();},advance:()=>{now+=600001;},setOldSignIn:()=>{oldSignIn=true;},
    setUnavailable:(v:boolean)=>{unavailable=v;},setWrongPhone:()=>{wrongPhone=true;},setOtherOwner:()=>{nextId=other;},setAlreadyOwned:()=>{alreadyOwned=true;},
    holdUpdate:()=>{let release!:()=>void;hold=new Promise(r=>{release=r;});const reached=new Promise<void>(r=>{entered=r;});return{reached,release};}};
}

test('phone comparison normalizes Bangla/BD/E.164 without making it an ownership key',()=>{
  for(const value of ['01712345678','০১৭১২৩৪৫৬৭৮','+880 1712-345678','8801712345678'])assert.equal(customerPhone(value),'+8801712345678');
  for(const value of ['','01712','+8801212345678','0'.repeat(60),'abc','+000000000','+88017123456789'])assert.throws(()=>customerPhone(value),/CUSTOMER_PHONE_INVALID/);
  assert.equal(customerEmail(' Alice+Home@Example.invalid '),'alice+home@example.invalid');
  assert.notEqual(customerEmail('a.lice@gmail.com'),customerEmail('alice@gmail.com'));
  for(const value of ['bad','user@localhost','user\n@example.invalid','user@example.invalid\r\nBcc: someone'])assert.throws(()=>customerEmail(value));
});

test('only server-confirmed contacts/identities qualify; editable metadata never selects a customer',()=>{
  const h=environment(),u=h.snapshot();assert.equal(verifiedCustomer(u,owner,owner).customerId,owner);
  for(const patch of [{id:other},{is_anonymous:true},{identities:[],user_metadata:{email_verified:true,phone_verified:true}},
    {email_confirmed_at:null,phone_confirmed_at:null},{identities:u.identities.map((v:any)=>({...v,user_id:other}))}])
    assert.throws(()=>verifiedCustomer({...u,...patch},owner,owner));
  const phoneOnly={...u,email:undefined,email_confirmed_at:undefined,identities:u.identities.filter((v:any)=>v.provider==='phone')};
  assert.equal(verifiedCustomer(phoneOnly,owner,owner).phone,'+8801712345678');
});

test('verified phone change survives restart, wrong OTP retains the owner, and replay does not verify twice',async t=>{
  const h=environment(),auth=await h.make();await h.signIn(auth);t.after(()=>auth.signOut());
  const changes=auth.customerChanges(owner,{phoneChangeEnabled:true});
  assert.equal((await changes.requestPhoneChange('০১৯১২৩৪৫৬৭৮')).status,'pending_verification');
  assert.equal((await changes.readAccount()).phone,'+8801712345678');
  await assert.rejects(changes.confirmPhoneChange('000000'),/CUSTOMER_OTP_INVALID/);
  assert.equal((await changes.readAccount()).customerId,owner);
  const restarted=await h.make(),again=restarted.customerChanges(owner,{phoneChangeEnabled:true});t.after(()=>restarted.signOut());
  const done=await again.confirmPhoneChange('123456');assert.equal(done.status,'verified');assert.equal(done.account.phone,'+8801912345678');
  assert.deepEqual(await restarted.asSyncAuth(owner).getVerifiedIdentity(),{subject:owner,issuer:config.projectUrl+'/auth/v1'});
  const count=h.calls.verifies;await assert.rejects(again.confirmPhoneChange('123456'),/CUSTOMER_CHANGE_INVALID/);assert.equal(h.calls.verifies,count);
});

test('an OTP reply for another phone is not reported as a verified requested change',async t=>{
  const h=environment(),auth=await h.make();await h.signIn(auth);t.after(()=>auth.signOut());const changes=auth.customerChanges(owner,{phoneChangeEnabled:true});
  await changes.requestPhoneChange('01912345678');h.setWrongPhone();
  await assert.rejects(changes.confirmPhoneChange('123456'),/CUSTOMER_CHANGE_UNVERIFIED/);
  assert.equal((await changes.readAccount()).customerId,owner);
  assert.ok(h.storageMap.has(config.storageKey+'-account-change'));
});

test('Gmail replacement links with real SDK S256 PKCE, preserves UUID, then permits old Google removal',async t=>{
  const h=environment(),auth=await h.make();await h.signIn(auth);t.after(()=>auth.signOut());const changes=auth.customerChanges(owner);
  await assert.rejects(changes.removeGoogleIdentity(googleA),/CUSTOMER_LAST_SIGN_IN_METHOD/);
  assert.equal(h.calls.unlinks,0);assert.equal(new URL(await changes.beginGoogleLink()).origin,'https://accounts.google.com');
  const restarted=await h.make();t.after(()=>restarted.signOut());const next=restarted.customerChanges(owner);
  const done=await next.completeGoogleLink(callback);assert.equal(done.status,'verified');assert.equal(done.account.customerId,owner);
  assert.equal(done.account.googleIdentities.length,2);assert.equal(done.account.googleIdentities[1].email,'replacement@example.invalid');
  await assert.rejects(next.removeGoogleIdentity(googleA),/CUSTOMER_PRIMARY_EMAIL_CHANGE_REQUIRED/);
  await next.requestEmailChange('replacement@example.invalid');assert.equal((await next.checkEmailChange()).status,'pending_verification');
  h.confirmEmail();assert.equal((await next.checkEmailChange()).status,'verified');
  const after=await next.removeGoogleIdentity(googleA);assert.equal(after.customerId,owner);assert.deepEqual(after.googleIdentities.map(v=>v.identityId),[googleB]);
  await restarted.signOut();const signedBackIn=await h.make();t.after(()=>signedBackIn.signOut());await h.signIn(signedBackIn);
  assert.equal((await signedBackIn.getCustomerAccount(owner))?.customerId,owner);
  await assert.rejects(signedBackIn.customerChanges(owner).removeGoogleIdentity(googleB),/CUSTOMER_LAST_SIGN_IN_METHOD/);
});

test('confirmed primary-email change keeps the customer UUID and requires server confirmation after restart',async t=>{
  const h=environment(),auth=await h.make();await h.signIn(auth);t.after(()=>auth.signOut());
  const change=auth.customerChanges(owner);assert.equal((await change.requestEmailChange('new+recovery@example.invalid')).status,'pending_verification');
  assert.equal((await change.checkEmailChange()).status,'pending_verification');assert.equal((await change.readAccount()).email,'original@example.invalid');
  const restarted=await h.make();t.after(()=>restarted.signOut());h.confirmEmail();
  const result=await restarted.handleCustomerCallback(callback);assert.equal(result?.status,'verified');assert.equal(result?.account.customerId,owner);
  assert.equal((await restarted.asSyncAuth(owner).getVerifiedIdentity())?.subject,owner);
});

test('the existing callback entry point routes a Google link without signing out or adopting another owner',async t=>{
  const h=environment(),auth=await h.make();await h.signIn(auth);t.after(()=>auth.signOut());await auth.customerChanges(owner).beginGoogleLink();
  assert.equal((await auth.handleCallback(callback)).userId,owner);
  assert.equal((await auth.getCustomerAccount(owner))?.googleIdentities.length,2);
});

test('verified new number signs in to the same customer without auto-signup; wrong-owner OTP is fenced',async t=>{
  const h=environment(),auth=await h.make();await h.signIn(auth);const changes=auth.customerChanges(owner,{phoneChangeEnabled:true});
  await changes.requestPhoneChange('01912345678');await changes.confirmPhoneChange('123456');await auth.signOut();
  const phone=await h.make();t.after(()=>phone.signOut());await phone.beginPhoneSignIn('01912345678',owner,{phoneSignInEnabled:true});
  await assert.rejects(phone.completePhoneSignIn('000000'),/CUSTOMER_OTP_INVALID/);
  assert.equal((await phone.completePhoneSignIn('123456')).userId,owner);await phone.signOut();
  const wrong=await h.make();await wrong.beginPhoneSignIn('01912345678',owner,{phoneSignInEnabled:true});h.setOtherOwner();
  await assert.rejects(wrong.completePhoneSignIn('123456'),/CLOUD_ACCOUNT_MISMATCH/);assert.equal(h.storageMap.size,0);
});

test('expired session, missing SMS setup, double-taps and a different account cannot initiate a change',async t=>{
  const h=environment(),auth=await h.make();await h.signIn(auth);t.after(()=>auth.signOut());
  await assert.rejects(auth.customerChanges(owner).requestPhoneChange('01912345678'),/CUSTOMER_SMS_NOT_CONFIGURED/);
  await assert.rejects(auth.customerChanges(other,{phoneChangeEnabled:true}).requestPhoneChange('01912345678'),/CLOUD_ACCOUNT_MISMATCH/);
  assert.equal(await auth.asSyncAuth(other).getVerifiedIdentity(),null);
  assert.equal(h.calls.updates,0);h.setOldSignIn();await assert.rejects(auth.customerChanges(owner).beginGoogleLink(),/CUSTOMER_REAUTH_REQUIRED/);
});

test('already-owned Google/email identities cannot merge two customers by matching contact text',async t=>{
  const h=environment(),auth=await h.make();await h.signIn(auth);t.after(()=>auth.signOut());h.setAlreadyOwned();
  await assert.rejects(auth.customerChanges(owner).beginGoogleLink(),/CUSTOMER_LINK_UNAVAILABLE/);
  await assert.rejects(auth.customerChanges(owner).requestEmailChange('claimed@example.invalid'),/CUSTOMER_CHANGE_UNAVAILABLE/);
  assert.equal((await auth.getCustomerAccount(owner))?.customerId,owner);assert.equal(h.calls.unlinks,0);
});

test('wrong, expired and repeated Google callbacks cannot change the account',async t=>{
  const h=environment(),auth=await h.make();await h.signIn(auth);t.after(()=>auth.signOut());const changes=auth.customerChanges(owner);
  await changes.beginGoogleLink();const before=h.calls.tokens;
  await assert.rejects(changes.completeGoogleLink('https://attacker.example.invalid/auth/callback?code=synthetic-code-12345'),/CLOUD_CALLBACK_INVALID/);
  await assert.rejects(changes.completeGoogleLink(callback),/CUSTOMER_CHANGE_INVALID/);assert.equal(h.calls.tokens,before);
  await changes.beginGoogleLink();h.advance();await assert.rejects(changes.completeGoogleLink(callback),/CUSTOMER_CHANGE_EXPIRED/);
  await changes.cancelPendingChange();assert.equal((await changes.readAccount()).customerId,owner);
});

test('unexpected callback owner is signed out and never becomes the financial owner',async()=>{
  const h=environment(),auth=await h.make();await h.signIn(auth);const changes=auth.customerChanges(owner);await changes.beginGoogleLink();h.setOtherOwner();
  await assert.rejects(changes.completeGoogleLink(callback),/CLOUD_ACCOUNT_MISMATCH/);assert.equal(h.storageMap.size,0);
  await assert.rejects(auth.getCustomerAccount(owner),/CLOUD_SESSION_CLOSED/);
});

test('logout during a phone request cannot resurrect credentials or confirm a change',async()=>{
  const h=environment(),auth=await h.make();await h.signIn(auth);const changes=auth.customerChanges(owner,{phoneChangeEnabled:true}),gate=h.holdUpdate();
  const result=changes.requestPhoneChange('01912345678').then(()=>null,error=>error);await gate.reached;
  await assert.rejects(changes.requestPhoneChange('01812345678'),/CLOUD_AUTH_BUSY/);
  await auth.signOut();gate.release();assert.match((await result).message,/CLOUD_SESSION_CLOSED/);assert.equal(h.storageMap.size,0);
});

test('phone and Gmail changes leave the real SQLite ledger, owner and pending outbox byte-for-byte intact',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'hisab-owner-')),path=join(folder,'customer.sqlite'),driver=new SyncTestSqliteDriver(path),db=new LocalDatabase('identity-preservation',driver);
  let reopened:SyncTestSqliteDriver|undefined;
  t.after(async()=>{driver.close();reopened?.close();await unlink(path);await rmdir(folder);});
  await db.init();db.setIdentity(owner,'original@example.invalid');const ws=db.createWorkspace('Synthetic customer','personal'),cash=db.createAccount(ws.id,'Cash','cash'),cat=db.createCategory(ws.id,'Income','income');
  const operationId=generateUUID(),journal=buildIncomeJournal({workspaceId:ws.id,assetAccountId:cash.id,revenueCategoryId:cat.id,amountMinor:'12080',effectiveDate:'2026-11-04',opId:operationId});
  const payload={balancedJournal:journal};await db.commitJournalWithOutbox(journal,{protocolVersion:1,ownerHash:owner,deviceId:db.getDeviceId(),seq:db.getNextDeviceSeq(),operationId,
    entityId:journal.transaction.id,type:'journal.post',createdAtUtc:new Date().toISOString(),payload,contentSha256:await computeSha256(canonicalJson(payload))});
  const before=await driver.getItem('identity-preservation');assert.ok(before);
  const h=environment(),auth=await h.make();await h.signIn(auth);t.after(()=>auth.signOut());const changes=auth.customerChanges(owner,{phoneChangeEnabled:true});
  await changes.requestPhoneChange('01912345678');await changes.confirmPhoneChange('123456');await changes.beginGoogleLink();await changes.completeGoogleLink(callback);
  assert.equal(await driver.getItem('identity-preservation'),before);
  reopened=new SyncTestSqliteDriver(path);const loaded=new LocalDatabase('identity-preservation',reopened);await loaded.init();
  assert.equal(loaded.getIdentity()?.ownerSubjectHash,owner);assert.equal(loaded.getTransactions(ws.id).length,1);assert.equal(loaded.getPendingOutbox().length,4);
  assert.equal(loaded.calculateAccountSummaries(ws.id).find(v=>v.accountId===cash.id)?.currentBalanceMinor,'12080');
});
