import { useDialog } from './useDialog';
import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import { Workspace } from '../contracts/types';
import { DELETE_CONFIRMATION } from '../domain/confirmation';
import { optimizeWorkspaceImage, workspaceMedia } from '../storage/workspaceMedia';
import { WorkspaceAvatar } from './WorkspaceAvatar';

export function WorkspaceManager({ onClose }: { onClose: () => void }) {
  const { db, refreshState, language } = useApp();
  const en = language === 'en';
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [name, setName] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [imageChanged, setImageChanged] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useDialog(true, panel, () => { if (!busy && !imageLoading) onClose(); });
  async function mutate(work: () => void) {
    if (busy) return; setBusy(true); setError('');
    try {
      await db.beginTransaction(); work(); await db.commitTransaction(); refreshState(); setEditing(null);
    } catch (err) { await db.rollbackTransaction(); setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return createPortal(<div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-3">
    <section ref={panel} role="dialog" aria-modal="true" aria-label={en ? 'Manage workspaces' : 'খাতা পরিচালনা'} className="bg-white text-slate-900 p-5 rounded-2xl max-w-lg w-full max-h-[90dvh] overflow-auto space-y-3">
      <div className="flex justify-between"><h2 className="font-bold">{en ? 'Manage workspaces' : 'খাতা পরিচালনা'}</h2><button aria-label="Close" disabled={busy || imageLoading} onClick={onClose}>✕</button></div>
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      {!editing ? db.getAllWorkspaces().map(ws => <div key={ws.id} className="border rounded-xl p-3 flex items-center gap-3">
        <WorkspaceAvatar workspace={ws} /><div className="flex-1 min-w-0"><p className="truncate font-semibold">{ws.name}</p><p className="text-xs text-slate-500">{ws.kind === 'business' ? (en ? 'Business' : 'ব্যবসা') : (en ? 'Personal' : 'ব্যক্তিগত')} · {ws.archivedAt ? (en ? 'Archived' : 'আর্কাইভ') : (en ? 'Active' : 'সক্রিয়')}</p></div>
        <button className="p-2 border rounded-lg" disabled={busy} onClick={async () => {
          setEditing(ws); setName(ws.name); setConfirmation(''); setImage(null); setImageChanged(false); setError(''); setImageLoading(true);
          try { setImage(await workspaceMedia.get(ws.id, ws.ownerSubjectHash)); } catch { setError(en ? 'Image could not be loaded.' : 'ছবি লোড হয়নি।'); } finally { setImageLoading(false); }
        }}>{en ? 'Manage' : 'পরিচালনা'}</button>
      </div>) : <div className="space-y-3">
        <p className="text-xs text-slate-500">{en ? 'Created:' : 'তৈরি:'} {new Date(editing.createdAt).toLocaleDateString()} · BDT · {db.getAllAccounts(editing.id).length} {en ? 'accounts' : 'অ্যাকাউন্ট'} · {db.getTransactions(editing.id).length} {en ? 'transactions' : 'লেনদেন'}</p>
        <label className="block">{en ? 'Workspace name' : 'খাতার নাম'}<input autoFocus value={name} maxLength={100} onChange={e => setName(e.target.value)} className="block w-full p-3 border rounded-lg" /></label>
        <p>{editing.kind === 'business' ? (en ? 'Business logo' : 'ব্যবসার লোগো') : (en ? 'Personal workspace photo' : 'ব্যক্তিগত খাতার ছবি')}</p>
        {image ? <img src={image} alt={en ? 'Square image preview' : 'ছবির প্রিভিউ'} className="w-24 h-24 rounded-xl object-cover" /> : <span className="w-24 h-24 flex items-center justify-center rounded-xl bg-blue-100 text-blue-800">{name.trim().slice(0, 1) || "◈"}</span>}
        <label className="block border rounded-lg p-3">{en ? 'Add / Change Logo or Photo' : 'লোগো / ছবি যোগ বা পরিবর্তন'}
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || imageLoading} onChange={async e => {
            const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
            setImageLoading(true); setError(''); try { setImage(await optimizeWorkspaceImage(file)); setImageChanged(true); }
            catch (err) { setError((err as Error).message); } finally { setImageLoading(false); }
          }} /></label>
        <p className="text-xs text-slate-500">{en ? 'JPEG, PNG or WebP up to 5 MB. Preview uses a centered square crop. Images stay private on this device; image synchronization is not enabled.' : 'সর্বোচ্চ ৫ মেগাবাইটের JPEG, PNG বা WebP। মাঝখান থেকে বর্গাকার ক্রপ হয়। ছবি ব্যক্তিগতভাবে এই ডিভাইসে থাকে; ছবি সিঙ্ক চালু নেই।'}</p>
        <button disabled={busy || imageLoading} className="p-2 border rounded-lg" onClick={() => { setImage(null); setImageChanged(true); }}>{en ? 'Remove image' : 'ছবি সরান'}</button>
        <div className="flex gap-2"><button className="p-3 bg-blue-700 text-white rounded-lg disabled:opacity-40" disabled={busy || imageLoading || !name.trim()} onClick={async () => {
          // Asset persistence finishes separately from financial journal serialization.
          setError(''); setBusy(true);
          try { if (imageChanged) await workspaceMedia.save(editing.id, editing.ownerSubjectHash, image); }
          catch (err) { setError((err as Error).message); setBusy(false); return; }
          setBusy(false); await mutate(() => { db.editWorkspace(editing.id, { name }); });
        }}>{en ? 'Save' : 'সংরক্ষণ'}</button><button className="p-3 border rounded-lg" disabled={busy || imageLoading} onClick={() => setEditing(null)}>{en ? 'Cancel' : 'বাতিল'}</button></div>
        <button className="p-3 border rounded-lg" disabled={busy || imageLoading} onClick={() => mutate(() => {
          if (editing.archivedAt) db.restoreWorkspace(editing.id); else db.archiveWorkspace(editing.id);
        })}>{editing.archivedAt ? (en ? 'Restore workspace' : 'খাতা ফিরিয়ে আনুন') : (en ? 'Archive workspace (keep history)' : 'খাতা আর্কাইভ (ইতিহাস থাকবে)')}</button>
        {(() => { const blocker = db.workspaceDeleteBlocker(editing.id); return <div className="border-t pt-3 space-y-2">
          {blocker && <p className="text-xs text-slate-500">{blocker}</p>}
          <label className="block">{en ? 'To delete an empty workspace, type DELETE' : 'খালি খাতা মুছতে DELETE লিখুন'}<input value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" className="block w-full p-3 border rounded-lg" /></label>
          <button className="p-3 bg-rose-700 text-white rounded-lg disabled:opacity-40" disabled={busy || imageLoading || !!blocker || confirmation !== DELETE_CONFIRMATION} onClick={() => mutate(() => { db.safeDeleteWorkspace(editing.id, confirmation); })}>{en ? 'Delete empty workspace' : 'খালি খাতা মুছুন'}</button>
        </div>; })()}
      </div>}
    </section>
  </div>, document.body);
}
