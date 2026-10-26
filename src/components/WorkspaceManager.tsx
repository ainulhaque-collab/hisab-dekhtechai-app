import React, { useState } from 'react';
import { BriefcaseBusiness, UserRound, ChevronRight, Archive, RotateCcw, Upload, Trash2, ImagePlus, ShieldCheck, Wallet, ReceiptText, LoaderCircle, Check, ArrowLeft, AlertCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Workspace } from '../contracts/types';
import { DELETE_CONFIRMATION } from '../domain/confirmation';
import { optimizeWorkspaceImage, workspaceMedia } from '../storage/workspaceMedia';
import { WorkspaceAvatar } from './WorkspaceAvatar';
import { ModalShell, primaryButton, secondaryButton, fieldClass } from './ModalShell';

export function WorkspaceManager({ onClose }: { onClose: () => void }) {
  const { db, refreshState, language } = useApp();
  const en = language === 'en';
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [imageChanged, setImageChanged] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const all = db.getAllWorkspaces();
  const active = all.filter(ws => !ws.archivedAt);
  const archived = all.filter(ws => ws.archivedAt);
  const disabled = busy || imageLoading;
  async function mutate(work: () => void) {
    if (busy) return; setBusy(true); setError('');
    try {
      await db.beginTransaction(); work(); await db.commitTransaction(); refreshState(); setEditing(null);
    } catch (err) { await db.rollbackTransaction(); setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function openWorkspace(ws: Workspace) {
    setEditing(ws); setName(ws.name); setDescription(ws.description || ''); setConfirmation(''); setImage(null); setImageChanged(false); setError(''); setImageLoading(true);
    try { setImage(await workspaceMedia.get(ws.id, ws.ownerSubjectHash)); }
    catch { setError(en ? 'The image could not be loaded. Your workspace is safe.' : 'ছবি লোড হয়নি। আপনার খাতা সুরক্ষিত আছে।'); }
    finally { setImageLoading(false); }
  }
  async function save() {
    if (!editing || disabled) return;
    setError(''); setBusy(true);
    try { if (imageChanged) await workspaceMedia.save(editing.id, editing.ownerSubjectHash, image); }
    catch (err) { setError((err as Error).message); setBusy(false); return; }
    setBusy(false); await mutate(() => { db.editWorkspace(editing.id, { name, description }); });
  }
  const kindName = (ws: Workspace) => ws.kind === 'business' ? (en ? 'Business' : 'ব্যবসা') : (en ? 'Personal' : 'ব্যক্তিগত');
  const blocker = editing ? db.workspaceDeleteBlocker(editing.id) : null;
  return <ModalShell title={editing ? (en ? 'Workspace details' : 'খাতার বিবরণ') : (en ? 'Your workspaces' : 'আপনার হিসাব খাতা')}
    description={editing ? (en ? 'Make this space your own.' : 'নিজের মতো করে সাজিয়ে নিন।') : (en ? 'Keep every part of your finances organized.' : 'প্রতিটি হিসাব রাখুন আলাদা ও গোছানো।')}
    icon={editing?.kind === 'personal' ? <UserRound className="h-5 w-5" /> : <BriefcaseBusiness className="h-5 w-5" />} onClose={onClose} busy={disabled}
    footer={editing ? <div className="flex gap-2.5"><button className={`${secondaryButton} flex-1`} disabled={disabled} onClick={() => setEditing(null)}>{en ? 'Cancel' : 'বাতিল'}</button><button className={`${primaryButton} flex-[1.5]`} disabled={disabled || !name.trim()} onClick={save}>{disabled ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{en ? 'Save changes' : 'পরিবর্তন সংরক্ষণ'}</button></div> :
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5" />{en ? 'Separate workspaces. One clear picture.' : 'আলাদা খাতা, পরিষ্কার হিসাব।'}</div>}>
    <div className="space-y-5">
      {error && <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-rose-50 border border-rose-100 p-3 text-xs text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
      {!editing ? <>
        <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
          <button className={`flex-1 rounded-lg py-2 transition ${tab === 'active' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400'}`} onClick={() => setTab('active')}>{en ? 'Active' : 'সক্রিয়'} <span className="ml-1 text-slate-400">{active.length}</span></button>
          <button className={`flex-1 rounded-lg py-2 transition ${tab === 'archived' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400'}`} onClick={() => setTab('archived')}>{en ? 'Archived' : 'আর্কাইভ'} <span className="ml-1 text-slate-400">{archived.length}</span></button>
        </div>
        <div className="space-y-2.5">{(tab === 'active' ? active : archived).map(ws => <button key={ws.id} className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/20 focus-visible:outline-2 focus-visible:outline-blue-500" disabled={disabled} onClick={() => openWorkspace(ws)}>
          <div className="rounded-xl bg-slate-50 p-1.5"><WorkspaceAvatar workspace={ws} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{ws.name}</p><p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">{kindName(ws)}<span>·</span><span className={`h-1.5 w-1.5 rounded-full ${ws.archivedAt ? 'bg-slate-300' : 'bg-emerald-400'}`} />{ws.archivedAt ? (en ? 'Archived' : 'আর্কাইভ') : (en ? 'Active' : 'সক্রিয়')}</p></div>
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-blue-600" />
        </button>)}</div>
        {tab === 'archived' && !archived.length && <div className="py-7 text-center"><Archive className="mx-auto mb-3 h-8 w-8 text-slate-200" /><p className="text-xs text-slate-400">{en ? 'No archived workspaces' : 'কোনো আর্কাইভ করা খাতা নেই'}</p></div>}
      </> : <>
        <button className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-blue-700" disabled={disabled} onClick={() => setEditing(null)}><ArrowLeft className="h-3.5 w-3.5" />{en ? 'All workspaces' : 'সব খাতা'}</button>
        <div className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70 shadow-xs">
            {image ? <img src={image} alt={en ? 'Square image preview' : 'ছবির প্রিভিউ'} className="h-full w-full object-cover" /> : <ImagePlus className="h-7 w-7 text-slate-300" />}
            {imageLoading && <div className="absolute inset-0 flex items-center justify-center bg-white/80"><LoaderCircle className="h-5 w-5 animate-spin text-blue-600" /></div>}
          </div>
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-700">{editing.kind === 'business' ? (en ? 'Business logo' : 'ব্যবসার লোগো') : (en ? 'Personal photo' : 'ব্যক্তিগত ছবি')}</p><p className="mt-1 text-[10px] text-slate-400">JPG, PNG, WebP · {en ? 'Up to 5 MB' : 'সর্বোচ্চ ৫ মেগাবাইট'}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-3"><label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-blue-700 hover:text-blue-900"><Upload className="h-3.5 w-3.5" />{en ? (image ? 'Change photo' : 'Upload photo') : (image ? 'ছবি পরিবর্তন' : 'ছবি যোগ করুন')}
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={async e => {
                const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
                setImageLoading(true); setError(''); try { setImage(await optimizeWorkspaceImage(file)); setImageChanged(true); }
                catch (err) { setError((err as Error).message); } finally { setImageLoading(false); }
              }} /></label>
              {image && <button disabled={disabled} className="text-[11px] font-medium text-slate-400 hover:text-rose-600" onClick={() => { setImage(null); setImageChanged(true); }}>{en ? 'Remove' : 'সরান'}</button>}
            </div>
          </div>
        </div>
        <label className="block text-xs font-semibold text-slate-600">{en ? 'Workspace name' : 'খাতার নাম'}<input autoFocus value={name} maxLength={100} onChange={e => setName(e.target.value)} className={fieldClass} disabled={disabled} /></label>
        <label className="block text-xs font-semibold text-slate-600">{en ? 'Description' : 'বিবরণ'} <span className="font-normal text-slate-400">{en ? '(optional)' : '(ঐচ্ছিক)'}</span><textarea value={description} maxLength={500} rows={3} onChange={e => setDescription(e.target.value)} className={fieldClass} disabled={disabled} placeholder={en ? 'What do you use this workspace for?' : 'এই খাতায় কীসের হিসাব রাখবেন?'} /><span className="mt-1 block text-right text-[10px] font-normal text-slate-400">{description.length}/500</span></label>
        <div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-slate-100 px-3.5 py-3"><Wallet className="mb-2 h-4 w-4 text-slate-400" /><span className="text-lg font-bold tabular-nums">{db.getAllAccounts(editing.id).length}</span><span className="ml-2 text-[11px] text-slate-400">{en ? 'accounts' : 'অ্যাকাউন্ট'}</span></div><div className="rounded-xl border border-slate-100 px-3.5 py-3"><ReceiptText className="mb-2 h-4 w-4 text-slate-400" /><span className="text-lg font-bold tabular-nums">{db.getTransactions(editing.id).length}</span><span className="ml-2 text-[11px] text-slate-400">{en ? 'transactions' : 'লেনদেন'}</span></div></div>
        <button className="flex w-full items-center gap-3 rounded-xl border border-slate-200/70 p-3.5 text-left hover:bg-slate-50 disabled:opacity-40" disabled={disabled} onClick={() => mutate(() => { if (editing.archivedAt) db.restoreWorkspace(editing.id); else db.archiveWorkspace(editing.id); })}>
          {editing.archivedAt ? <RotateCcw className="h-4 w-4 text-blue-600" /> : <Archive className="h-4 w-4 text-slate-500" />}<span className="flex-1"><span className="block text-xs font-semibold text-slate-700">{editing.archivedAt ? (en ? 'Restore workspace' : 'খাতা ফিরিয়ে আনুন') : (en ? 'Archive workspace' : 'খাতা আর্কাইভ করুন')}</span><span className="mt-1 block text-[10px] text-slate-400">{en ? 'Your accounts and financial history stay intact.' : 'অ্যাকাউন্ট ও পুরোনো হিসাব অক্ষত থাকবে।'}</span></span><ChevronRight className="h-4 w-4 text-slate-300" />
        </button>
        <details className="rounded-xl border border-rose-100/80 px-3.5 py-3"><summary className="cursor-pointer text-[11px] font-semibold text-rose-500">{en ? 'Delete workspace' : 'খাতা মুছুন'}</summary><div className="mt-3 space-y-3">
          {!blocker && <p className="text-xs text-slate-500">{en ? 'Unused starter accounts and categories do not prevent deletion. No financial history will be erased.' : 'অব্যবহৃত ডিফল্ট অ্যাকাউন্ট ও খাত থাকলেও মুছতে পারবেন। কোনো লেনদেনের ইতিহাস মুছবে না।'}</p>}
          {blocker && <p className="text-xs leading-relaxed text-slate-500">{en ? blocker : 'এই খাতায় হিসাব বা পরিবর্তন করা তথ্য আছে। সেগুলো সুরক্ষিত রাখতে আর্কাইভ করুন—পরে আবার ফিরিয়ে আনতে পারবেন।'}</p>}
          {!blocker && <label className="block text-[11px] text-slate-500">{en ? 'Type DELETE to confirm permanent removal of this empty workspace.' : 'এই খালি খাতা মুছতে DELETE লিখুন।'}<input value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" className={fieldClass} /></label>}
          <button className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-rose-600 px-3.5 py-2.5 text-xs font-semibold text-white disabled:opacity-30" disabled={disabled || !!blocker || confirmation !== DELETE_CONFIRMATION} onClick={() => mutate(() => db.safeDeleteWorkspace(editing.id, confirmation))}><Trash2 className="h-3.5 w-3.5" />{en ? 'Delete empty workspace' : 'খালি খাতা মুছুন'}</button>
        </div></details>
        <p className="text-center text-[10px] leading-relaxed text-slate-400">{kindName(editing)} · BDT · {en ? 'Created' : 'তৈরি'} {new Date(editing.createdAt).toLocaleDateString(en ? 'en-GB' : 'bn-BD')}<br />{en ? 'Photos use a centered square crop and stay on this device.' : 'ছবি মাঝখান থেকে বর্গাকার ক্রপ হয় এবং এই ডিভাইসে থাকে।'}</p>
      </>}
    </div>
  </ModalShell>;
}
