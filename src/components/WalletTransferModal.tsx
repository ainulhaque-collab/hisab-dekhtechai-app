import React,{useRef,useState} from 'react';
import {ArrowRightLeft} from 'lucide-react';
import {useApp} from '../context/AppContext';
import {ModalShell,fieldClass,primaryButton} from './ModalShell';
import {AppSelect} from './AppSelect';
import {formatBDT,parsePaisaString} from '../domain/money';
import {generateUUID} from '../domain/journal';
import {transferAllocation,walletSummaries} from '../storage/walletBook';
import {walletActor,walletError} from './walletText';

export function WalletTransferModal({onClose}:{onClose:()=>void}){
  const {db,language,currentWorkspace,refreshState,userProfile}=useApp(),en=language==='en',actorHash=walletActor(userProfile);
  const [sourceWorkspace,setSourceWorkspace]=useState(currentWorkspace?.id||''),[destinationWorkspace,setDestinationWorkspace]=useState('');
  const [source,setSource]=useState(''),[destination,setDestination]=useState(''),[amount,setAmount]=useState(''),[note,setNote]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const requestId=useRef(generateUUID());
  if(actorHash!==undefined&&actorHash!==(db.getIdentity()?.ownerSubjectHash||'local-owner'))return <ModalShell title={en?'Transfer':'স্থানান্তর'} onClose={onClose}><p role="alert" className="text-sm text-rose-700">{walletError(Error('WALLET_OWNER_MISMATCH'),en)}</p></ModalShell>;
  const rows=walletSummaries(db,undefined,actorHash),allocations=rows.flatMap(row=>row.allocations.map(a=>({...a,code:row.wallet.code}))).filter(a=>!a.archived);
  const owner=db.getIdentity()?.ownerSubjectHash||'local-owner',workspaces=db.getWorkspaces().filter(w=>w.ownerSubjectHash===owner);
  const from=allocations.find(a=>a.accountId===source),to=allocations.find(a=>a.accountId===destination);
  async function save(e:React.FormEvent){
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try{await transferAllocation(db,{id:requestId.current,sourceAccountId:source,destinationAccountId:destination,amountMinor:parsePaisaString(amount).toString(),note,actorHash});refreshState();onClose();}
    catch(error){setError(walletError(error,en));}finally{setBusy(false);}
  }
  return <ModalShell title={en?'Transfer an allocation':'বরাদ্দ স্থানান্তর'} description={en?'Choose where the money belongs.':'কোন খাতার টাকা কোথায় যাবে বেছে নিন।'} icon={<ArrowRightLeft className="h-5 w-5"/>} busy={busy} onClose={()=>{if(!busy)onClose();}}>
    <form className="space-y-4" onSubmit={save}>
      <div className="space-y-3 rounded-2xl border border-slate-200 p-4"><h3 className="text-sm font-semibold text-slate-900">{en?'From':'যেখান থেকে যাবে'}</h3>
        <label className="block text-xs text-slate-600">{en?'Workspace':'খাতা'}<AppSelect aria-label={en?"Source workspace":"যে খাতা থেকে যাবে"} required className={fieldClass} value={sourceWorkspace} disabled={busy} onChange={e=>{setSourceWorkspace(e.target.value);setSource('');}}><option value="">{en?'Choose workspace':'খাতা বেছে নিন'}</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</AppSelect></label>
        <label className="block text-xs text-slate-600">{en?'Wallet':'ওয়ালেট'}<AppSelect aria-label={en?"Source wallet":"যে ওয়ালেট থেকে যাবে"} required className={fieldClass} value={source} disabled={busy} onChange={e=>setSource(e.target.value)}><option value="">{en?'Choose linked wallet':'যুক্ত ওয়ালেট বেছে নিন'}</option>{allocations.filter(a=>a.workspaceId===sourceWorkspace).map(a=><option key={a.accountId} value={a.accountId}>{a.accountName} · {formatBDT(a.availableMinor,{locale:language})}</option>)}</AppSelect></label>
        {from&&<p className="text-xs font-medium text-blue-700">{en?'Spendable':'খরচযোগ্য'}: {formatBDT(from.availableMinor,{locale:language})}</p>}
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200 p-4"><h3 className="text-sm font-semibold text-slate-900">{en?'To':'যেখানে যাবে'}</h3>
        <label className="block text-xs text-slate-600">{en?'Workspace':'খাতা'}<AppSelect aria-label={en?"Destination workspace":"যে খাতায় যাবে"} required className={fieldClass} value={destinationWorkspace} disabled={busy} onChange={e=>{setDestinationWorkspace(e.target.value);setDestination('');}}><option value="">{en?'Choose workspace':'খাতা বেছে নিন'}</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</AppSelect></label>
        <label className="block text-xs text-slate-600">{en?'Wallet':'ওয়ালেট'}<AppSelect aria-label={en?"Destination wallet":"যে ওয়ালেটে যাবে"} required className={fieldClass} value={destination} disabled={busy} onChange={e=>setDestination(e.target.value)}><option value="">{en?'Choose linked wallet':'যুক্ত ওয়ালেট বেছে নিন'}</option>{allocations.filter(a=>a.workspaceId===destinationWorkspace&&a.accountId!==source).map(a=><option key={a.accountId} value={a.accountId}>{a.accountName}</option>)}</AppSelect></label>
      </div>
      <label className="block text-xs font-medium text-slate-700">{en?'Amount (BDT)':'কত টাকা (৳)'}<input required inputMode="decimal" className={fieldClass} value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)} placeholder="0.00"/></label>
      <label className="block text-xs font-medium text-slate-700">{en?'Note (optional)':'বিবরণ (ইচ্ছামতো)'}<input maxLength={300} className={fieldClass} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></label>
      <p className="rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-slate-600">{from&&to&&from.walletId===to.walletId?(en?'Same physical wallet: its total stays the same; only the workspace shares change.':'একই মূল ওয়ালেট: মোট টাকা একই থাকবে, খাতার বরাদ্দ বদলাবে।'):(en?'A plain allocation transfer does not create income or expense.':'বরাদ্দ স্থানান্তরে নতুন আয় বা খরচ তৈরি হয় না।')}</p>
      {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
      <button type="submit" disabled={busy||!from||!to||!amount} className={`${primaryButton} w-full`}>{busy?(en?'Saving…':'সংরক্ষণ হচ্ছে…'):(en?'Confirm transfer':'স্থানান্তর করুন')}</button>
    </form>
  </ModalShell>;
}
