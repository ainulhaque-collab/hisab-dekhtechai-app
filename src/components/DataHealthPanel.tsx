import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { AppSelect } from './AppSelect';
import { primaryButton, secondaryButton } from './ModalShell';
import { formatBDT, fromBengaliDigits, parsePaisaString } from '../domain/money';
import { reconciliationFingerprint } from '../storage/reportMetadata';
import { verifyBackupRecovery } from '../storage/recoveryVerification';

export function DataHealthPanel({ onOpenSync, onOpenBackup }: { onOpenSync: () => void; onOpenBackup: () => void }) {
  const { db, currentWorkspace, language, syncStatus, durabilityInfo, transactions, refreshState } = useApp();
  const en = language === 'en';
  const [accountId,setAccountId] = useState('');
  const [actual,setActual] = useState('');
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(false);
  const [saved,setSaved] = useState(false);
  const [checkingRecovery,setCheckingRecovery] = useState(false);
  const [recovery,setRecovery] = useState<Awaited<ReturnType<typeof verifyBackupRecovery>> | null>(null);
  const [recoveryError,setRecoveryError] = useState(false);
  const money = (value:string) => formatBDT(value,{locale:language});
  const wallets = currentWorkspace ? db.getAllAccounts(currentWorkspace.id).filter(account=>(account.classification || 'asset')==='asset' && !account.id.startsWith('sl-account-') && !account.archivedAt) : [];
  const selected = wallets.find(account=>account.id===accountId);
  const balance = useMemo(()=>currentWorkspace && selected ? db.calculateAccountSummaries(currentWorkspace.id).find(row=>row.accountId===selected.id)?.currentBalanceMinor : undefined,[db,currentWorkspace,selected,transactions]);
  let actualMinor:string|undefined;
  try { if (/^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(actual.trim())) actualMinor = parsePaisaString(actual.trim()).toString(); } catch { /* Validation is visible on submit. */ }
  const metadata = useMemo(()=>{try{return currentWorkspace ? db.getReportMetadata(currentWorkspace.id) : null;}catch{return null;}},[db,currentWorkspace,transactions]);
  const failed = db.getSyncOutboxEntries().filter(entry=>entry.uploadedStatus==='failed').length;
  const timestamp = (value:string|null|undefined) => value ? new Date(value).toLocaleString(en?'en-GB':'bn-BD') : (en?'Not verified yet':'এখনও যাচাই হয়নি');
  const currentFingerprint = useMemo(()=>selected ? reconciliationFingerprint(selected,transactions) : null,[selected,transactions]);
  return <div className="space-y-4">
    <dl className="space-y-3 rounded-2xl border border-slate-100 p-4 text-xs">{[
      [en?'Local storage':'ডিভাইসের সংরক্ষণ',durabilityInfo.type],
      [en?'Latest local write':'সর্বশেষ স্থানীয় সংরক্ষণ',db.getLastPersistenceError() ? (en?'Needs attention — save failed':'মনোযোগ প্রয়োজন — সংরক্ষণ ব্যর্থ') : (en?'No reported write error':'সংরক্ষণে রিপোর্ট করা ত্রুটি নেই')],
      [en?'Waiting to sync':'সিঙ্কের অপেক্ষায়',syncStatus.pendingOutboxCount.toLocaleString(en?'en-GB':'bn-BD')],
      [en?'Failed uploads':'ব্যর্থ আপলোড',failed.toLocaleString(en?'en-GB':'bn-BD')],
      [en?'Last successful sync':'সর্বশেষ সফল সিঙ্ক',timestamp(syncStatus.lastSuccessfulSyncAt)],
      [en?'Verified Drive backup':'যাচাইকৃত Drive ব্যাকআপ',timestamp(syncStatus.lastCloudBackupAt)],
      [en?'Local recovery points':'স্থানীয় রিকভারি পয়েন্ট',db.getSnapshots().length.toLocaleString(en?'en-GB':'bn-BD')]
    ].map(([label,value])=><div key={label} className="flex flex-wrap justify-between gap-2"><dt className="text-slate-500">{label}</dt><dd className="break-words font-semibold text-slate-800">{value}</dd></div>)}</dl>
    <p className="rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">{en?'A verified backup timestamp confirms its integrity check, not an isolated restore drill. Recovery points stay on this device. Keep a separate downloaded copy too.':'যাচাইকৃত ব্যাকআপের সময়টি অখণ্ডতার পরীক্ষা বোঝায়, আলাদা পরিবেশে রিস্টোর পরীক্ষার প্রমাণ নয়। স্থানীয় রিকভারি পয়েন্ট এই ডিভাইসে থাকে। আলাদা ডাউনলোড করা কপিও রাখুন।'}</p>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><button type="button" onClick={onOpenSync} className={secondaryButton}>{en?'Sync details':'সিঙ্কের বিস্তারিত'}</button><button type="button" onClick={onOpenBackup} className={secondaryButton}>{en?'Backup & restore':'ব্যাকআপ ও রিস্টোর'}</button></div>
    <section className="space-y-3 rounded-2xl border border-slate-100 p-4"><h3 className="text-sm font-semibold text-slate-900">{en?'Test a recovery copy':'রিকভারি কপি পরীক্ষা করুন'}</h3><p className="text-xs leading-relaxed text-slate-600">{en?'Validate a fresh backup of this device in temporary memory, including saved media. This checks that the copy can be opened; it does not replace your records, upload anything or test remote availability.':'এই ডিভাইসের নতুন ব্যাকআপ কপি ও ছবিগুলো অস্থায়ী মেমোরিতে খুলে যাচাই করুন। বর্তমান হিসাব প্রতিস্থাপন বা কোথাও আপলোড হবে না। এতে দূরের সার্ভারে কপির উপস্থিতি পরীক্ষা হয় না।'}</p>
      <button type="button" disabled={checkingRecovery} className={`${secondaryButton} w-full`} onClick={async()=>{setCheckingRecovery(true);setRecovery(null);setRecoveryError(false);try{setRecovery(await verifyBackupRecovery(await db.exportBackupFile()));}catch{setRecoveryError(true);}finally{setCheckingRecovery(false);}}}>{checkingRecovery?(en?'Testing recovery…':'রিকভারি পরীক্ষা হচ্ছে…'):(en?'Run isolated recovery test':'আলাদা মেমোরিতে রিস্টোর পরীক্ষা')}</button>
      {recovery && <p role="status" className="text-xs text-emerald-700">{en?`Passed at ${timestamp(recovery.verifiedAt)}. ${recovery.transactions} journal records and ${recovery.media} saved media items restored in memory.`:`${timestamp(recovery.verifiedAt)}-এ সফল। ${recovery.transactions.toLocaleString('bn-BD')}টি জার্নাল ও ${recovery.media.toLocaleString('bn-BD')}টি ছবি অস্থায়ী মেমোরিতে ফিরেছে।`}</p>}
      {recoveryError && <p role="alert" className="text-xs text-rose-700">{en?'Recovery could not be verified. Keep the original records and a separate backup file; do not clear app data.':'রিকভারি যাচাই করা যায়নি। মূল হিসাব ও আলাদা ব্যাকআপ রাখুন; অ্যাপের ডেটা মুছবেন না।'}</p>}
    </section>
    <section className="space-y-4 rounded-2xl border border-slate-100 p-4"><h3 className="text-sm font-semibold text-slate-900">{en?'Check a wallet balance':'ওয়ালেটের ব্যালেন্স মেলান'}</h3><p className="text-xs leading-relaxed text-slate-600">{en?'Compare the real amount with this app. Saving a check records the difference and does not change wallet money. Review missing or incorrect entries in History.':'বাস্তব টাকার সঙ্গে অ্যাপের হিসাব তুলনা করুন। যাচাই সংরক্ষণ করলে অমিলের রেকর্ড থাকে; ওয়ালেটের টাকা বদলায় না। বাদ পড়া বা ভুল এন্ট্রি ইতিহাসে দেখে নিন।'}</p>
      {!metadata && <p role="alert" className="text-xs text-rose-700">{en?'Balance-check history could not load. Your financial entries remain saved.':'যাচাইয়ের ইতিহাস লোড হয়নি। আপনার হিসাব সংরক্ষিত আছে।'}</p>}
      <form className="space-y-3" onSubmit={async event=>{event.preventDefault();setError(false);setSaved(false);if(!currentWorkspace || !selected || actualMinor===undefined || !metadata){setError(true);return;}setBusy(true);try{await db.recordReconciliation(currentWorkspace.id,selected.id,actualMinor,note);refreshState();setSaved(true);setActual('');setNote('');}catch{setError(true);}finally{setBusy(false);}}}>
        <label className="block text-xs font-medium text-slate-700">{en?'Wallet':'ওয়ালেট'}<AppSelect aria-label={en?'Reconciliation wallet':'ব্যালেন্স যাচাইয়ের ওয়ালেট'} value={accountId} disabled={busy} onChange={event=>{setAccountId(event.target.value);setSaved(false);setActual('');}} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3"><option value="">{en?'Choose a wallet':'ওয়ালেট বেছে নিন'}</option>{wallets.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</AppSelect></label>
        {balance!==undefined && <p className="text-xs text-slate-600">{en?'App balance: ':'অ্যাপের ব্যালেন্স: '}<strong className="tabular-nums">{money(balance)}</strong></p>}
        <label className="block text-xs font-medium text-slate-700">{en?'Real balance (BDT)':'বাস্তব ব্যালেন্স (টাকা)'}<input inputMode="text" type="text" value={actual} disabled={busy} onChange={event=>setActual(fromBengaliDigits(event.target.value))} className="mt-2 w-full rounded-xl border border-slate-200 p-3" required /></label>
        {balance!==undefined && actualMinor!==undefined && <p role="status" className="text-xs text-slate-700">{en?'Difference: ':'অমিল: '}<strong className="tabular-nums">{money((BigInt(actualMinor)-BigInt(balance)).toString())}</strong></p>}
        <label className="block text-xs font-medium text-slate-700">{en?'Note (optional)':'নোট (ঐচ্ছিক)'}<input value={note} maxLength={240} disabled={busy} onChange={event=>setNote(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 p-3" /></label>
        <button type="submit" disabled={busy || !selected || !metadata} className={`${primaryButton} w-full`}>{busy?(en?'Saving…':'সংরক্ষণ হচ্ছে…'):(en?'Save balance check':'ব্যালেন্স যাচাই সংরক্ষণ করুন')}</button>
        {error && <p role="alert" className="text-xs text-rose-700">{en?'The check could not be saved. Check the amount and try again.':'যাচাই সংরক্ষণ হয়নি। টাকার পরিমাণ দেখে আবার চেষ্টা করুন।'}</p>}{saved && <p role="status" className="text-xs text-emerald-700">{en?'Check saved. No financial entry was created.':'যাচাই সংরক্ষিত হয়েছে। কোনো নতুন লেনদেন তৈরি হয়নি।'}</p>}
      </form>
      {selected && metadata && <div className="space-y-3">{metadata.reconciliations.filter(record=>record.accountId===selected.id).slice(0,10).map(record=><div key={record.id} className="rounded-xl bg-slate-50 p-3 text-xs"><p className="text-slate-500">{timestamp(record.createdAtUtc)}</p><p className="mt-2">{en?'Recorded app / real: ':'রেকর্ড করা অ্যাপ / বাস্তব: '}{money(record.expectedMinor)} / {money(record.actualMinor)}</p><p className="mt-1 font-semibold">{en?'Difference: ':'অমিল: '}{money((BigInt(record.actualMinor)-BigInt(record.expectedMinor)).toString())}</p><p className="mt-2 text-slate-500">{record.fingerprint===currentFingerprint?(en?'Wallet journal matches this check.':'এই যাচাইয়ের সঙ্গে ওয়ালেটের জার্নাল মিলে আছে।'):(en?'Wallet history changed after this check.':'যাচাইয়ের পর ওয়ালেটের ইতিহাস বদলেছে।')}</p>{record.note && <p className="mt-2 break-words text-slate-600">{record.note}</p>}</div>)}</div>}
    </section>
  </div>;
}
