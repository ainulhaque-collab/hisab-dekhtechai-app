import React,{useEffect,useRef,useState} from 'react';
import {Banknote,Building2,Smartphone,Plus,Copy,ArrowUpRight,Wallet,ArrowLeft,Pencil,Trash2,RotateCcw} from 'lucide-react';
import {useApp} from '../context/AppContext';
import {fieldClass,primaryButton,secondaryButton} from './ModalShell';
import {AppSelect} from './AppSelect';
import {formatBDT,parsePaisaString} from '../domain/money';
import {generateUUID} from '../domain/journal';
import {localDate} from '../domain/transactionTime';
import type {AccountKind} from '../contracts/types';
import {createMasterWallet,personalWalletHome,readWalletBook,walletSummaries} from '../storage/walletBook';
import {walletActor,walletError} from './walletText';
import {WalletTransferModal} from './WalletTransferModal';
import {WalletManageModal,type WalletManageMode} from './WalletManageModal';
import type {MasterWalletSummary} from '../contracts/wallets';

export default function AllWalletsPage({onClose}:{onClose:()=>void}){
  const {db,language,refreshState,currentWorkspace,userProfile}=useApp(),en=language==='en',actorHash=walletActor(userProfile);
  const [view,setView]=useState<'list'|'create'>('list'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [name,setName]=useState(''),[kind,setKind]=useState<AccountKind>('bkash'),[opening,setOpening]=useState(''),[existing,setExisting]=useState('');
  const [copied,setCopied]=useState(''),[transfer,setTransfer]=useState(false);
  const [period,setPeriod]=useState<'today'|'month'|'all'>('today');
  const [tab,setTab]=useState<'wallets'|'workspaces'>('wallets');
  const [archived,setArchived]=useState(false),[notice,setNotice]=useState('');
  const [manage,setManage]=useState<{row:MasterWalletSummary;mode:WalletManageMode}|null>(null);
  const requestId=useRef(generateUUID());
  useEffect(()=>{
    const back=(event:Event)=>{
      if(event.defaultPrevented||document.querySelector('[role="dialog"][aria-modal="true"]'))return;
      event.preventDefault();if(busy)return;if(view==='create')setView('list');else onClose();
    };
    window.addEventListener('hisab-back',back);return()=>window.removeEventListener('hisab-back',back);
  },[view,busy,onClose]);
  const owner=db.getIdentity()?.ownerSubjectHash||'local-owner',home=personalWalletHome(db.getRawState().workspaces.values(),owner);
  let book:ReturnType<typeof readWalletBook>|undefined,rows:ReturnType<typeof walletSummaries>=[],loadError='';
  const today=localDate(),range=period==='all'?undefined:{fromDate:period==='month'?`${today.slice(0,7)}-01`:today,toDate:today};
  try{book=readWalletBook(db.getRawState());rows=walletSummaries(db,range,actorHash);}catch(e){loadError=walletError(e,en);}
  const allowed=home?.id===currentWorkspace?.id;
  const legacy=home?db.getAccounts(home.id).filter(a=>(a.classification||'asset')==='asset'&&!book?.links.has(a.id)):[];
  const unlinked=Array.from(db.getRawState().accounts.values()).filter(a=>db.getWorkspace(a.workspaceId)?.ownerSubjectHash===owner&&
    (a.classification||'asset')==='asset'&&!a.id.startsWith('sl-account-')&&!book?.links.has(a.id))
    .filter(a=>db.calculateAccountSummaries(a.workspaceId).some(s=>s.accountId===a.id&&BigInt(s.currentBalanceMinor)!==0n));
  const total=rows.reduce((n,w)=>n+BigInt(w.balanceMinor),0n).toString(),reserved=rows.reduce((n,w)=>n+BigInt(w.reservedMinor),0n).toString();
  const visibleRows=rows.filter(row=>row.lifecycle.status===(archived?'archived':'active'));
  const money=(value:string)=>formatBDT(value,{locale:language});
  const labels:Record<AccountKind,string>={cash:en?'Cash in hand':'হাতে ক্যাশ',bank:en?'Banks':'ব্যাংক',bkash:en?'bKash':'বিকাশ',nagad:en?'Nagad account':'নগদ অ্যাকাউন্ট',rocket:en?'Rocket':'রকেট',other:en?'Other':'অন্যান্য'};
  const visibleKinds=(['cash','bkash','nagad','bank','rocket','other'] as const).filter(k=>['cash','bkash','nagad','bank'].includes(k)||rows.some(r=>r.wallet.kind===k));
  const byWorkspace=new Map<string,{id:string;name:string;balance:bigint;available:bigint;reserved:bigint;income:bigint;expense:bigint}>();
  for(const row of visibleRows)for(const a of row.allocations){const value=byWorkspace.get(a.workspaceId)||{id:a.workspaceId,name:a.workspaceName,balance:0n,available:0n,reserved:0n,income:0n,expense:0n};value.balance+=BigInt(a.balanceMinor);value.available+=BigInt(a.availableMinor);value.reserved+=BigInt(a.reservedMinor);value.income+=BigInt(a.incomeMinor);value.expense+=BigInt(a.expenseMinor);byWorkspace.set(value.id,value);}
  async function save(event:React.FormEvent){
    event.preventDefault();if(busy||!allowed)return;setBusy(true);setError('');
    try{
      const old=legacy.find(a=>a.id===existing),amount=existing?'0':parsePaisaString(opening||'0').toString();
      await createMasterWallet(db,{id:requestId.current,name:name.trim(),kind:old?.kind||kind,openingBalanceMinor:amount,actorHash,...(old?{existingAccountId:old.id}:{})});
      requestId.current=generateUUID();refreshState();setName('');setOpening('');setExisting('');setArchived(false);setView('list');
    }catch(e){setError(walletError(e,en));}finally{setBusy(false);}
  }
  async function copy(code:string){try{if(!navigator.clipboard)throw Error();await navigator.clipboard.writeText(code);setCopied(code);}catch{setCopied('manual');}}
  return <section className="space-y-5 pb-28">
    <header className="flex items-center gap-3"><button type="button" disabled={busy} onClick={onClose} aria-label={en?'Back':'ফিরে যান'} className="flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"><ArrowLeft className="h-5 w-5"/></button><div><h1 className="text-xl font-bold text-slate-900">{en?'All wallets':'সব ওয়ালেট'}</h1><p className="mt-1 text-xs text-slate-500">{en?'Total cash · separate workspace shares':'মোট টাকা · খাতার বরাদ্দ আলাদা'}</p></div></header>
    {(!allowed||loadError)?<p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{loadError||(en?'Open this page from your first Personal workspace.':'প্রথম ব্যক্তিগত খাতা থেকে এই পেজ খুলুন।')}</p>:<div className="space-y-5">
      {view==='list'?<>
        <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-900 p-5 text-white shadow-lg">
          <p className="text-xs text-blue-100">{en?'Total in linked wallets':'যুক্ত ওয়ালেটের মোট টাকা'}</p><p className="mt-2 break-all text-3xl font-bold tabular-nums">{money(total)}</p>
          <div className="mt-3 border-t border-white/15 pt-3 text-xs text-blue-100"><span>{en?'Includes goal savings':'এর মধ্যে Goal-এ আছে'} </span><strong className="text-white">{money(reserved)}</strong></div>
        </section>
        <dl className="grid grid-cols-2 gap-3">{visibleKinds.map(kind=><div key={kind} className="rounded-2xl border border-slate-200 bg-white p-4"><dt className="flex items-center gap-2 text-xs text-slate-500">{kind==='cash'?<Banknote className="h-4 w-4 text-emerald-600"/>:kind==='bank'?<Building2 className="h-4 w-4 text-blue-600"/>:<Smartphone className="h-4 w-4 text-indigo-600"/>}{labels[kind]}</dt><dd className="mt-2 break-all text-lg font-bold tabular-nums text-slate-900">{money(rows.filter(r=>r.wallet.kind===kind).reduce((n,r)=>n+BigInt(r.balanceMinor),0n).toString())}</dd></div>)}</dl>
        {!!unlinked.length&&<p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">{en?`${unlinked.length} existing accounts are not linked yet and are excluded from this total. Link them after checking their balances.`:`আগের ${unlinked.length}টি হিসাব এখনো যুক্ত হয়নি; উপরের মোটে সেগুলো নেই। ব্যালেন্স মিলিয়ে যুক্ত করুন।`}</p>}
        {!!book?.pendingReferences&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-950">{walletError(Error('WALLET_SYNC_INCOMPLETE'),en)}</p>}
        <div className="grid grid-cols-2 gap-3"><button className={primaryButton} onClick={()=>{setError('');setView('create');}}><Plus className="h-4 w-4"/>{en?'Add wallet':'ওয়ালেট যোগ করুন'}</button><button className={secondaryButton} disabled={!rows.length||!!book?.pendingReferences} onClick={()=>setTransfer(true)}><ArrowUpRight className="h-4 w-4"/>{en?'Transfer':'স্থানান্তর'}</button></div>
        {!!rows.length&&<label className="block text-xs font-medium text-slate-600">{en?'Income and expense period':'কোন সময়ের আয়–খরচ দেখবেন'}<AppSelect aria-label={en?"Income and expense period":"আয়–খরচের সময়"} className={fieldClass} value={period} onChange={e=>setPeriod(e.target.value as 'today'|'month'|'all')}><option value="today">{en?'Today':'আজ'}</option><option value="month">{en?'This month':'এই মাস'}</option><option value="all">{en?'All time':'শুরু থেকে সব'}</option></AppSelect></label>}
        {!!rows.length&&<div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">{(['wallets','workspaces'] as const).map(value=><button key={value} type="button" aria-pressed={tab===value} className={`min-h-12 rounded-lg px-3 text-sm font-semibold ${tab===value?'bg-white text-blue-700 shadow-sm':'text-slate-500'}`} onClick={()=>setTab(value)}>{value==='wallets'?(en?'By wallet':'ওয়ালেটভিত্তিক'):(en?'By workspace':'খাতাভিত্তিক')}</button>)}</div>}
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" aria-label={en?'Wallet status':'ওয়ালেটের অবস্থা'}>{[false,true].map(value=><button key={String(value)} type="button" aria-pressed={archived===value} className={`min-h-12 rounded-lg px-3 text-sm font-semibold ${archived===value?'bg-white text-blue-700 shadow-sm':'text-slate-500'}`} onClick={()=>{setArchived(value);setNotice('');}}>{value?(en?'Archived':'আর্কাইভ'):(en?'Active':'চালু')}</button>)}</div>
        {rows.some(row=>row.lifecycle.status==='archived')&&<p className="text-xs leading-relaxed text-slate-500">{en?'The total above includes archived wallets. Restore them before spending their money.':'উপরের মোট টাকায় আর্কাইভের ওয়ালেটও আছে। সেই টাকা ব্যবহার করতে আগে ওয়ালেট ফিরিয়ে আনুন।'}</p>}
        {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {!visibleRows.length&&rows.length>0&&<p className="py-5 text-center text-sm text-slate-500">{archived?(en?'No archived wallets.':'আর্কাইভে কোনো ওয়ালেট নেই।'):(en?'No active wallets. Add one or restore an archived wallet.':'চালু ওয়ালেট নেই। নতুন ওয়ালেট যোগ করুন অথবা আর্কাইভ থেকে ফিরিয়ে আনুন।')}</p>}
        {tab==='workspaces'&&Array.from(byWorkspace.values()).map(w=><section key={w.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="text-base font-semibold text-slate-900">{w.name}</h2><div className="grid grid-cols-2 gap-3 text-xs text-slate-500"><div>{en?'Allocation total':'মোট বরাদ্দ'}<strong className="mt-1 block text-lg text-slate-900">{money(w.balance.toString())}</strong></div><div>{en?'Spendable':'খরচযোগ্য'}<strong className="mt-1 block text-lg text-blue-700">{money(w.available.toString())}</strong></div><div>{en?'Income':'আয়'}<strong className="mt-1 block text-sm text-emerald-700">{money(w.income.toString())}</strong></div><div>{en?'Expense':'খরচ'}<strong className="mt-1 block text-sm text-rose-700">{money(w.expense.toString())}</strong></div></div><p className="border-t border-slate-100 pt-3 text-xs text-slate-500">{en?'Included goal savings':'এই বরাদ্দের মধ্যে Goal-এ'} {money(w.reserved.toString())}</p></section>)}
        {!rows.length&&<div className="rounded-2xl border border-dashed border-slate-200 p-5 text-center"><Wallet className="mx-auto h-8 w-8 text-blue-600"/><h3 className="mt-3 font-semibold text-slate-900">{en?'Keep each real wallet here':'আপনার মূল ওয়ালেট এখানে রাখুন'}</h3><p className="mt-2 text-xs leading-relaxed text-slate-500">{en?'Add Cash, bKash, Nagad or a bank account. Use its code to allocate money to another workspace.':'ক্যাশ, বিকাশ, নগদ বা ব্যাংক যোগ করুন। তৈরি হওয়া কোড দিয়ে অন্য খাতায় ওয়ালেট যুক্ত করুন।'}</p></div>}
        {tab==='wallets'&&visibleRows.map(row=><section key={row.wallet.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-start gap-3 p-4"><span className="rounded-xl bg-blue-50 p-3 text-blue-700">{row.wallet.kind==='bank'?<Building2 className="h-5 w-5"/>:row.wallet.kind==='cash'?<Banknote className="h-5 w-5"/>:<Smartphone className="h-5 w-5"/>}</span><div className="min-w-0 flex-1"><h3 className="font-semibold text-slate-900">{row.wallet.name}</h3><p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{money(row.balanceMinor)}</p></div></div>
          <div className="mx-4 mb-4 flex items-center gap-2 rounded-xl bg-slate-50 p-2"><code className="min-w-0 flex-1 select-all break-all text-[10px] text-slate-600">{row.wallet.code}</code><button type="button" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-blue-700 hover:bg-blue-50" aria-label={en?'Copy wallet code':'ওয়ালেট কোড কপি করুন'} onClick={()=>{void copy(row.wallet.code);}}><Copy className="h-4 w-4"/></button></div>
          {copied===row.wallet.code&&<p role="status" className="px-4 pb-3 text-xs text-emerald-700">{en?'Code copied. Use it in the other workspace.':'কোড কপি হয়েছে। অন্য খাতায় এটি দিয়ে যুক্ত করুন।'}</p>}
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            <button type="button" className={secondaryButton} onClick={()=>setManage({row,mode:'edit'})}><Pencil className="h-4 w-4"/>{en?'Edit':'এডিট'}</button>
            {archived&&<button type="button" className={secondaryButton} onClick={()=>setManage({row,mode:'restore'})}><RotateCcw className="h-4 w-4"/>{en?'Restore':'ফিরিয়ে আনুন'}</button>}
            <button type="button" className={`${secondaryButton} text-rose-700`} onClick={()=>setManage({row,mode:archived?'delete':'archive'})}><Trash2 className="h-4 w-4"/>{archived?(en?'Delete permanently':'স্থায়ীভাবে মুছুন'):(en?'Delete':'মুছুন')}</button>
          </div>
          <div className="divide-y divide-slate-100 border-t border-slate-100">{row.allocations.map(a=><div key={a.accountId} className="space-y-2 p-4 text-xs"><div className="flex justify-between gap-3"><p className="font-semibold text-slate-800">{a.workspaceName}{a.archived?` · ${en?'Archived':'আর্কাইভ'}`:''}</p><strong className="tabular-nums text-slate-900">{money(a.balanceMinor)}</strong></div><div className="flex flex-wrap justify-between gap-2 text-slate-500"><span>{en?'Goal savings':'Goal-এ'} {money(a.reservedMinor)}</span><span className="font-medium text-blue-700">{en?'Spendable':'খরচযোগ্য'} {money(a.availableMinor)}</span></div><div className="flex flex-wrap gap-4 text-[11px] text-slate-500"><span>{en?'Income':'আয়'} {money(a.incomeMinor)}</span><span>{en?'Expense':'খরচ'} {money(a.expenseMinor)}</span></div></div>)}</div>
        </section>)}
        {copied==='manual'&&<p role="status" className="text-xs text-slate-600">{en?'Press and hold the code to copy it.':'কোডটি চেপে ধরে কপি করুন।'}</p>}
      </>:<form onSubmit={save} className="space-y-4">
        <button type="button" className="inline-flex min-h-11 items-center gap-2 text-xs text-blue-700" onClick={()=>setView('list')} disabled={busy}><ArrowLeft className="h-4 w-4"/>{en?'All wallets':'সব ওয়ালেট'}</button>
        {!!legacy.length&&<label className="block text-xs font-medium text-slate-700">{en?'Start with':'যেভাবে যোগ করবেন'}<AppSelect aria-label={en?"New or existing wallet":"নতুন অথবা আগের ওয়ালেট"} className={fieldClass} value={existing} disabled={busy} onChange={e=>{setExisting(e.target.value);const a=legacy.find(a=>a.id===e.target.value);if(a){setName(a.name);setKind(a.kind);}}}><option value="">{en?'New wallet':'নতুন ওয়ালেট'}</option>{legacy.map(a=><option key={a.id} value={a.id}>{en?'Use existing':'আগের হিসাব'} · {a.name}</option>)}</AppSelect></label>}
        <label className="block text-xs font-medium text-slate-700">{en?'Wallet name':'ওয়ালেটের নাম'}<input required maxLength={100} className={fieldClass} value={name} disabled={busy} onChange={e=>setName(e.target.value)} placeholder={en?'e.g. My bKash':'যেমন: আমার বিকাশ'}/></label>
        {!existing&&<><label className="block text-xs font-medium text-slate-700">{en?'Wallet type':'ওয়ালেটের ধরন'}<AppSelect aria-label={en?"Wallet type":"ওয়ালেটের ধরন"} className={fieldClass} value={kind} disabled={busy} onChange={e=>setKind(e.target.value as AccountKind)}>{(['cash','bank','bkash','nagad','rocket','other'] as const).map(k=><option key={k} value={k}>{({cash:en?'Cash':'হাতে ক্যাশ',bank:en?'Bank':'ব্যাংক',bkash:'bKash',nagad:en?'Nagad':'নগদ',rocket:'Rocket',other:en?'Other':'অন্যান্য'})[k]}</option>)}</AppSelect></label><label className="block text-xs font-medium text-slate-700">{en?'Opening Personal allocation (BDT)':'শুরুতে ব্যক্তিগত খাতার টাকা (৳)'}<input className={fieldClass} inputMode="decimal" value={opening} disabled={busy} onChange={e=>setOpening(e.target.value)} placeholder="0.00"/></label><p className="rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-slate-600">{en?'Enter only the amount being recorded now. Transfer a share to Business after linking its code. Do not enter the same cash again.':'এখন হিসাবে যে টাকা আনছেন শুধু সেটি লিখুন। কোড দিয়ে ব্যবসার খাতা যুক্ত করে তার অংশ স্থানান্তর করুন। একই টাকা আবার যোগ করবেন না।'}</p></>}
        {existing&&<div className="rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-slate-700"><p>{en?'This connects the selected existing account. Its transactions and opening amount remain intact. No new cash is added.':'নির্বাচিত আগের হিসাবটি যুক্ত হবে। তার লেনদেন ও শুরুর টাকা রাখা হবে। নতুন টাকা যোগ হবে না।'}</p><p className="mt-2 font-semibold">{en?'Balance included':'মোটে যুক্ত হবে'}: {money(db.calculateAccountSummaries(home!.id).find(a=>a.accountId===existing)?.currentBalanceMinor||'0')}</p></div>}
        {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
        <button type="submit" className={`${primaryButton} w-full`} disabled={busy||!name.trim()}>{busy?(en?'Saving…':'সংরক্ষণ হচ্ছে…'):(en?'Save wallet & create code':'ওয়ালেট সংরক্ষণ ও কোড তৈরি করুন')}</button>
      </form>}
      {error&&view==='list'&&<p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>}
    {transfer&&<WalletTransferModal onClose={()=>setTransfer(false)}/>}
    {manage&&<WalletManageModal key={`${manage.row.wallet.id}:${manage.mode}`} row={manage.row} mode={manage.mode} onClose={()=>setManage(null)} onSaved={()=>setNotice(en?'Wallet updated. Your financial history is kept.':'ওয়ালেট আপডেট হয়েছে। পুরোনো হিসাব রাখা আছে।')}/>}
  </section>;
}
