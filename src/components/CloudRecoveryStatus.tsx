import {useApp} from '../context/AppContext';
import {useRecovery} from '../sync/recovery/runtime';
export function CloudRecoveryStatus(){const {db,language}=useApp(),en=language==='en';const {state}=useRecovery(db);
  return <button type="button" onClick={()=>window.dispatchEvent(new Event('hisab-open-cloud-backup'))} className="mb-4 w-full rounded-2xl border border-blue-200 bg-blue-50 p-3 text-left text-xs font-medium text-blue-900">
    {state.phase==='verified'?(en?'Cloud backup verified':'ক্লাউড ব্যাকআপ যাচাই হয়েছে'):state.phase==='working'?(en?'Cloud backup checking…':'ক্লাউড ব্যাকআপ যাচাই হচ্ছে…'):state.phase==='error'?(en?'Cloud backup incomplete · tap to check':'ক্লাউড ব্যাকআপ অসম্পূর্ণ · যাচাই করুন'):(en?'Saved locally · tap to set up/check cloud backup':'ফোনে সংরক্ষিত · ক্লাউড ব্যাকআপ চালু/যাচাই করুন')}
    {state.verifiedAt&&<span className="mt-1 block text-[11px]">{en?'Last verified: ':'শেষ যাচাই: '}{new Date(state.verifiedAt).toLocaleString(en?'en-GB':'bn-BD')}</span>}
  </button>;
}
