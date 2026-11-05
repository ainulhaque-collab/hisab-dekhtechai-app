import React,{useState} from 'react';
import {Link2} from 'lucide-react';
import {useApp} from '../context/AppContext';
import {ModalShell,fieldClass,primaryButton} from './ModalShell';
import {AppSelect} from './AppSelect';
import {formatBDT} from '../domain/money';
import {linkMasterWallet,readWalletBook,walletSummaries} from '../storage/walletBook';
import {walletActor,walletError} from './walletText';

export function WalletLinkModal({onClose}:{onClose:()=>void}){
  const {db,language,currentWorkspace,refreshState,userProfile}=useApp(),en=language==='en',actorHash=walletActor(userProfile);
  const [code,setCode]=useState(''),[existing,setExisting]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if(actorHash!==undefined&&actorHash!==(db.getIdentity()?.ownerSubjectHash||'local-owner'))return <ModalShell title={en?'Link a wallet':'ওয়ালেট যুক্ত করুন'} onClose={onClose}><p role="alert" className="text-sm text-rose-700">{walletError(Error('WALLET_OWNER_MISMATCH'),en)}</p></ModalShell>;
  const book=readWalletBook(db.getRawState()),wallets=walletSummaries(db),selected=wallets.find(w=>w.wallet.code===code.trim().toUpperCase());
  const candidates=currentWorkspace?db.getAccounts(currentWorkspace.id).filter(a=>(a.classification||'asset')==='asset'&&!book.links.has(a.id)&&(!selected||a.kind===selected.wallet.kind)):[];
  async function save(event:React.FormEvent){
    event.preventDefault();if(busy||!currentWorkspace)return;setBusy(true);setError('');
    try{await linkMasterWallet(db,code,currentWorkspace.id,existing||undefined,actorHash);refreshState();onClose();}
    catch(e){setError(walletError(e,en));}finally{setBusy(false);}
  }
  const oldBalance=existing?db.calculateAccountSummaries(currentWorkspace?.id||'').find(a=>a.accountId===existing)?.currentBalanceMinor||'0':'0';
  const combined=(BigInt(selected?.balanceMinor||'0')+BigInt(oldBalance)).toString();
  return <ModalShell title={en?'Link a wallet':'কোড দিয়ে ওয়ালেট যুক্ত করুন'} description={currentWorkspace?.name||''} icon={<Link2 className="h-5 w-5"/>} busy={busy} onClose={()=>{if(!busy)onClose();}}>
    <form className="space-y-4" onSubmit={save}>
      <p className="rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-slate-700">{en?'Create the physical wallet in Personal → All wallets first. Use the same code here; this workspace keeps its own allocation.':'আগে ব্যক্তিগত খাতা → সব ওয়ালেট থেকে মূল ওয়ালেট যোগ করুন। এখানে সেই কোড ব্যবহার করুন; এই খাতার বরাদ্দ আলাদা থাকবে।'}</p>
      {!!wallets.length&&<label className="block text-xs font-medium text-slate-700">{en?'Your wallet':'আপনার ওয়ালেট'}<AppSelect aria-label={en?"Your physical wallet":"আপনার মূল ওয়ালেট"} className={fieldClass} value={selected?.wallet.code||''} disabled={busy} onChange={e=>{setCode(e.target.value);setExisting('');}}><option value="">{en?'Choose or paste a code below':'বেছে নিন অথবা নিচে কোড দিন'}</option>{wallets.map(w=><option key={w.wallet.id} value={w.wallet.code}>{w.wallet.name} · {w.wallet.code}</option>)}</AppSelect></label>}
      <label className="block text-xs font-medium text-slate-700">{en?'Wallet code':'ওয়ালেটের কোড'}<input required className={`${fieldClass} font-mono text-xs`} value={code} disabled={busy} onChange={e=>{setCode(e.target.value);setExisting('');}} placeholder="W-XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off"/></label>
      {!!candidates.length&&<label className="block text-xs font-medium text-slate-700">{en?'Allocation account':'এই খাতার অ্যাকাউন্ট'}<AppSelect aria-label={en?"Allocation account":"এই খাতার বরাদ্দের অ্যাকাউন্ট"} className={fieldClass} value={existing} disabled={busy} onChange={e=>setExisting(e.target.value)}><option value="">{en?'Create a new zero-balance allocation':'শূন্য টাকা দিয়ে নতুন বরাদ্দ তৈরি করুন'}</option>{candidates.map(a=><option key={a.id} value={a.id}>{en?'Link existing':'আগের হিসাব যুক্ত করুন'} · {a.name}</option>)}</AppSelect></label>}
      <div className="rounded-xl border border-slate-200 p-3 text-xs leading-relaxed text-slate-600">{existing?<>
        <p>{en?'Check that this is a separate share of the same real wallet. Existing transactions stay intact. Reconcile any duplicated opening cash before linking.':'যাচাই করুন—এটি একই মূল ওয়ালেটের এই খাতার আলাদা অংশ। আগের লেনদেন রাখা হবে। একই শুরুর টাকা দুইবার লেখা থাকলে আগে হিসাব মিলিয়ে নিন।'}</p>
        <dl className="mt-3 space-y-2"><div className="flex justify-between gap-2"><dt>{en?'Current wallet total':'ওয়ালেটের বর্তমান মোট'}</dt><dd>{formatBDT(selected?.balanceMinor||'0',{locale:language})}</dd></div><div className="flex justify-between gap-2"><dt>{en?'This existing share':'এই খাতার আগের অংশ'}</dt><dd>{formatBDT(oldBalance,{locale:language})}</dd></div><div className="flex justify-between gap-2 border-t border-slate-200 pt-2 font-bold text-slate-900"><dt>{en?'Total after linking':'যুক্ত হলে নতুন মোট'}</dt><dd>{formatBDT(combined,{locale:language})}</dd></div></dl>
      </>:<p>{en?'This adds no cash. After linking, use Transfer to allocate funds from another workspace.':'এতে নতুন টাকা যোগ হবে না। যুক্ত করার পরে স্থানান্তর থেকে এই খাতায় টাকা বরাদ্দ দিন।'}</p>}</div>
      {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
      <button type="submit" className={`${primaryButton} w-full`} disabled={busy||!code.trim()}>{busy?(en?'Saving…':'সংরক্ষণ হচ্ছে…'):(en?'Confirm link':'যাচাই করে যুক্ত করুন')}</button>
    </form>
  </ModalShell>;
}
