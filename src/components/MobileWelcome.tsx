import { ArrowRight, Wallet, Layers, ReceiptText, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AppearanceSettings } from './AppearanceSettings';
import { primaryButton, secondaryButton } from './ModalShell';

export default function MobileWelcome({onStart,onSignIn}:{onStart:()=>void;onSignIn:()=>void}){
  const {language,setLanguage,isOnline}=useApp(),en=language==='en';
  const steps=[
    {icon:Wallet,title:en?'Know where your money is':'টাকা কোথায় আছে জানুন',text:en?'Cash, bKash, Nagad and banks in one view.':'হাতে ক্যাশ, বিকাশ, নগদ ও ব্যাংক এক নজরে।'},
    {icon:Layers,title:en?'Keep your shares separate':'নিজের ও ব্যবসার হিসাব আলাদা',text:en?'Separate workspaces, one clear wallet total.':'খাতার বরাদ্দ আলাদা, ওয়ালেটের মোট টাকা পরিষ্কার।'},
    {icon:ReceiptText,title:en?'Add income and expenses':'সহজে জমা ও খরচ লিখুন',text:en?'Write it yourself, or use a photo or voice.':'নিজে লিখুন, অথবা ছবি ও ভয়েসের সাহায্য নিন।'},
  ];
  return <main className="app-layout min-h-dvh px-5 pb-safe pt-safe">
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-7 pb-7 pt-5">
      <header className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-bold text-slate-900"><span className="app-mobile-add flex h-9 w-9 items-center justify-center rounded-xl text-white"><Wallet className="h-5 w-5" aria-hidden="true"/></span>{en?'Hisab DekhteChai':'হিসাব দেখতে চাই'}</span><button type="button" className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-blue-700" onClick={()=>setLanguage(en?'bn':'en')}>{en?'বাংলা':'English'}</button></header>
      <section className="app-balance-card rounded-3xl border p-6 text-white"><div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10"><Wallet className="h-7 w-7 text-emerald-300" aria-hidden="true"/></div><h1 className="text-[28px] font-bold leading-snug">{en?'Your money. A clearer picture.':'টাকার হিসাব থাকুক সহজে।'}</h1><p className="mt-3 text-sm leading-relaxed text-blue-100">{en?'Start with your Personal workspace. Add other workspaces when you need them.':'প্রথমে ব্যক্তিগত খাতা দিয়ে শুরু করুন। প্রয়োজন হলে পরে অন্য খাতা যোগ করুন।'}</p></section>
      <ol className="space-y-5">{steps.map(step=><li key={step.title} className="flex items-start gap-3"><span className="rounded-xl bg-blue-50 p-3 text-blue-700"><step.icon className="h-5 w-5" aria-hidden="true"/></span><div><h2 className="text-sm font-semibold text-slate-900">{step.title}</h2><p className="mt-1 text-xs leading-relaxed text-slate-500">{step.text}</p></div></li>)}</ol>
      <fieldset><legend className="mb-3 text-xs font-semibold text-slate-600">{en?'Choose your screen':'পছন্দের পর্দা বেছে নিন'}</legend><AppearanceSettings en={en} compact/></fieldset>
      <div className="mt-auto space-y-3"><button type="button" className={`${primaryButton} w-full`} onClick={onStart}>{en?'Start keeping records':'হিসাব শুরু করুন'}<ArrowRight className="h-4 w-4" aria-hidden="true"/></button><button type="button" className={`${secondaryButton} w-full`} disabled={!isOnline} onClick={onSignIn}>{en?'Sign in with Google':'Google দিয়ে লগইন করুন'}</button><p className="flex items-center justify-center gap-2 text-center text-[11px] leading-relaxed text-slate-500"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true"/>{en?'You can start offline. Keep your own backup copy.':'অফলাইনেও শুরু করতে পারবেন। নিজের কাছে ব্যাকআপ কপি রাখুন।'}</p></div>
    </div>
  </main>;
}
