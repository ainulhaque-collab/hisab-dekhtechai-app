import { EntryDraft, validateEntryDraft } from './entryDraft';
import { ExtractionInput, validateExtractionMedia } from './media';

export interface AIIdentity {
  isTestMode(): boolean;
  getValidAccessToken(): Promise<string>;
  getProfile(): { subjectHash: string } | null;
}
export interface ExtractionResult { draft: EntryDraft; provider: string; sourceSha256: string; requestId: string }

export function aiEndpoint(base: string, pageOrigin: string): string {
  if (!base) return `${pageOrigin}/api/ai/extract`;
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('AI_NOT_CONFIGURED');
  return `${url.origin}/api/ai/extract`;
}

/** A response is still untrusted after HTTPS; it may only fill a review form. */
export function validateExtractionResult(raw: any, sourceSha256: string, requestId: string): ExtractionResult {
  if (!raw || raw.requestId !== requestId || raw.sourceSha256 !== sourceSha256 ||
      !['gemini', 'openai'].includes(raw.provider) || raw.draft?.requiresConfirmation !== true)
    throw new Error('AI_RESPONSE_INVALID');
  const { requiresConfirmation: _, ...fields } = raw.draft;
  return { requestId, sourceSha256, provider: raw.provider, draft: validateEntryDraft(fields) };
}

export async function extractEntry(input: ExtractionInput, ownerHash: string, identity: AIIdentity,
  settings: { endpoint: string; signal?: AbortSignal; fetchFn?: typeof fetch; requestId?: string }) {
  const { sourceSha256 } = validateExtractionMedia(input);
  if (identity.isTestMode()) throw new Error('AI_AUTH_REQUIRED');
  let token: string;
  try { token = await identity.getValidAccessToken(); } catch { throw new Error('AI_AUTH_REQUIRED'); }
  if (settings.signal?.aborted) throw new Error('AI_CANCELLED');
  if (identity.getProfile()?.subjectHash !== ownerHash) throw new Error('AI_OWNER_MISMATCH');
  const requestId = settings.requestId || crypto.randomUUID();
  let response: Response;
  try {
    response = await (settings.fetchFn || fetch)(settings.endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerHash, requestId, input }), credentials: 'omit', cache: 'no-store', redirect: 'error',
      signal: settings.signal ? AbortSignal.any([settings.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error(settings.signal?.aborted ? 'AI_CANCELLED' : 'AI_NETWORK_ERROR');
  }
  if (identity.getProfile()?.subjectHash !== ownerHash || settings.signal?.aborted) throw new Error('AI_OWNER_MISMATCH');
  // Never display an HTML host error or a raw provider error in the app.
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('AI_NOT_CONFIGURED');
  let raw: any;
  try {
    const text = await response.text();
    if (text.length > 40_000) throw new Error();
    raw = JSON.parse(text);
  } catch { throw new Error('AI_RESPONSE_INVALID'); }
  if (identity.getProfile()?.subjectHash !== ownerHash || settings.signal?.aborted) throw new Error('AI_OWNER_MISMATCH');
  if (!response.ok) {
    const allowed = ['AI_AUTH_REQUIRED', 'AI_OWNER_MISMATCH', 'AI_LIMIT_REACHED', 'AI_NOT_CONFIGURED',
      'AI_REQUEST_ALREADY_USED', 'AI_AUTH_UNAVAILABLE', 'AI_LIMIT_UNAVAILABLE', 'AI_RESPONSE_INVALID', 'AI_MODEL_UNAVAILABLE',
      'AI_PROVIDER_BUSY', 'AI_PROVIDER_QUOTA', 'AI_PROVIDER_AUTH_ERROR', 'AI_CONTENT_BLOCKED', 'AI_RESPONSE_INCOMPLETE',
      'AI_ORIGIN_DENIED', 'AI_MEDIA_TOO_LARGE', 'AI_MEDIA_OR_CONSENT_INVALID'];
    throw new Error(allowed.includes(raw?.error) ? raw.error : 'AI_PROVIDER_UNAVAILABLE');
  }
  return validateExtractionResult(raw, sourceSha256, requestId);
}

export function aiErrorMessage(error: unknown, isEn: boolean) {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, [string, string]> = {
    AI_NOT_CONFIGURED: ['AI entry is not enabled yet. You can still enter transactions manually.', 'AI এন্ট্রি এখনও চালু হয়নি। সাধারণভাবে লেনদেন যোগ করতে পারবেন।'],
    AI_AUTH_REQUIRED: ['Connect your Google account, then try again.', 'Google অ্যাকাউন্ট সংযুক্ত করে আবার চেষ্টা করুন।'],
    AI_OWNER_MISMATCH: ['The Google account changed. Close this draft and use the original account.', 'Google অ্যাকাউন্ট বদলেছে। খসড়াটি বন্ধ করে আগের অ্যাকাউন্ট ব্যবহার করুন।'],
    AI_LIMIT_REACHED: ['The AI usage limit has been reached. Try later or enter manually.', 'AI ব্যবহারের সীমা শেষ হয়েছে। পরে চেষ্টা করুন অথবা নিজে এন্ট্রি দিন।'],
    AI_NETWORK_ERROR: ['AI did not respond. Check your connection before trying again.', 'AI-এর উত্তর পাওয়া যায়নি। আবার চেষ্টা করার আগে ইন্টারনেট পরীক্ষা করুন।'],
    AI_REQUEST_ALREADY_USED: ['This request was already processed. Review the existing result or start a new request.', 'এই অনুরোধটি আগেই নেওয়া হয়েছে। আগের ফল দেখুন অথবা নতুন করে চেষ্টা করুন।'],
    AI_RESPONSE_INVALID: ['The AI draft could not be verified. Review the source and try again.', 'AI খসড়া যাচাই করা যায়নি। রিসিপ্ট বা অডিও দেখে আবার চেষ্টা করুন।'],
    AI_MODEL_UNAVAILABLE: ['AI entry is unavailable right now. Try later or enter manually.', 'AI এন্ট্রি এখন পাওয়া যাচ্ছে না। পরে চেষ্টা করুন অথবা নিজে এন্ট্রি দিন।'],
    AI_PROVIDER_BUSY: ['Google AI is temporarily busy. You can try creating the draft again or enter manually.', 'Google AI এখন সাময়িকভাবে ব্যস্ত। আবার খসড়া তৈরি করতে পারেন অথবা নিজে এন্ট্রি দিন।'],
    AI_PROVIDER_QUOTA: ['The Google AI usage limit has been reached. Try later or enter manually.', 'Google AI-এর ব্যবহারসীমা শেষ হয়েছে। পরে চেষ্টা করুন অথবা নিজে এন্ট্রি দিন।'],
    AI_PROVIDER_AUTH_ERROR: ['AI entry needs attention from support. You can still enter transactions manually.', 'AI এন্ট্রির জন্য সহায়তা প্রয়োজন। আপাতত নিজে লেনদেন যোগ করতে পারবেন।'],
    AI_AUTH_UNAVAILABLE: ['Google sign-in could not be verified right now. Check your connection and try again.', 'Google সংযোগ এখন যাচাই করা যাচ্ছে না। ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।'],
    AI_LIMIT_UNAVAILABLE: ['AI usage could not be checked right now. Try later or enter manually.', 'AI ব্যবহারের অনুমতি এখন যাচাই করা যাচ্ছে না। পরে চেষ্টা করুন অথবা নিজে এন্ট্রি দিন।'],
    AI_CONTENT_BLOCKED: ['AI could not process this content. You can enter the transaction manually.', 'AI এই ছবি বা অডিও প্রক্রিয়া করতে পারেনি। নিজে লেনদেন যোগ করতে পারবেন।'],
    AI_RESPONSE_INCOMPLETE: ['The AI draft was incomplete. Try a shorter recording or enter the details manually.', 'AI খসড়া সম্পূর্ণ হয়নি। ছোট অডিও দিয়ে চেষ্টা করুন অথবা নিজে তথ্য লিখুন।'],
    AI_ORIGIN_DENIED: ['AI entry is unavailable from this app address. Contact support.', 'অ্যাপের এই ঠিকানায় AI এন্ট্রি চালু নেই। সহায়তার জন্য যোগাযোগ করুন।'],
    AI_MEDIA_TOO_LARGE: ['Choose an image or audio file up to 2 MB.', 'সর্বোচ্চ ২ মেগাবাইটের ছবি বা অডিও বেছে নিন।'],
    AI_MEDIA_OR_CONSENT_INVALID: ['Check the selected image or audio and confirm permission to process it.', 'বেছে নেওয়া ছবি বা অডিও এবং প্রক্রিয়া করার অনুমতি পরীক্ষা করুন।'],
  };
  const message = messages[code] || ['AI is temporarily unavailable. Your existing entries are safe.', 'AI এখন সাময়িকভাবে কাজ করছে না। আগের লেনদেনগুলো সংরক্ষিত আছে।'];
  return message[isEn ? 0 : 1];
}
