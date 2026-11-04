import { Capacitor, registerPlugin } from '@capacitor/core';
import { MAX_BACKUP_BYTES } from './backup';

const nativeFiles = registerPlugin<{
  save(options: { name: string; text: string }): Promise<void>;
  open(): Promise<{ text: string }>;
}>('BackupFiles');
export const usesNativeBackupFiles = () => Capacitor.getPlatform() === 'android';

export async function saveBackupFile(text: string): Promise<void> {
  const name = `hisab-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  if (usesNativeBackupFiles()) return nativeFiles.save({ name, text });
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function openNativeBackupFile(): Promise<string> { return (await nativeFiles.open()).text; }
export async function readBackupFile(file: File): Promise<string> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('BACKUP_TOO_LARGE');
  return file.text();
}

export function backupErrorMessage(error: unknown, en: boolean): string {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, [string, string]> = {
    BACKUP_INVALID: ['This is not a valid Hisab backup file.', 'এটি সঠিক হিসাব ব্যাকআপ ফাইল নয়।'],
    BACKUP_CHECKSUM: ['The backup checksum does not match. Choose the original file.', 'ব্যাকআপের চেকসাম মিলছে না। মূল ফাইলটি নির্বাচন করুন।'],
    BACKUP_OWNER: ['This backup belongs to a different dataset owner. Open it with the original Google account.', 'ব্যাকআপটি ভিন্ন মালিকের। মূল গুগল অ্যাকাউন্টের ডাটাসেটে এটি খুলুন।'],
    BACKUP_CONFLICT: ['A financial record differs from an existing record. Nothing was replaced.', 'পুরোনো আর্থিক তথ্যের সাথে অমিল আছে। কোনো হিসাব প্রতিস্থাপন করা হয়নি।'],
    BACKUP_LEDGER: ['The backup contains an invalid or unbalanced journal.', 'ব্যাকআপের লেনদেন অসম্পূর্ণ বা হিসাব মেলেনি।'],
    BACKUP_VERSION: ['Update the app to open this backup version.', 'ব্যাকআপের এই সংস্করণ খুলতে অ্যাপ আপডেট করুন।'],
    BACKUP_TOO_LARGE: ['Choose a backup smaller than 40 MB.', '৪০ মেগাবাইটের চেয়ে ছোট ব্যাকআপ নির্বাচন করুন।'],
    CANCELLED: ['File selection cancelled.', 'ফাইল নির্বাচন বাতিল হয়েছে।'],
  };
  return messages[code]?.[en ? 0 : 1] || (en ? 'Backup could not finish. Check free storage and file permissions, then retry. Your records are still on this device.' : 'ব্যাকআপ শেষ হয়নি। খালি স্টোরেজ ও ফাইলের অনুমতি পরীক্ষা করে আবার চেষ্টা করুন। আপনার হিসাব এই ডিভাইসে আছে।');
}
