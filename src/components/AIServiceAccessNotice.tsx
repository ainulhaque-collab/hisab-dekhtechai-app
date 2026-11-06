import {OPEN_ACCOUNT_SETTINGS} from '../access/nativePreview';
import type {ServiceAccessStatus} from '../access/serviceAccess';
import {primaryButton,secondaryButton} from './ModalShell';
export function AIServiceAccessNotice({en=false,signedIn,loading,status,error,onRefresh,onOpenAccount}:{en?:boolean;signedIn:boolean;loading:boolean;status:ServiceAccessStatus|null;error:string;onRefresh:()=>void;onOpenAccount?:()=>void}){
  const open=()=>{onOpenAccount?.();window.dispatchEvent(new Event(OPEN_ACCOUNT_SETTINGS));};
  const unverified=signedIn&&!status;
  return <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 text-sm">
    <p role="status">{!signedIn?(en?'Sign in with Google to use your AI permission.':'আপনার AI অনুমতি ব্যবহার করতে Google দিয়ে লগইন করুন।'):loading?(en?'Checking AI access…':'AI অনুমতি যাচাই হচ্ছে…'):unverified?(en?'AI permission has not been verified. You do not need a new redeem code to retry this check.':'AI অনুমতি যাচাই হয়নি। আবার যাচাই করতে নতুন রিডিম কোডের প্রয়োজন নেই।'):status?.blocked?(en?'AI access is blocked. Contact the Admin.':'AI ব্যবহার বন্ধ আছে। অ্যাডমিনের সঙ্গে যোগাযোগ করুন।'):(en?'Ask the Admin to allow your Gmail, or activate a redeem code in Account settings.':'অ্যাডমিনকে আপনার Gmail-এ অনুমতি দিতে বলুন, অথবা অ্যাকাউন্ট সেটিংসে রিডিম কোড ব্যবহার করুন।')}</p>
    {error&&<p role="alert" className="text-rose-700">{error}</p>}
    {unverified&&<button type="button" className={`${primaryButton} w-full`} disabled={loading} onClick={onRefresh}>{loading?(en?'Checking…':'যাচাই হচ্ছে…'):(en?'Try connection again':'সংযোগ আবার চেষ্টা করুন')}</button>}
    <button type="button" className={`${unverified?secondaryButton:primaryButton} w-full`} onClick={open}>{signedIn?(en?'Account & AI access':'অ্যাকাউন্ট ও AI অনুমতি'):(en?'Sign in with Google':'Google দিয়ে লগইন করুন')}</button>
    {signedIn&&!unverified&&<button type="button" className={`${secondaryButton} w-full`} disabled={loading} onClick={onRefresh}>{en?'Check permission again':'অনুমতি আবার যাচাই করুন'}</button>}
    <p className="text-xs text-slate-500">{en?'This checks permission only; no media is sent to AI. Manual entries remain available.':'এখানে শুধু অনুমতি যাচাই হয়; কোনো ছবি বা ভয়েস AI-তে যায় না। নিজে লেনদেন যোগ করতে পারবেন।'}</p>
  </div>;
}
