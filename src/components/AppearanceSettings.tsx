import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun, Check } from 'lucide-react';
import { appearanceSnapshot, chooseAppearance, subscribeAppearance, type AppearancePreference } from '../appearance/mobileAppearance';

export function AppearanceSettings({ en, compact=false }: { en: boolean; compact?: boolean }) {
  const snapshot = useSyncExternalStore(subscribeAppearance, appearanceSnapshot, () => 'system:light');
  const [selected, effective] = snapshot.split(':');
  const choices: Array<{ id: AppearancePreference; label: string; description: string; icon: typeof Sun }> = [
    { id: 'system', label: en ? 'Follow phone' : 'ফোনের মতো', description: en ? 'Changes with your device' : 'ফোনের সেটিংস অনুযায়ী বদলাবে', icon: Monitor },
    { id: 'light', label: en ? 'Light' : 'লাইট', description: en ? 'Bright and clear' : 'উজ্জ্বল ও পরিষ্কার', icon: Sun },
    { id: 'dark', label: en ? 'Dark' : 'ডার্ক', description: en ? 'A softer screen in low light' : 'কম আলোয় আরামদায়ক পর্দা', icon: Moon },
  ];
  if (compact) return <div className="grid grid-cols-3 gap-2">{choices.map(choice => <button type="button" key={choice.id} aria-pressed={selected === choice.id} onClick={() => chooseAppearance(choice.id)} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-2 text-xs font-medium ${selected === choice.id ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500'}`}><choice.icon className="h-4 w-4" aria-hidden="true" />{choice.label}</button>)}</div>;
  return <div className="space-y-4">
    <p className="text-sm leading-relaxed text-slate-500">{en ? 'Choose the appearance you find easiest to read. This device remembers your choice.' : 'যে পর্দায় পড়তে সুবিধা হয় সেটি বেছে নিন। এই ডিভাইসে আপনার পছন্দ মনে থাকবে।'}</p>
    <div className="space-y-3">{choices.map(choice => <button type="button" key={choice.id} aria-pressed={selected === choice.id} onClick={() => chooseAppearance(choice.id)}
      className={`app-appearance-option flex min-h-20 w-full items-center gap-4 rounded-2xl border p-4 text-left ${selected === choice.id ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'}`}>
      <span className="rounded-xl bg-slate-50 p-3 text-blue-700"><choice.icon className="h-5 w-5" aria-hidden="true" /></span>
      <span className="flex-1"><span className="block text-sm font-semibold text-slate-900">{choice.label}</span><span className="mt-1 block text-xs leading-relaxed text-slate-500">{choice.description}</span></span>
      <span className={`flex h-6 w-6 items-center justify-center rounded-full ${selected === choice.id ? 'bg-blue-700 text-white' : 'border border-slate-300'}`}>{selected === choice.id && <Check className="h-4 w-4" aria-hidden="true" />}</span>
    </button>)}</div>
    <p role="status" className="rounded-2xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-500">{en ? `Now using ${effective === 'dark' ? 'Dark' : 'Light'} mode. You can change it at any time.` : `এখন ${effective === 'dark' ? 'ডার্ক' : 'লাইট'} মোড চলছে। যেকোনো সময় বদলাতে পারবেন।`}</p>
  </div>;
}
