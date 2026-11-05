export const walletFeatureEnabled=import.meta.env?.VITE_WALLET_ALLOCATION_ENABLED==='true';
export function walletActor(profile:{subjectId:string;subjectHash:string}|null):string|undefined{
  return profile&&profile.subjectId!=='local_user'?profile.subjectHash:undefined;
}
const errors:Record<string,[string,string]>={
  WALLET_TRANSACTION_ALREADY_CHANGED:['লেনদেনটি আগেই বদলেছে। ইতিহাস থেকে সর্বশেষ লেনদেনটি খুলুন।','This transaction has already changed. Open the latest record from History.'],
  WALLET_PHYSICAL_SHORTFALL:['মূল ওয়ালেটের মোট টাকায় ঘাটতি আছে। সব ওয়ালেট থেকে বরাদ্দ ও স্টেটমেন্ট মিলিয়ে নিন।','The physical wallet has insufficient funds. Reconcile its allocations and statement in All wallets.'],
  WALLET_HOME_REQUIRED:['প্রথম ব্যক্তিগত খাতা খুলে সব ওয়ালেট পরিচালনা করুন।','Open your first Personal workspace to manage all wallets.'],
  WALLET_CODE_NOT_FOUND:['আপনার ওয়ালেটের সঠিক কোড দিন।','Enter a valid code for one of your wallets.'],
  WALLET_OWNER_MISMATCH:['এই খাতা বা ওয়ালেট ব্যবহারের অনুমতি নেই।','This workspace or wallet is not available to this account.'],
  WALLET_LINK_CONFLICT:['অ্যাকাউন্টটি ইতিমধ্যে যুক্ত আছে। একই ওয়ালেটের জন্য খাতায় একটিই বরাদ্দ থাকবে।','An allocation is already linked. Each workspace has one allocation per wallet.'],
  WALLET_ACCOUNT_UNAVAILABLE:['একটি চালু ওয়ালেট বেছে নিন। আর্কাইভ করা হলে আগে ফিরিয়ে আনুন।','Choose an active wallet. Restore an archived allocation first.'],
  WALLET_INSUFFICIENT_ALLOCATION:['এই খাতায় যথেষ্ট খরচযোগ্য টাকা নেই। আগে বরাদ্দ স্থানান্তর করুন বা Goal-এর টাকা ছাড়ুন।','This workspace has insufficient spendable funds. Transfer an allocation or release goal funds first.'],
  WALLET_SYNC_INCOMPLETE:['স্থানান্তরের সব তথ্য এখনো আসেনি। সিঙ্ক সম্পূর্ণ হলে আবার চেষ্টা করুন।','Some linked transfer records are missing. Try after sync completes.'],
  WALLET_PROTECTED_TRANSFER:['স্থানান্তরের দুই পক্ষ একসঙ্গে রাখা হয়। ভুল হলে উল্টো দিকে নতুন স্থানান্তর করুন।','Both transfer sides are retained together. Correct a mistake with a new return transfer.'],
  WALLET_CODE_CONFLICT:['ওয়ালেটটি আগেই সংরক্ষিত হয়েছে। তালিকা দেখে আবার চেষ্টা করুন।','This wallet was already saved. Check the list before retrying.'],
  WALLET_TRANSFER_CONFLICT:['এই স্থানান্তরের তথ্য আগের অনুরোধের সঙ্গে মেলেনি। তালিকা যাচাই করুন।','The transfer differs from an existing request. Check its history.'],
  WALLET_TRANSFER_SAME_ACCOUNT:['অন্য একটি খাতা বা ওয়ালেট বেছে নিন।','Choose another allocation or wallet.'],
};
export function walletError(error:unknown,en:boolean){
  const code=error instanceof Error?error.message:'';
  return errors[code]?.[en?1:0]||(en?'Changes could not be saved. Your previous records are kept. Try again.':'পরিবর্তন সংরক্ষণ হয়নি। আগের হিসাব রাখা আছে। আবার চেষ্টা করুন।');
}
