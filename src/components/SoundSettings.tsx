import React from 'react';
import { Play, Volume2, Vibrate } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { soundService } from '../services/soundService';

export function SoundSettings() {
  const { soundPrefs, setSoundPrefs, language } = useApp();
  const en = language === 'en';
  return <div className="space-y-5">
    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4"><Volume2 className="h-5 w-5 text-blue-600" /><span className="flex-1 text-sm font-semibold">{en ? 'Transaction sounds' : 'লেনদেনের শব্দ'}</span><input type="checkbox" className="h-5 w-5 accent-blue-700" checked={soundPrefs.soundsEnabled} onChange={e => setSoundPrefs({ soundsEnabled: e.target.checked })} /></label>
    <label className="block rounded-2xl border border-slate-200 p-4 text-xs font-semibold text-slate-600">{en ? 'Sound volume' : 'শব্দের মাত্রা'} <span className="float-right tabular-nums">{Math.round(soundPrefs.soundVolume * 100)}%</span><input aria-label={en ? 'Sound volume' : 'শব্দের মাত্রা'} className="mt-4 w-full accent-blue-700" type="range" min="0" max="1" step="0.05" value={soundPrefs.soundVolume} onChange={e => setSoundPrefs({ soundVolume: Number(e.target.value) })} /></label>
    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4"><Vibrate className="h-5 w-5 text-blue-600" /><span className="flex-1 text-sm font-semibold">{en ? 'Haptic feedback' : 'হালকা কম্পন'}</span><input type="checkbox" className="h-5 w-5 accent-blue-700" checked={soundPrefs.hapticsEnabled} onChange={e => setSoundPrefs({ hapticsEnabled: e.target.checked })} /></label>
    <div><h3 className="mb-3 text-xs font-semibold text-slate-500">{en ? 'Preview sounds' : 'শব্দ শুনে দেখুন'}</h3><div className="grid grid-cols-3 gap-2">{(['income', 'expense', 'transfer'] as const).map((type, i) => <button type="button" key={type} onClick={() => soundService.playTransactionSuccess(type)} className="flex min-h-14 flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-blue-50"><Play className="h-4 w-4 text-blue-600" />{(en ? ['Income', 'Expense', 'Transfer'] : ['জমা', 'খরচ', 'ট্রান্সফার'])[i]}</button>)}</div><p className="mt-3 text-[11px] leading-relaxed text-slate-400">{en ? 'Previewing a sound never creates a transaction.' : 'শব্দ শুনে দেখলে কোনো লেনদেন তৈরি হয় না।'}</p></div>
  </div>;
}
