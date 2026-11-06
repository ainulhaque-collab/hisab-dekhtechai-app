import React,{useEffect,useState,useSyncExternalStore} from 'react';
import {CheckCircle2,LoaderCircle,Mail,ShieldCheck,Smartphone,Trash2,LogOut,RefreshCw} from 'lucide-react';
import {accountSettingsSession} from '../auth/cloud/accountSettingsRuntime';
import type {AccountSettingsSession} from '../auth/cloud/accountSettingsSession';
import {fieldClass,primaryButton,secondaryButton} from './ModalShell';
import {accountSettingsError} from './accountSettingsText';
import {mobileUiEnabled} from '../appearance/mobileAppearance';

export default function AccountSettingsPanel({en,session=accountSettingsSession,onSignIn}:{en:boolean;session?:AccountSettingsSession;onSignIn?:()=>void}){
  const state=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot);
  const[email,setEmail]=useState(''),[editingEmail,setEditingEmail]=useState<string|null>(null),[removing,setRemoving]=useState<string|null>(null);
  useEffect(()=>{void session.start();},[session]);
  const account=state.account,pending=state.pending,busy=['loading','busy'].includes(state.phase),offline=state.phase==='offline';
  const canEdit=session.contactChangesEnabled&&!busy&&!offline&&!pending;
  const notices={email_requested:en?'Confirm the change in both email inboxes, then check verification here.':'বর্তমান ও নতুন ইমেইলের ইনবক্সে পরিবর্তন নিশ্চিত করুন। এরপর এখানে যাচাইয়ের অবস্থা দেখুন।',
    phone_requested:'',verified:en?'Sign-in details verified. Your account remains the same.':'লগইনের তথ্য যাচাই হয়েছে। অ্যাকাউন্ট একই আছে।',
    removed:en?'The selected Google sign-in was removed.':'নির্বাচিত Google লগইন সরানো হয়েছে।',cancelled:en?'The pending request was cleared on this device.':'এই ডিভাইসের অপেক্ষমাণ অনুরোধ বাতিল হয়েছে।',
    local_sign_out:en?'Signed out on this device. The server could not confirm revocation.':'এই ডিভাইসে সাইন আউট হয়েছে। সার্ভার থেকে সেশন বন্ধ হওয়ার নিশ্চয়তা পাওয়া যায়নি।'};
  return <div className="space-y-5 text-sm leading-relaxed">
    {mobileUiEnabled&&!account&&state.phase!=='loading'&&<section className="app-balance-card rounded-3xl border p-5 text-white"><ShieldCheck className="mb-4 h-9 w-9 text-emerald-300" aria-hidden="true"/><h3 className="text-xl font-bold">{en?'Your account, connected':'নিজের অ্যাকাউন্টে লগইন করুন'}</h3><p className="mt-3 text-sm leading-relaxed text-blue-100">{en?'Continue securely with Google. You can link another Google sign-in to this same account later.':'Google দিয়ে নিরাপদে লগইন করুন। পরে একই অ্যাকাউন্টে আরও একটি Google লগইন যুক্ত করতে পারবেন।'}</p></section>}
    {(!mobileUiEnabled||account)&&<div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
      <div className="flex items-center gap-2 font-semibold"><ShieldCheck aria-hidden="true" className="h-5 w-5 text-blue-700"/><span>{en?'One account, even when details change':'লগইন বদলালেও একই অ্যাকাউন্ট'}</span></div>
      <p className="mt-2 text-xs text-slate-600">{en?'Verified sign-ins belong to your permanent account. Your local records are kept when you sign out.':'যাচাইকৃত লগইন আপনার স্থায়ী অ্যাকাউন্টের অংশ। সাইন আউট করলেও স্থানীয় হিসাব থাকবে।'}</p>
    </div>}
    <p role="status" aria-live="polite" className="flex items-center gap-2 text-xs font-semibold text-slate-600">
      {busy?<LoaderCircle aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin"/>:state.phase==='connected'?<CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-700"/>:null}
      {busy?(en?'Checking account…':'অ্যাকাউন্ট যাচাই হচ্ছে…'):offline?(en?'Offline · last account details':'অফলাইন · আগের অ্যাকাউন্টের তথ্য'):state.phase==='error'&&account?(en?'Last verified account · check connection':'আগের যাচাইকৃত অ্যাকাউন্ট · সংযোগ যাচাই করুন'):state.phase==='opening'?(en?'Continue on the Google screen':'Google-এর পর্দায় লগইন শেষ করুন'):account?(en?'Account verified':'অ্যাকাউন্ট যাচাইকৃত'):(en?'Sign in to manage your account':'অ্যাকাউন্ট পরিচালনা করতে লগইন করুন')}
    </p>
    {state.error&&<div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs text-rose-800">{accountSettingsError(state.error,en)}</div>}
    {state.notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">{notices[state.notice]}</p>}
    {!account&&state.phase!=='opening'&&<button type="button" className={`${primaryButton} w-full`} disabled={busy||offline} onClick={()=>{onSignIn?.();if(state.phase==='error')void session.signOut().then(()=>session.signIn());else void session.signIn();}}>{en?'Continue with Google':'Google দিয়ে লগইন করুন'}</button>}
    {state.phase==='opening'&&<button type="button" className={`${secondaryButton} w-full`} onClick={()=>{void session.signOut();}}>{en?'Cancel sign-in':'লগইন বাতিল করুন'}</button>}
    {account&&<>
      <section className="rounded-2xl border border-slate-200 p-4">
        <h3 className="flex items-center gap-2 font-semibold"><Mail aria-hidden="true" className="h-4 w-4 text-blue-700"/>{en?'Primary verified email':'মূল যাচাইকৃত ইমেইল'}</h3>
        <p className="mt-2 break-all text-slate-700">{account.email??(en?'No verified email':'যাচাইকৃত ইমেইল নেই')}</p>
        {session.contactChangesEnabled&&editingEmail!==account.customerId&&<button type="button" disabled={!canEdit} className="mt-2 min-h-11 text-xs font-semibold text-blue-700 disabled:opacity-40" onClick={()=>{setEmail('');setEditingEmail(account.customerId);}}>{en?'Change email':'ইমেইল পরিবর্তন করুন'}</button>}
        {editingEmail===account.customerId&&<form className="mt-3 space-y-3" onSubmit={event=>{event.preventDefault();void session.changeEmail(email);}}>
          <label className="block text-xs font-medium" htmlFor="hisab-new-email">{en?'New email':'নতুন ইমেইল'}<input id="hisab-new-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} disabled={!canEdit} className={fieldClass}/></label>
          <div className="flex gap-2"><button type="submit" disabled={!canEdit} className={primaryButton}>{en?'Send confirmation':'যাচাইয়ের অনুরোধ পাঠান'}</button><button type="button" disabled={busy} className={secondaryButton} onClick={()=>setEditingEmail(null)}>{en?'Close':'বন্ধ করুন'}</button></div>
        </form>}
      </section>
      {pending&&<section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
        <h3 className="font-semibold">{pending.expired?(en?'Verification expired':'যাচাইয়ের সময় শেষ'):(en?'Verification pending':'যাচাই বাকি আছে')}</h3>{pending.target&&<p className="break-all">{pending.target}</p>}
        <p>{pending.kind==='email'?(en?'Confirm the change in your email inboxes. Your existing account remains in place.':'ইমেইলের ইনবক্স থেকে পরিবর্তন নিশ্চিত করুন। আপনার আগের অ্যাকাউন্ট একই আছে।'):(en?'Complete verification, or cancel to start again.':'যাচাই শেষ করুন, অথবা বাতিল করে আবার শুরু করুন।')}</p>
        <div className="flex flex-wrap gap-2">{pending.kind==='email'&&!pending.expired&&<button type="button" disabled={busy||offline} className={primaryButton} onClick={()=>{void session.checkEmail();}}>{en?'Check verification':'যাচাইয়ের অবস্থা দেখুন'}</button>}<button type="button" disabled={busy||offline} className={secondaryButton} onClick={()=>{void session.cancelChange();}}>{en?'Cancel request':'অনুরোধ বাতিল করুন'}</button></div>
      </section>}
      <section className="rounded-2xl border border-slate-200 p-4"><h3 className="font-semibold">{en?'Linked Google sign-ins':'যুক্ত Google লগইন'}</h3>
        <ul className="mt-2 divide-y divide-slate-100">{account.googleIdentities.map(identity=>{
          const remainingPrimary=account.email&&account.googleIdentities.some(other=>other.identityId!==identity.identityId&&other.email?.toLowerCase()===account.email?.toLowerCase());
          return <li key={identity.identityId} className="py-3"><div className="flex items-center gap-3"><p className="min-w-0 flex-1 break-all text-xs text-slate-700">{identity.email??(en?'Google account':'Google অ্যাকাউন্ট')}</p>
            {session.contactChangesEnabled&&remainingPrimary&&<button type="button" disabled={!canEdit} aria-label={en?'Remove this Google sign-in':'এই Google লগইন সরান'} className="min-h-11 min-w-11 rounded-lg p-2 text-rose-700 hover:bg-rose-50 disabled:opacity-40" onClick={()=>setRemoving(identity.identityId)}><Trash2 aria-hidden="true" className="mx-auto h-4 w-4"/></button>}</div>
            {removing===identity.identityId&&<div className="mt-2 space-y-2 rounded-xl bg-rose-50 p-3 text-xs"><p>{en?'Remove this sign-in? Your other verified Google sign-in and account remain.':'এই লগইনটি সরাবেন? অন্য যাচাইকৃত Google লগইন ও অ্যাকাউন্ট থাকবে।'}</p><div className="flex gap-2"><button type="button" disabled={!canEdit} className={secondaryButton} onClick={()=>{void session.removeGoogle(identity.identityId).then(()=>setRemoving(null));}}>{en?'Remove':'সরিয়ে দিন'}</button><button type="button" disabled={busy} className={secondaryButton} onClick={()=>setRemoving(null)}>{en?'Cancel':'বাতিল'}</button></div></div>}</li>;
        })}</ul>
        {session.contactChangesEnabled&&<><button type="button" disabled={!canEdit} className={`${secondaryButton} mt-2 w-full`} onClick={()=>{void session.linkGoogle();}}>{en?'Link another Google account':'আরেকটি Google অ্যাকাউন্ট যুক্ত করুন'}</button><p className="mt-3 text-xs text-slate-500">{en?'Confirm the replacement primary email before removing an old Gmail. Your last Google sign-in cannot be removed.':'পুরোনো Gmail সরানোর আগে নতুনটিকে মূল ইমেইল হিসেবে নিশ্চিত করুন। শেষ Google লগইন সরানো যাবে না।'}</p></>}
      </section>
      <section className="rounded-2xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold"><Smartphone aria-hidden="true" className="h-4 w-4 text-blue-700"/>{en?'Phone sign-in':'মোবাইল দিয়ে লগইন'}</h3>{account.phone&&<p className="mt-2 text-slate-700">{account.phone}</p>}<p className="mt-2 text-xs text-slate-500">{en?'Phone OTP is not enabled yet. You can use your verified Google sign-in.':'মোবাইল OTP এখনো চালু হয়নি। যাচাইকৃত Google লগইন ব্যবহার করতে পারবেন।'}</p></section>
      {!session.contactChangesEnabled&&<p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{en?'Changing sign-in details is being prepared. Your current Google sign-in remains available.':'লগইনের তথ্য পরিবর্তনের সুবিধাটি প্রস্তুত হচ্ছে। বর্তমান Google লগইন ব্যবহার করতে পারবেন।'}</p>}
      {state.error==='CUSTOMER_REAUTH_REQUIRED'&&<button type="button" disabled={busy||offline} className={`${primaryButton} w-full`} onClick={()=>{onSignIn?.();void session.reauthenticate();}}>{en?'Verify identity again':'আবার পরিচয় যাচাই করুন'}</button>}
    </>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={`${secondaryButton} flex-1`} onClick={()=>{void session.refresh();}}><RefreshCw aria-hidden="true" className="h-4 w-4"/>{en?'Check connection':'সংযোগ যাচাই'}</button>{account&&<button type="button" disabled={busy} className={`${secondaryButton} flex-1`} onClick={()=>{void session.signOut();}}><LogOut aria-hidden="true" className="h-4 w-4"/>{en?'Sign out':'সাইন আউট'}</button>}</div>
    <p className="text-xs text-slate-500">{en?'This login does not move existing local records to a different account. Financial sync migration is not enabled in this preview.':'এই লগইন আগের স্থানীয় হিসাব অন্য অ্যাকাউন্টে সরাবে না। এই প্রিভিউতে হিসাব স্থানান্তর এখনো চালু হয়নি।'}</p>
  </div>;
}
