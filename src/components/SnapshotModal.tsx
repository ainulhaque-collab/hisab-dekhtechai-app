import React, { useEffect, useRef, useState } from 'react';
import { Database, Download, Upload, RotateCcw, Plus, AlertCircle, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { LocalSnapshot } from '../contracts/types';
import { ModalShell, primaryButton, secondaryButton } from './ModalShell';
import { backupErrorMessage, openNativeBackupFile, readBackupFile, saveBackupFile, usesNativeBackupFiles } from '../storage/backupFiles';

export function SnapshotModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { db, refreshState, language } = useApp();
  const [snapshots, setSnapshots] = useState<LocalSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error?: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const en = language === 'en';
  useEffect(() => { if (isOpen) { setSnapshots(db.getSnapshots()); setStatus(null); } }, [db, isOpen]);
  if (!isOpen) return null;

  const run = async (action: () => Promise<void>, message: string) => {
    if (busy) return;
    setBusy(true); setStatus(null);
    try { await action(); setSnapshots(db.getSnapshots()); refreshState(); setStatus({ text: message }); }
    catch (error) { setStatus({ error: true, text: backupErrorMessage(error, en) }); }
    finally { setBusy(false); }
  };
  const importText = async (text: string) => {
    if (!window.confirm(en ? 'Add missing records from this backup? Current records and pending changes will be kept. Only import your own trusted backup.' : 'ব্যাকআপ থেকে অনুপস্থিত হিসাব যোগ করবেন? বর্তমান হিসাব ও পেন্ডিং পরিবর্তন রাখা হবে। নিজের বিশ্বস্ত ব্যাকআপ ব্যবহার করুন।')) throw new Error('CANCELLED');
    await db.importBackupFile(text);
  };
  const imported = en ? 'Backup checked and missing records added. Existing records were kept.' : 'ব্যাকআপ যাচাই করে অনুপস্থিত হিসাব যোগ হয়েছে। বর্তমান হিসাব রাখা হয়েছে।';
  return <ModalShell title={en ? 'Backup files & restore' : 'ব্যাকআপ ফাইল ও রিস্টোর'}
    description={en ? 'Keep a separate copy of your financial records.' : 'নিজের হিসাবের একটি আলাদা কপি রাখুন।'}
    icon={<Database className="h-5 w-5" />} onClose={onClose} busy={busy}>
    <div className="space-y-5">
      {status && <div role={status.error ? 'alert' : 'status'} className={`flex gap-2 rounded-xl border p-3 text-xs leading-relaxed ${status.error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
        {status.error ? <AlertCircle className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}<span>{status.text}</span>
      </div>}
      <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
        <h3 className="text-sm font-bold">{en ? 'A copy you can take with you' : 'আপনার কাছে রাখার কপি'}</h3>
        <p className="text-xs leading-relaxed text-slate-500">{en ? 'Includes all workspaces, accounts, journals and pending sync records. Files are not encrypted; keep them private. Workspace photos and device security settings are stored separately.' : 'সব খাতা, অ্যাকাউন্ট, লেনদেন ও পেন্ডিং সিঙ্ক এতে থাকবে। ফাইল এনক্রিপ্ট করা নয়—নিজের কাছে নিরাপদে রাখুন। খাতার ছবি ও ডিভাইসের নিরাপত্তা সেটিংস আলাদা থাকে।'}</p>
        <button type="button" disabled={busy} className={`${primaryButton} w-full`} onClick={() => run(async () => saveBackupFile(await db.exportBackupFile()),
          usesNativeBackupFiles() ? (en ? 'Backup file saved.' : 'ব্যাকআপ ফাইল সংরক্ষিত হয়েছে।') : (en ? 'Backup sent to your browser downloads. Check Downloads to find the file.' : 'ব্যাকআপ ব্রাউজারের ডাউনলোডে পাঠানো হয়েছে। Downloads-এ ফাইলটি দেখুন।'))}>
          <Download className="h-4 w-4" />{busy ? (en ? 'Working…' : 'কাজ হচ্ছে…') : (en ? 'Save backup file' : 'ব্যাকআপ ফাইল সেভ করুন')}
        </button>
        <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label={en ? 'Choose backup file' : 'ব্যাকআপ ফাইল নির্বাচন'} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (file) void run(async () => importText(await readBackupFile(file)), imported);
        }} />
        <button type="button" disabled={busy} className={`${secondaryButton} w-full`} onClick={() => {
          if (usesNativeBackupFiles()) void run(async () => importText(await openNativeBackupFile()), imported);
          else input.current?.click();
        }}><Upload className="h-4 w-4" />{en ? 'Import backup file' : 'ব্যাকআপ ফাইল আমদানি'}</button>
      </div>
      <div className="flex items-center justify-between gap-2"><div><h3 className="text-xs font-bold">{en ? 'On-device recovery points' : 'এই ডিভাইসের রিকভারি পয়েন্ট'}</h3><p className="mt-1 text-[11px] text-slate-400">{en ? 'These stay inside the app.' : 'এগুলো অ্যাপের ভেতরেই থাকে।'}</p></div>
        <button type="button" disabled={busy} className={secondaryButton} onClick={() => run(async () => { await db.captureRecoverySnapshot(); }, en ? 'Recovery point saved.' : 'রিকভারি পয়েন্ট সংরক্ষিত হয়েছে।')}><Plus className="h-4 w-4" />{en ? 'Create' : 'তৈরি করুন'}</button>
      </div>
      <div className="space-y-3">{[...snapshots].reverse().map(snap => <div key={snap.id} className="rounded-xl border border-slate-100 p-3.5 text-xs">
        <div className="font-semibold text-slate-700">{new Date(snap.createdAt).toLocaleString(en ? 'en-GB' : 'bn-BD')}</div>
        <p className="mt-1.5 text-[11px] text-slate-400">{en ? `${snap.totalTransactions} transactions · ${snap.pendingOutboxCount} pending changes` : `${snap.totalTransactions}টি লেনদেন · ${snap.pendingOutboxCount}টি পেন্ডিং পরিবর্তন`}</p>
        <button type="button" disabled={busy || !snap.dataJson} className={`${secondaryButton} mt-3 w-full`} onClick={() => {
          if (window.confirm(en ? 'Recover missing records from this point? Newer records will remain.' : 'এই পয়েন্ট থেকে অনুপস্থিত হিসাব ফিরিয়ে আনবেন? নতুন হিসাব রাখা হবে।')) void run(async () => {
            if (!await db.restoreFromSnapshot(snap.id)) throw new Error('BACKUP_INVALID');
          }, imported);
        }}><RotateCcw className="h-3.5 w-3.5" />{en ? 'Recover missing records' : 'অনুপস্থিত হিসাব ফিরিয়ে আনুন'}</button>
      </div>)}</div>
      {!snapshots.length && <p className="text-center text-xs text-slate-400">{en ? 'No recovery points yet.' : 'এখনও রিকভারি পয়েন্ট নেই।'}</p>}
    </div>
  </ModalShell>;
}
