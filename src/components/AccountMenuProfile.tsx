import React, { useSyncExternalStore } from 'react';
import { UserRound } from 'lucide-react';
import { accountSettingsSession } from '../auth/cloud/accountSettingsRuntime';
import type { AccountSettingsSession } from '../auth/cloud/accountSettingsSession';

export default function AccountMenuProfile({en,session=accountSettingsSession}:{en:boolean;session?:AccountSettingsSession}) {
  const state=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot);
  const account=['connected','offline'].includes(state.phase)?state.account:null;
  const label=account?(en?'Your account':'আপনার অ্যাকাউন্ট')
    :state.phase==='signed_out'?(en?'Signed out':'সাইন আউট হয়েছে')
    :state.phase==='error'?(en?'Check account connection':'অ্যাকাউন্টের সংযোগ যাচাই করুন')
    :state.phase==='offline'?(en?'Offline':'অফলাইন'):(en?'Checking account…':'অ্যাকাউন্ট যাচাই হচ্ছে…');
  return <div className="flex min-w-0 items-center gap-2.5" aria-live="polite">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700"><UserRound aria-hidden="true" className="h-4 w-4"/></span>
    <div className="min-w-0"><p className="font-bold text-slate-900">{label}</p>
      {account?.email?<><p className="mt-1 text-[10px] text-slate-500">{en?'Primary email':'মূল ইমেইল'}{state.phase==='offline'?(en?' · last verified':' · আগের যাচাইকৃত'):''}</p><p className="break-all text-[11px] text-slate-600">{account.email}</p></>
        :<p className="mt-1 text-[10px] text-slate-500">{en?'Local records stay on this device':'স্থানীয় হিসাব এই ডিভাইসে থাকবে'}</p>}
    </div>
  </div>;
}
