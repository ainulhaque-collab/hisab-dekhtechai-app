const messages:Record<string,[string,string]>={
  CLOUD_LOCAL_SIGN_OUT_FAILED:['লগইনের তথ্য পুরোপুরি পরিষ্কার করা যায়নি। আবার চেষ্টা করুন।','Sign-in details could not be fully cleared. Try again.'],
  CUSTOMER_REAUTH_REQUIRED:['পরিবর্তনের আগে আবার পরিচয় যাচাই করুন।','Verify your identity again before making changes.'],
  CUSTOMER_PRIMARY_EMAIL_CHANGE_REQUIRED:['আগে নতুন Google অ্যাকাউন্টের ইমেইলটি নিশ্চিত করে মূল ইমেইল হিসেবে রাখুন।','Confirm the new Google account’s email as your primary email first.'],
  CUSTOMER_LAST_SIGN_IN_METHOD:['শেষ Google লগইনটি সরানো যাবে না। আগে আরেকটি যুক্ত করুন।','Add another Google sign-in before removing this one.'],
  CUSTOMER_EMAIL_INVALID:['একটি সঠিক ইমেইল ঠিকানা লিখুন।','Enter a valid email address.'],
  CUSTOMER_CHANGE_IN_PROGRESS:['আগের যাচাই শেষ করুন অথবা বাতিল করে আবার শুরু করুন।','Finish verification or cancel it to start again.'],
  CUSTOMER_CHANGE_EXPIRED:['যাচাইয়ের সময় শেষ হয়েছে। বাতিল করে আবার শুরু করুন।','Verification has expired. Cancel it and start again.'],
  CLOUD_ACCOUNT_MISMATCH:['এই লগইন আগের অ্যাকাউন্টের সঙ্গে মেলেনি। সঠিক অ্যাকাউন্টে আবার লগইন করুন।','This sign-in did not match the expected account. Use the correct account.'],
  CLOUD_AUTH_CONFIG:['লগইন সার্ভারের সেটআপ এখনো সম্পূর্ণ হয়নি।','The sign-in service has not been configured yet.'],
  CLOUD_STORAGE_INVALID:['নিরাপদ লগইন স্টোরেজ পড়া যাচ্ছে না। ব্রাউজারের স্টোরেজ অনুমতি দেখুন অথবা অ্যাপ আপডেট করুন।','Secure sign-in storage could not be read. Check browser storage access or update the app.'],
  CLOUD_STORAGE_UNAVAILABLE:['লগইন নিরাপদে সংরক্ষণ করা যাচ্ছে না। ব্রাউজারের স্টোরেজ অনুমতি দেখুন অথবা অ্যাপ আপডেট করুন।','Secure sign-in storage is unavailable. Check browser storage access or update the app.'],
  CLOUD_NATIVE_UPDATE_REQUIRED:['লগইন করতে অ্যাপের আপডেট প্রয়োজন।','Update the app to sign in.'],
  CLOUD_NATIVE_RELEASE_REQUIRED:['অনুমোদিত সাইন করা অ্যাপ থেকে লগইন করুন।','Use the approved signed app to sign in.'],
  CLOUD_SIGN_IN_CANCELLED:['Google লগইন শেষ হয়নি। আবার চেষ্টা করতে পারেন।','Google sign-in was cancelled. You can try again.'],
  CLOUD_SIGN_IN_IN_PROGRESS:['Google-এর পর্দায় লগইন শেষ করুন, অথবা লগইন বাতিল করুন।','Finish on the Google screen, or cancel this sign-in.'],
  ACCOUNT_CHANGES_NOT_ENABLED:['লগইন পরিবর্তনের সুবিধাটি এখনো চালু হয়নি।','Changing sign-in details is not enabled yet.'],
};
export function accountSettingsError(code:string,en:boolean):string{
  return messages[code]?.[en?1:0]??(en?'The request could not finish. Your saved records have not been replaced. Try again.':'কাজটি সম্পূর্ণ হয়নি। সংরক্ষিত হিসাব বদলানো হয়নি। আবার চেষ্টা করুন।');
}
