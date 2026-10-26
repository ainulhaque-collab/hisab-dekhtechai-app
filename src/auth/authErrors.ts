/** Only actionable public messages; never surface raw tokens, owner hashes or response bodies. */
export function googleErrorMessage(error: unknown, en: boolean): string {
  const text = error instanceof Error ? error.message : String(error);
  const pick = (english: string, bengali: string) => en ? english : bengali;
  if (text.includes('GOOGLE_INSECURE_ORIGIN')) return pick(
    'Google Drive cannot connect from this LAN HTTP address. For phone testing, use USB port forwarding and localhost, or an authorized HTTPS address. File backups work here.',
    'এই LAN HTTP ঠিকানায় গুগল ড্রাইভ সংযোগ হয় না। ফোনে পরীক্ষার জন্য USB port forwarding দিয়ে localhost, অথবা অনুমোদিত HTTPS ঠিকানা ব্যবহার করুন। এখানে ফাইল ব্যাকআপ চলবে।');
  if (/popup|cancel|access_denied/i.test(text)) return pick('Allow the Google sign-in popup and Drive app storage permission, then retry.', 'গুগল সাইন-ইন পপআপ ও ড্রাইভ অ্যাপ স্টোরেজের অনুমতি দিয়ে আবার চেষ্টা করুন।');
  if (/origin|client|signing certificate|OAuth package/i.test(text) && !/library/.test(text)) return pick('Google rejected this build or address. The app owner must authorize its web origin or Android package and signing certificate.', 'গুগল এই বিল্ড বা ঠিকানা অনুমোদন করেনি। অ্যাপের মালিককে web origin অথবা Android package ও signing certificate অনুমোদন করতে হবে।');
  if (/owner|reassign|Foreign|subject/i.test(text)) return pick('Use the Google account that owns these records. Existing records have not been reassigned.', 'এই হিসাবের মূল মালিকের গুগল অ্যাকাউন্ট ব্যবহার করুন। হিসাবের মালিকানা বদলানো হয়নি।');
  if (/Quota|quota|storage.*full/i.test(text)) return pick('Google Drive storage is full. Free some space, then retry.', 'গুগল ড্রাইভের স্টোরেজ পূর্ণ। জায়গা খালি করে আবার চেষ্টা করুন।');
  if (/401|403|permission|AUTH_REQUIRED|authorization|Reconnect/i.test(text)) return pick('Reconnect Google Drive using the original account and allow private app storage access.', 'মূল অ্যাকাউন্ট দিয়ে ড্রাইভ পুনরায় যুক্ত করুন ও ব্যক্তিগত অ্যাপ স্টোরেজের অনুমতি দিন।');
  if (/loading|offline|network|fetch|internet/i.test(text)) return pick('Check your internet connection. If Google sign-in is still loading, wait and retry.', 'ইন্টারনেট পরীক্ষা করুন। গুগল সাইন-ইন লোড হতে থাকলে একটু অপেক্ষা করে আবার চেষ্টা করুন।');
  return pick('Sync could not finish. Local records and pending changes are kept. Retry or reconnect Google Drive.', 'সিঙ্ক শেষ হয়নি। স্থানীয় হিসাব ও পেন্ডিং পরিবর্তন রাখা হয়েছে। আবার চেষ্টা করুন অথবা গুগল ড্রাইভ পুনরায় যুক্ত করুন।');
}
