import { Users,ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ModalShell,secondaryButton } from './ModalShell';

/** A local permission row does not verify a recipient or enable shared sync. */
export function TeamSharingModal({isOpen,onClose}:{isOpen:boolean;onClose:()=>void}) {
  const {currentWorkspace,accountPermissions,language}=useApp(),en=language==='en';
  if(!isOpen)return null;
  const records=accountPermissions.filter(record=>record.workspaceId===currentWorkspace?.id);
  return <ModalShell title={en?'Team & employee sharing':'টিম ও কর্মী শেয়ারিং'} description={currentWorkspace?.name||''} icon={<Users className="h-5 w-5"/>} onClose={onClose}>
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900"><h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4"/>{en?'Verified sharing is not enabled yet':'যাচাইকৃত শেয়ারিং এখনও চালু হয়নি'}</h3>
        <p>{en?'Google Drive currently synchronizes your own devices. It does not give someone else access to your private Drive records.':'বর্তমান Google Drive সংযোগ আপনার নিজের ডিভাইসগুলো সিঙ্ক করে। এতে অন্য ব্যক্তি আপনার ব্যক্তিগত Drive-এর হিসাব দেখার অনুমতি পান না।'}</p>
        <p>{en?'Employee access requires verified Google identity, an accepted invitation, wallet-specific permissions and a coordinated server. New invitations will become available after those checks are ready.':'কর্মীকে যুক্ত করতে যাচাইকৃত Google পরিচয়, আমন্ত্রণ গ্রহণ, ওয়ালেটভিত্তিক অনুমতি এবং সমন্বয়কারী সার্ভার লাগবে। এসব যাচাই প্রস্তুত হওয়ার পর নতুন আমন্ত্রণ চালু হবে।'}</p>
      </div>
      <button type="button" disabled className={`${secondaryButton} w-full opacity-50`}>{en?'Invite employee — setup pending':'কর্মী আমন্ত্রণ — সেটআপ বাকি'}</button>
      {!!records.length&&<section className="space-y-3"><h3 className="text-sm font-semibold">{en?'Previous local permission records':'আগের স্থানীয় অনুমতির রেকর্ড'}</h3><p className="text-xs text-slate-500">{en?'Kept for review. They do not confirm that a recipient signed in or received data.':'পর্যালোচনার জন্য রাখা আছে। এগুলো কর্মীর লগইন বা ডেটা পাওয়ার প্রমাণ নয়।'}</p>{records.map(record=><div key={record.id} className="space-y-2 rounded-xl border border-slate-100 p-3 text-xs"><p className="break-all font-semibold">{record.employeeEmail}</p><p className="text-slate-500">{record.role} · {record.accountIds.length.toLocaleString(en?'en-GB':'bn-BD')} {en?'wallets':'ওয়ালেট'} · {record.revokedAt?(en?'Locally revoked':'স্থানীয়ভাবে বাতিল'):(en?'Unverified local record':'যাচাইহীন স্থানীয় রেকর্ড')}</p></div>)}</section>}
      {currentWorkspace?.kind!=='business'&&<p className="text-xs text-slate-500">{en?'Team access is planned for business workspaces.':'টিমের অনুমতি ব্যবসায়িক খাতার জন্য পরিকল্পিত।'}</p>}
    </div>
  </ModalShell>;
}
