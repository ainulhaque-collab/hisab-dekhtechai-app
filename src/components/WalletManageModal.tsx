import {useEffect,useRef,useState} from 'react';
import {Archive,RotateCcw,Pencil,Trash2} from 'lucide-react';
import type {MasterWalletSummary} from '../contracts/wallets';
import {useApp} from '../context/AppContext';
import {changeMasterWallet,walletDeletionBlocker} from '../storage/walletBook';
import {generateUUID} from '../domain/journal';
import {DELETE_CONFIRMATION} from '../domain/confirmation';
import {ModalShell,fieldClass,primaryButton,secondaryButton} from './ModalShell';
import {walletActor,walletError} from './walletText';

export type WalletManageMode='edit'|'archive'|'restore'|'delete';
export function WalletManageModal({row,mode,onClose,onSaved}:{row:MasterWalletSummary;mode:WalletManageMode;onClose:()=>void;onSaved:()=>void}){
  const {db,language,currentWorkspace,userProfile,refreshState}=useApp(),en=language==='en';
  const context={db,workspace:currentWorkspace?.id,owner:db.getIdentity()?.ownerSubjectHash,actor:walletActor(userProfile)};
  const opened=useRef(context),latest=useRef(context);latest.current=context;
  const lock=useRef(false),mounted=useRef(true),commandId=useRef(generateUUID());
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[name,setName]=useState(row.wallet.name),[confirmation,setConfirmation]=useState('');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const stale=opened.current.db!==latest.current.db||opened.current.workspace!==latest.current.workspace||opened.current.owner!==latest.current.owner||opened.current.actor!==latest.current.actor;
  const guarded=mode==='archive'||mode==='delete';
  let blocker='';try{if(mode==='delete'){const code=walletDeletionBlocker(db,row.wallet.id);if(code)blocker=walletError(Error(code),en);}}catch(e){blocker=walletError(e,en);}
  const title=mode==='edit'?(en?'Edit wallet':'ওয়ালেট এডিট করুন'):mode==='archive'?(en?'Move wallet to archive?':'ওয়ালেট আর্কাইভে সরাবেন?'):mode==='restore'?(en?'Restore wallet':'ওয়ালেট ফিরিয়ে আনুন'):(en?'Permanently delete wallet?':'ওয়ালেট স্থায়ীভাবে মুছবেন?');
  const Icon=mode==='edit'?Pencil:mode==='archive'?Archive:mode==='restore'?RotateCcw:Trash2;
  async function save(event:React.FormEvent){
    event.preventDefault();if(lock.current||blocker||guarded&&confirmation!==DELETE_CONFIRMATION)return;
    if(stale){setError(walletError(Error('WALLET_OWNER_MISMATCH'),en));return;}
    lock.current=true;setBusy(true);setError('');
    try{
      await changeMasterWallet(db,{walletId:row.wallet.id,commandId:commandId.current,expectedRevision:row.lifecycle.revision,action:mode==='edit'?'rename':mode,
        ...(mode==='edit'?{name}:{}),...(guarded?{confirmation}:{}),actorHash:opened.current.actor});
      refreshState();if(mounted.current){onSaved();onClose();}
    }catch(e){if(mounted.current)setError(walletError(e,en));}finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  return <ModalShell title={title} description={row.wallet.name} icon={<Icon className="h-5 w-5"/>} onClose={onClose} busy={busy}>
    <form onSubmit={save} className="space-y-4">
      {mode==='edit'?<><label className="block text-sm font-medium">{en?'Wallet name':'ওয়ালেটের নাম'}<input autoFocus required maxLength={100} className={fieldClass} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><p className="text-xs leading-relaxed text-slate-500">{en?'The name updates across linked workspaces. The wallet code, type, balances and transaction history are kept.':'যুক্ত সব খাতায় নামটি আপডেট হবে। ওয়ালেটের কোড, ধরন, ব্যালেন্স ও লেনদেনের ইতিহাস রাখা হবে।'}</p></>:
      <p className="rounded-xl bg-blue-50 p-4 text-sm leading-relaxed text-slate-700">{mode==='archive'?(en?'This wallet will move to Archived in every workspace. Its money stays in the total and its history is kept. Restore it before using it again.':'সব খাতায় ওয়ালেটটি আর্কাইভে যাবে। এর টাকা মোট ব্যালেন্সে থাকবে এবং ইতিহাস রাখা হবে। আবার ব্যবহার করতে আর্কাইভ থেকে ফিরিয়ে আনুন।'):mode==='restore'?(en?'This wallet and its code will be available again. Allocations you separately archived remain archived.':'ওয়ালেট ও তার কোড আবার ব্যবহার করা যাবে। কোনো খাতার বরাদ্দ আলাদাভাবে আর্কাইভ করে থাকলে সেটি আর্কাইভেই থাকবে।'):(en?'This removes the wallet from Archived permanently. Its financial history is retained for your reports. This wallet cannot be restored.':'আর্কাইভ থেকে ওয়ালেটটি স্থায়ীভাবে সরে যাবে। রিপোর্টের জন্য পুরোনো হিসাব রাখা হবে। এই ওয়ালেট আর ফিরিয়ে আনা যাবে না।')}</p>}
      {guarded&&<label className="block text-sm font-semibold">{en?'Type DELETE to confirm':'নিশ্চিত করতে DELETE লিখুন'}<input autoFocus required autoComplete="off" autoCapitalize="off" spellCheck={false} className={fieldClass} value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></label>}
      {blocker&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{blocker}</p>}
      {(error||stale)&&<p role="alert" className="text-sm text-rose-700">{error||walletError(Error('WALLET_OWNER_MISMATCH'),en)}</p>}
      <div className="flex gap-3"><button type="button" className={secondaryButton} disabled={busy} onClick={onClose}>{en?'Cancel':'বাতিল'}</button><button type="submit" className={`${primaryButton} flex-1`} disabled={busy||stale||!!blocker||guarded&&confirmation!==DELETE_CONFIRMATION||mode==='edit'&&!name.trim()}>{busy?(en?'Saving…':'সংরক্ষণ হচ্ছে…'):mode==='edit'?(en?'Save name':'নাম সংরক্ষণ করুন'):mode==='archive'?(en?'Move to archive':'আর্কাইভে সরান'):mode==='restore'?(en?'Restore':'ফিরিয়ে আনুন'):(en?'Delete permanently':'স্থায়ীভাবে মুছুন')}</button></div>
    </form>
  </ModalShell>;
}
