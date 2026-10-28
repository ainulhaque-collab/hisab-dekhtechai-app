import { getFirebaseSenderAccessToken } from './keylessIdentity.mjs';
import type { PushDevice } from './store.js';
import { PushError, pushHash } from './store.js';

export type PushKind = 'transaction' | 'test';
export type PushSendResult = 'accepted' | 'expired' | 'unavailable';
export interface PushSender { send(devices: PushDevice[], kind: PushKind, event: string): Promise<PushSendResult[]> }
export const PUSH_WEB_ORIGIN = 'https://hisab-dekhtechai-app-git-codex-gemini-f24f70-ainulhaque-collab.vercel.app';
export function pushMessage(device: PushDevice, kind: PushKind, event: string) {
  const body = kind === 'test'
    ? device.language === 'bn' ? 'নোটিফিকেশন চালু আছে। এটি একটি পরীক্ষার বার্তা।' : 'Notifications are ready. This is a test message.'
    : device.language === 'bn' ? 'একটি লেনদেন সংরক্ষিত হয়েছে। বিস্তারিত দেখতে অ্যাপ খুলুন।' : 'A transaction was saved. Open Hisab to view your records.';
  const tag = pushHash(event).slice(0, 32);
  return { token: device.token, notification: { title: 'Hisab DekhteChai', body },
    data: { kind, event: tag },
    android: { priority: 'normal', ttl: '3600s', notification: { channel_id: 'hisab_transactions', tag, visibility: 'PRIVATE', icon: 'ic_stat_hisab' } },
    webpush: { headers: { TTL: '3600' }, notification: { tag }, fcm_options: { link: `${PUSH_WEB_ORIGIN}/` } } };
}

export class FCMPushSender implements PushSender {
  constructor(private fetchFn = fetch, private accessToken = () => getFirebaseSenderAccessToken()) {}
  async send(devices: PushDevice[], kind: PushKind, event: string) {
    if (!devices.length) return [];
    let credential: string;
    try { const value = await this.accessToken(); if (!value) throw new Error(); credential = value; } catch { throw new PushError('PUSH_SENDER_UNAVAILABLE'); }
    return Promise.all(devices.map(async (device): Promise<PushSendResult> => {
      try {
        const response = await this.fetchFn('https://fcm.googleapis.com/v1/projects/hisab-dekhtechai-notifications/messages:send', {
          method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: pushMessage(device, kind, event) }), signal: AbortSignal.timeout(10000), redirect: 'error' });
        if (response.ok) return 'accepted';
        const value = await response.json();
        const expired = response.status === 404 && value?.error?.details?.some((detail: any) =>
          detail?.['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' && detail.errorCode === 'UNREGISTERED');
        return expired ? 'expired' : 'unavailable';
      } catch { return 'unavailable'; }
    }));
  }
}
