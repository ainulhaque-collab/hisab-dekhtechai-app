import { LockKeyhole, Fingerprint, ShieldCheck, LoaderCircle, AlertCircle } from 'lucide-react';
import { primaryButton, secondaryButton, fieldClass } from './ModalShell';
import React, { useEffect, useState } from 'react';
import { pinLock } from '../security/pinLock';
import { biometric } from '../security/biometric';

export function SecuritySettings({ language }: { language: 'en' | 'bn' }) {
  const en = language === 'en';
  const [enabled, setEnabled] = useState(pinLock.isEnabled());
  const [status, setStatus] = useState({ available: false, enabled: false });
  const [action, setAction] = useState<'pin' | 'remove' | 'biometric-on' | 'biometric-off' | null>(null);
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { biometric.status().then(setStatus).catch(() => {}); }, []);
  const choose = (next: typeof action) => { setAction(next); setCurrent(''); setPin(''); setConfirm(''); setError(''); };
  return <div className="space-y-4 py-1">
    <div className="rounded-2xl border border-slate-200/70 bg-white p-4">
    <div className="flex items-center gap-3 mb-3"><div className="h-9 w-9 flex items-center justify-center rounded-xl bg-blue-50 text-blue-700"><LockKeyhole className="h-4 w-4" /></div><div className="flex-1"><p className="text-xs font-bold text-slate-800">{en ? 'App PIN' : 'অ্যাপ পিন'}</p><p className="mt-1 text-[10px] text-slate-400">{en ? 'A little protection for your private records.' : 'ব্যক্তিগত হিসাবের জন্য বাড়তি সুরক্ষা।'}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{enabled ? (en ? 'On' : 'চালু') : (en ? 'Off' : 'বন্ধ')}</span></div>
    <button className={`${secondaryButton} !min-h-9 !py-2 !text-[11px]`} onClick={() => choose('pin')}>{enabled ? (en ? 'Change PIN' : 'পিন পরিবর্তন') : (en ? 'Enable PIN' : 'পিন চালু করুন')}</button>
    {enabled && <button className="ml-3 text-[11px] font-semibold text-slate-400 hover:text-rose-600" onClick={() => choose('remove')}>{en ? 'Disable PIN' : 'পিন বন্ধ করুন'}</button>}
    </div>
    {biometric.isNative() && <div className="space-y-3 rounded-2xl border border-slate-200/70 p-4">
      <div className="flex items-center gap-2.5 text-xs font-bold text-slate-800"><Fingerprint className="h-5 w-5 text-blue-600" />{en ? 'Fingerprint & secure face' : 'আঙুলের ছাপ ও সুরক্ষিত ফেস আনলক'}</div>
      <p className="text-[11px] leading-relaxed text-slate-400">{en ? 'Requires an enrolled Class 3 biometric and App PIN. Availability depends on your device. Use App PIN if biometrics are cancelled, unavailable or locked out.' : 'নিবন্ধিত নিরাপদ বায়োমেট্রিক ও অ্যাপ পিন প্রয়োজন। সক্ষমতা ডিভাইসের উপর নির্ভরশীল। বাতিল, অনুপলব্ধ বা লকআউট হলে অ্যাপ পিন ব্যবহার করুন।'}</p>
      <button className={`${secondaryButton} !min-h-9 !py-2 !text-[11px]`} disabled={!enabled || (!status.available && !status.enabled)}
        onClick={() => choose(status.enabled ? 'biometric-off' : 'biometric-on')}>
        {status.enabled ? (en ? 'Disable biometric unlock' : 'বায়োমেট্রিক বন্ধ করুন') : (en ? 'Enable biometric unlock' : 'বায়োমেট্রিক চালু করুন')}
      </button>
    </div>}
    {action && <form className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/30 p-4" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setError('');
      try {
        if (enabled) { const result = await pinLock.verifyPin(current); if (!result.success) throw new Error(result.error); }
        if (action === 'pin') {
          if (pin !== confirm) throw new Error(en ? 'PINs do not match.' : 'পিন মেলেনি।');
          await pinLock.setPin(pin);
        } else if (action === 'remove') { await biometric.disable(current); pinLock.removePin(); }
        else if (action === 'biometric-on') await biometric.enable(current);
        else await biometric.disable(current);
        setEnabled(pinLock.isEnabled()); setStatus(await biometric.status()); choose(null);
      } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    }}>
      {enabled && <label className="block text-[11px] font-semibold text-slate-600">{en ? 'Current App PIN' : 'বর্তমান অ্যাপ পিন'}<input autoComplete="off" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={current} onChange={e => setCurrent(e.target.value.replace(/\D/g, ''))} className={fieldClass} required /></label>}
      {action === 'pin' && <>
        <label className="block text-[11px] font-semibold text-slate-600">{en ? 'New four-digit PIN' : 'নতুন চার সংখ্যার পিন'}<input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className={fieldClass} required /></label>
        <label className="block text-[11px] font-semibold text-slate-600">{en ? 'Confirm PIN' : 'পিন নিশ্চিত করুন'}<input type="password" inputMode="numeric" maxLength={4} value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))} className={fieldClass} required /></label>
      </>}
      {error && <p role="alert" className="flex gap-2 text-xs text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</p>}
      <button disabled={busy} className={primaryButton}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{en ? 'Authenticate & Save' : 'যাচাই করে সংরক্ষণ করুন'}</button>
      <button type="button" disabled={busy} className="ml-3 p-2 text-xs font-semibold text-slate-500" onClick={() => choose(null)}>{en ? 'Cancel' : 'বাতিল'}</button>
    </form>}
  </div>;
}
