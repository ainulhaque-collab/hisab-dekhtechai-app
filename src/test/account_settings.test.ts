import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AccountSettingsSession,type AccountSettingsRuntime} from '../auth/cloud/accountSettingsSession';
import type {CustomerAccount,CustomerAccountChanges,PendingCustomerChange} from '../contracts/customerAccount';
import AccountSettingsPanel from '../components/AccountSettingsPanel';
import AccountMenuProfile from '../components/AccountMenuProfile';
import {registerAccountSignOutCleanup,signOutAccountSessions,clearLegacyAccountSession} from '../auth/cloud/accountSignOut';
import {accountSettingsError} from '../components/accountSettingsText';
import {captureAccountCallback,hasAccountCallback,takeAccountCallback} from '../auth/cloud/callbackLocation';

const owner='11111111-1111-4111-8111-111111111111';
const account:CustomerAccount={customerId:owner,email:'original@example.invalid',phone:null,googleIdentities:[{identityId:'22222222-2222-4222-8222-222222222222',email:'original@example.invalid'}]};
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}
function fixture(enabled=true,initial:CustomerAccount|null=account){
  let current=initial,pending:PendingCustomerChange|null=null,online=true,callback:(error?:unknown)=>void=()=>{},hold:ReturnType<typeof gate>|null=null,initError:unknown=null;
  let logoutHold:ReturnType<typeof gate>|null=null,logoutError:unknown=null;
  const calls={creates:0,reads:0,updates:0,links:0,opens:0,signOuts:0,closes:0,signIns:[] as (string|null)[],changedOwners:[] as string[]};
  const manager=(id:string):CustomerAccountChanges=>({
    readAccount:async()=>{assert.equal(id,current?.customerId);return current!;},readPendingChange:async()=>pending,
    requestEmailChange:async email=>{calls.updates++;calls.changedOwners.push(id);if(hold)await hold.promise;pending={kind:'email',target:email,expired:false};return{status:'pending_verification',account:current??account};},
    checkEmailChange:async()=>{current={...account,email:pending!.target!};pending=null;return{status:'verified',account:current};},
    requestPhoneChange:async()=>{throw Error('PHONE_MUST_REMAIN_DISABLED');},confirmPhoneChange:async()=>{throw Error('PHONE_MUST_REMAIN_DISABLED');},
    beginGoogleLink:async()=>{calls.links++;if(hold)await hold.promise;pending={kind:'google',target:null,expired:false};return'https://accounts.google.com/o/oauth2/v2/auth';},
    completeGoogleLink:async()=>({status:'verified',account:current!}),removeGoogleIdentity:async()=>current!,cancelPendingChange:async()=>{pending=null;},
  });
  const runtime:AccountSettingsRuntime={read:async()=>{calls.reads++;return current;},changes:manager,signIn:async id=>{calls.signIns.push(id);},
    openLink:async()=>{calls.opens++;},signOut:async()=>{calls.signOuts++;if(logoutHold)await logoutHold.promise;current=null;pending=null;if(logoutError)throw logoutError;return{serverRevoked:true};},close:async()=>{calls.closes++;}};
  const session=new AccountSettingsSession({online:()=>online,contactChangesEnabled:enabled,create:async receive=>{calls.creates++;callback=receive;if(initError)receive(initError);return runtime;}});
  return{session,calls,setOnline:(value:boolean)=>{online=value;},setPending:(value:PendingCustomerChange)=>{pending=value;},setAccount:(value:CustomerAccount|null)=>{current=value;},
    callback:(error?:unknown)=>callback(error),hold:()=>{hold=gate();return hold;},setInitError:(error:unknown)=>{initError=error;},
    holdSignOut:()=>{logoutHold=gate();return logoutHold;},failSignOut:(error:unknown)=>{logoutError=error;}};
}

test('account startup is shared and offline reads retain display data without verifying or changing it',async()=>{
  const f=fixture(),first=f.session.start();assert.equal(first,f.session.start());await first;assert.equal(f.calls.creates,1);
  assert.equal(f.session.getSnapshot().account?.customerId,owner);const reads=f.calls.reads;
  f.setOnline(false);await f.session.refresh();assert.equal(f.session.getSnapshot().phase,'offline');assert.equal(f.calls.reads,reads);
  assert.equal(f.session.getSnapshot().account?.customerId,owner);await f.session.changeEmail('new@example.invalid');assert.equal(f.calls.updates,0);
});

test('only one email request runs, then pending and confirmed states use the same customer',async()=>{
  const f=fixture();await f.session.start();const hold=f.hold(),first=f.session.changeEmail('new@example.invalid');
  assert.equal(first,f.session.changeEmail('duplicate@example.invalid'));hold.release();await first;
  assert.equal(f.calls.updates,1);assert.deepEqual(f.calls.changedOwners,[owner]);assert.equal(f.session.getSnapshot().pending?.target,'new@example.invalid');
  await f.session.checkEmail();assert.equal(f.session.getSnapshot().account?.customerId,owner);assert.equal(f.session.getSnapshot().notice,'verified');
});

test('contact changes are gated while ordinary Google login remains available and SMS stays off',async()=>{
  const f=fixture(false,null);await f.session.start();await f.session.signIn();assert.deepEqual(f.calls.signIns,[null]);
  await f.session.changeEmail('new@example.invalid');await f.session.linkGoogle();assert.equal(f.calls.updates,0);assert.equal(f.calls.links,0);
  assert.equal(f.session.phoneEnabled,false);assert.equal(f.session.getSnapshot().error,'ACCOUNT_CHANGES_NOT_ENABLED');
});

test('a logout fences a late contact response and callback without replacing the signed-out account',async()=>{
  const f=fixture();await f.session.start();const held=f.hold(),request=f.session.changeEmail('late@example.invalid');
  await new Promise(resolve=>setTimeout(resolve,0));await f.session.signOut();held.release();await request;f.callback();
  assert.equal(f.session.getSnapshot().phase,'signed_out');assert.equal(f.session.getSnapshot().account,null);assert.notEqual(f.session.getSnapshot().notice,'email_requested');
  assert.equal(f.calls.closes,1);
});

test('late linking cannot open a browser after logout',async()=>{
  const f=fixture();await f.session.start();const held=f.hold(),link=f.session.linkGoogle();await new Promise(resolve=>setTimeout(resolve,0));
  await f.session.signOut();held.release();await link;assert.equal(f.calls.opens,0);
});

test('logout immediately hides identity in the menu and account panel, including offline and concurrent refresh',async()=>{
  const f=fixture();await f.session.start();
  const menu=()=>renderToStaticMarkup(React.createElement(AccountMenuProfile,{en:true,session:f.session}));
  assert.match(menu(),/Primary email/);assert.match(menu(),/original@example.invalid/);
  f.setOnline(false);await f.session.refresh();assert.match(menu(),/last verified/);
  const held=f.holdSignOut(),logout=f.session.signOut();
  assert.equal(f.session.getSnapshot().account,null);
  assert.equal(f.session.refresh(),logout);
  assert.doesNotMatch(menu(),/original@example.invalid|<img|Primary email/);
  const panel=renderToStaticMarkup(React.createElement(AccountSettingsPanel,{en:true,session:f.session}));
  assert.doesNotMatch(panel,/original@example.invalid|Primary verified email/);
  held.release();await logout;f.callback();
  assert.match(menu(),/Signed out/);assert.doesNotMatch(menu(),/original@example.invalid/);
  assert.equal(f.calls.signOuts,1);
});

test('failed logout stays anonymous and reports a fixed error instead of restoring the old identity',async()=>{
  const f=fixture();await f.session.start();f.failSignOut(Error('CLOUD_LOCAL_SIGN_OUT_FAILED'));await f.session.signOut();
  assert.equal(f.session.getSnapshot().phase,'error');assert.equal(f.session.getSnapshot().account,null);
  const html=renderToStaticMarkup(React.createElement(AccountMenuProfile,{en:false,session:f.session}));
  assert.doesNotMatch(html,/original@example.invalid|<img/);assert.match(html,/সংযোগ যাচাই/);
});

test('cloud and legacy credential cleanup are both attempted, and a missing local cleanup cannot report success',async()=>{
  const calls:string[]=[];
  let detach=registerAccountSignOutCleanup(async()=>{calls.push('legacy');});
  await assert.rejects(signOutAccountSessions(async()=>{calls.push('cloud');throw Error('CLOUD_STORAGE_UNAVAILABLE');}),/CLOUD_STORAGE_UNAVAILABLE/);
  assert.deepEqual(calls.sort(),['cloud','legacy']);detach();calls.length=0;
  detach=registerAccountSignOutCleanup(async()=>{calls.push('legacy');throw Error('private synthetic error');});
  await assert.rejects(signOutAccountSessions(async()=>{calls.push('cloud');return{serverRevoked:true};}),/CLOUD_LOCAL_SIGN_OUT_FAILED/);
  assert.deepEqual(calls.sort(),['cloud','legacy']);detach();
  await assert.rejects(clearLegacyAccountSession(),/CLOUD_LOCAL_SIGN_OUT_FAILED/);
  const old=registerAccountSignOutCleanup(async()=>{throw Error('stale callback');});
  detach=registerAccountSignOutCleanup(async()=>{});old();
  assert.deepEqual(await signOutAccountSessions(async()=>({serverRevoked:false})),{serverRevoked:false});detach();
});

test('callback errors during initialization remain visible rather than becoming a successful empty read',async()=>{
  const f=fixture(true,null);f.setInitError(Error('CLOUD_CALLBACK_INVALID'));await f.session.start();
  assert.equal(f.session.getSnapshot().phase,'error');assert.equal(f.session.getSnapshot().error,'CLOUD_CALLBACK_INVALID');
});

test('reauthentication pins the original customer UUID and an expired pending change can be cleared',async()=>{
  const f=fixture();await f.session.start();f.setPending({kind:'email',target:'new@example.invalid',expired:true});await f.session.refresh();
  assert.equal(f.session.getSnapshot().pending?.expired,true);await f.session.cancelChange();assert.equal(f.session.getSnapshot().pending,null);
  await f.session.reauthenticate();assert.deepEqual(f.calls.signIns,[owner]);assert.equal(f.session.getSnapshot().phase,'opening');
});

test('account UI shows confirmed/pending data, honest disabled SMS, and no tokens or owner IDs',async()=>{
  const f=fixture(false);await f.session.start();const html=renderToStaticMarkup(React.createElement(AccountSettingsPanel,{en:false,session:f.session}));
  assert.match(html,/মূল যাচাইকৃত ইমেইল/);assert.match(html,/original@example.invalid/);assert.match(html,/মোবাইল OTP এখনো চালু হয়নি/);
  assert.doesNotMatch(html,/সরিয়ে দিন|নতুন ইমেইল|access_token|refresh_token|code_verifier|11111111/);
  const p=fixture();p.setPending({kind:'email',target:'pending@example.invalid',expired:false});await p.session.start();
  const pending=renderToStaticMarkup(React.createElement(AccountSettingsPanel,{en:true,session:p.session}));assert.match(pending,/Verification pending/);assert.match(pending,/pending@example.invalid/);
});

test('account errors use fixed translated text and never render raw server messages',()=>{
  assert.doesNotMatch(accountSettingsError('server leaked token=synthetic',true),/token=synthetic/);
  assert.match(accountSettingsError('CUSTOMER_PRIMARY_EMAIL_CHANGE_REQUIRED',false),/মূল ইমেইল/);
});

test('callback code is removed from browser history before rendering and consumed once',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  const changes:string[]=[];
  const location={pathname:'/',href:'https://example.invalid/'};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location,history:{replaceState:(_state:unknown,_title:string,path:string)=>{changes.push(path);}}}});
  try{
    assert.equal(captureAccountCallback(),false);assert.equal(hasAccountCallback(),false);assert.equal(takeAccountCallback(),null);
    location.pathname='/auth/callback';location.href='https://example.invalid/auth/callback?code=synthetic-code';
    assert.equal(captureAccountCallback(),true);assert.deepEqual(changes,['/']);assert.equal(hasAccountCallback(),true);
    assert.equal(takeAccountCallback(),location.href);assert.equal(takeAccountCallback(),null);
  }finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
