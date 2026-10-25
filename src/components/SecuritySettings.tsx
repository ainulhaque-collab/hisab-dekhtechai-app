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
  return <div className="space-y-3 p-3 border rounded-xl">
    <p>{en ? `App PIN: ${enabled ? 'On' : 'Off'}` : `অ্যাপ পিন: ${enabled ? 'চালু' : 'বন্ধ'}`}</p>
    <button className="p-2 border rounded-lg" onClick={() => choose('pin')}>{enabled ? (en ? 'Change PIN' : 'পিন পরিবর্তন') : (en ? 'Enable PIN' : 'পিন চালু করুন')}</button>
    {enabled && <button className="p-2 border rounded-lg ml-2" onClick={() => choose('remove')}>{en ? 'Disable PIN' : 'পিন বন্ধ করুন'}</button>}
    {biometric.isNative() && <div className="space-y-2 border-t pt-3">
      <p>{en ? 'Fingerprint / secure Face Unlock' : 'আঙুলের ছাপ / সুরক্ষিত ফেস আনলক'}</p>
      <p className="text-slate-500">{en ? 'Requires an enrolled Class 3 biometric and App PIN. Availability depends on your device. Use App PIN if biometrics are cancelled, unavailable or locked out.' : 'নিবন্ধিত নিরাপদ বায়োমেট্রিক ও অ্যাপ পিন প্রয়োজন। সক্ষমতা ডিভাইসের উপর নির্ভরশীল। বাতিল, অনুপলব্ধ বা লকআউট হলে অ্যাপ পিন ব্যবহার করুন।'}</p>
      <button className="p-2 border rounded-lg disabled:opacity-40" disabled={!enabled || (!status.available && !status.enabled)}
        onClick={() => choose(status.enabled ? 'biometric-off' : 'biometric-on')}>
        {status.enabled ? (en ? 'Disable biometric unlock' : 'বায়োমেট্রিক বন্ধ করুন') : (en ? 'Enable biometric unlock' : 'বায়োমেট্রিক চালু করুন')}
      </button>
    </div>}
    {action && <form className="space-y-3 border-t pt-3" onSubmit={async e => {
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
      {enabled && <label className="block">{en ? 'Current App PIN' : 'বর্তমান অ্যাপ পিন'}<input autoComplete="off" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={current} onChange={e => setCurrent(e.target.value.replace(/\D/g, ''))} className="block w-full p-3 border rounded-lg" required /></label>}
      {action === 'pin' && <>
        <label className="block">{en ? 'New four-digit PIN' : 'নতুন চার সংখ্যার পিন'}<input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="block w-full p-3 border rounded-lg" required /></label>
        <label className="block">{en ? 'Confirm PIN' : 'পিন নিশ্চিত করুন'}<input type="password" inputMode="numeric" maxLength={4} value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g, ''))} className="block w-full p-3 border rounded-lg" required /></label>
      </>}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      <button disabled={busy} className="p-3 bg-blue-700 text-white rounded-lg">{en ? 'Authenticate & Save' : 'যাচাই করে সংরক্ষণ করুন'}</button>
      <button type="button" disabled={busy} className="p-3" onClick={() => choose(null)}>{en ? 'Cancel' : 'বাতিল'}</button>
    </form>}
  </div>;
}
