import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Mic, Square, Sparkles, LoaderCircle, Upload } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ReceiptBlob } from '../contracts/types';
import { createReceiptBlob, receiptImageUrl } from '../storage/receipts';
import { aiEndpoint, aiErrorMessage, extractEntry } from '../ai/client';
import { encodeAudioBytes, ExtractionInput, MAX_AUDIO_BYTES } from '../ai/media';
import { EntryDraft } from '../ai/entryDraft';
import { ReviewedEntry, validateReviewedEntry } from '../ai/review';
import { VoiceCapture } from '../ai/voiceCapture';
import { ModalShell, fieldClass, primaryButton, secondaryButton } from './ModalShell';
import { AppSelect } from './AppSelect';

export function AIEntryModal({ onClose, onApply }: {
  onClose: () => void;
  onApply: (entry: ReviewedEntry, receipt: ReceiptBlob | null) => void;
}) {
  const { language, auth, db, isOnline } = useApp();
  const isEn = language === 'en';
  const [source, setSource] = useState<'receipt' | 'voice'>('receipt');
  const [receipt, setReceipt] = useState<ReceiptBlob | null>(null);
  const [audio, setAudio] = useState<{ blob: Blob; name: string } | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [review, setReview] = useState({ type: '', amount: '', currency: '', date: '', time: '', note: '' });
  const [confirmed, setConfirmed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const capture = useRef<VoiceCapture | null>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  const selection = useRef(0);
  const owner = db.getIdentity()?.ownerSubjectHash || '';
  const ownerAtOpen = useRef(owner);
  const receiptUrl = useMemo(() => receipt ? receiptImageUrl(receipt) : '', [receipt]);

  useEffect(() => {
    if (!audio) { setAudioUrl(''); return; }
    const url = URL.createObjectURL(audio.blob); setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);

  useEffect(() => {
    mounted.current = true;
    const background = () => { capture.current?.cancel(); setRecording(false); };
    const hidden = () => { if (document.hidden) background(); };
    window.addEventListener('hisab-background', background);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      mounted.current = false; selection.current++;
      abort.current?.abort(); capture.current?.cancel();
      window.removeEventListener('hisab-background', background);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  const resetReview = () => { setDraft(null); setConfirmed(false); setError(''); };
  const switchSource = (next: 'receipt' | 'voice') => {
    if (locked.current) return;
    capture.current?.cancel(); setRecording(false); selection.current++;
    setSource(next); setConsent(false); resetReview();
  };
  const chooseFile = async (file?: File) => {
    if (!file || locked.current) return;
    const version = ++selection.current;
    if (source === 'receipt') setReceipt(null); else setAudio(null);
    resetReview(); setConsent(false); setBusy(true); locked.current = true;
    try {
      if (source === 'receipt') {
        const image = await createReceiptBlob(file);
        if (mounted.current && selection.current === version) setReceipt(image);
      } else {
        if (!file.size || file.size > MAX_AUDIO_BYTES || !file.type.startsWith('audio/')) throw new Error();
        if (mounted.current && selection.current === version) setAudio({ blob: file, name: file.name });
      }
    } catch {
      if (mounted.current) setError(isEn ? 'Choose a valid image or audio file up to 2 MB.' : 'সর্বোচ্চ ২ মেগাবাইটের সঠিক ছবি বা অডিও বেছে নিন।');
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const record = async () => {
    if (locked.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(isEn ? 'Recording is unavailable here. Choose an audio file instead.' : 'এখানে রেকর্ড করা যাচ্ছে না। অডিও ফাইল বেছে নিন।'); return;
    }
    resetReview(); setAudio(null); setConsent(false); locked.current = true; setBusy(true);
    const activeCapture = new VoiceCapture(); capture.current = activeCapture;
    try {
      const blob = await activeCapture.start(() => { if (mounted.current) setRecording(true); });
      if (mounted.current) setAudio({ blob, name: isEn ? 'Recorded voice' : 'রেকর্ড করা ভয়েস' });
    } catch {
      if (mounted.current) setError(isEn ? 'Recording stopped or permission was denied. You can choose an audio file.' : 'রেকর্ড বন্ধ হয়েছে বা অনুমতি পাওয়া যায়নি। অডিও ফাইল বেছে নিতে পারেন।');
    } finally {
      activeCapture.cancel(); capture.current = null; locked.current = false;
      if (mounted.current) { setBusy(false); setRecording(false); }
    }
  };
  const createDraft = async () => {
    if (locked.current || !consent) return;
    locked.current = true; setBusy(true); resetReview();
    const controller = new AbortController(); abort.current = controller;
    try {
      if (!owner || owner !== ownerAtOpen.current) throw new Error('AI_OWNER_MISMATCH');
      const input: ExtractionInput = source === 'receipt'
        ? { source, receipt: receipt!, consentToProcess: true }
        : { source, mimeType: audio!.blob.type, dataBase64: encodeAudioBytes(new Uint8Array(await audio!.blob.arrayBuffer())), consentToProcess: true };
      const result = await extractEntry(input, owner, auth, {
        endpoint: aiEndpoint(import.meta.env.VITE_AI_API_BASE_URL || '', window.location.origin), signal: controller.signal,
      });
      if (!mounted.current || controller.signal.aborted) return;
      if (db.getIdentity()?.ownerSubjectHash !== owner) throw new Error('AI_OWNER_MISMATCH');
      setDraft(result.draft);
      setReview({ type: result.draft.transactionType === 'unknown' ? '' : result.draft.transactionType,
        amount: result.draft.amountDecimal || '', currency: result.draft.currency === 'unknown' ? '' : result.draft.currency,
        date: result.draft.transactionDate || '', time: result.draft.transactionTime || '',
        note: [result.draft.merchant, result.draft.note].filter(Boolean).join(' · ').slice(0, 1000) });
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(aiErrorMessage(failure, isEn));
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const apply = () => {
    if (!draft || !confirmed) return;
    try {
      if (db.getIdentity()?.ownerSubjectHash !== ownerAtOpen.current || auth.getProfile()?.subjectHash !== ownerAtOpen.current)
        throw new Error('AI_OWNER_MISMATCH');
      onApply(validateReviewedEntry(review), source === 'receipt' ? receipt : null);
    } catch { setError(isEn ? 'Check the type, positive amount, currency, date and time before applying.' : 'ধরন, শূন্যের চেয়ে বেশি অঙ্ক, মুদ্রা, তারিখ ও সময় ঠিক করে নিন।'); }
  };
  const setField = (key: keyof typeof review, value: string) => { setReview(previous => ({ ...previous, [key]: value })); setConfirmed(false); };

  return <ModalShell title={isEn ? 'AI-assisted entry' : 'AI দিয়ে সহজ এন্ট্রি'} icon={<Sparkles className="h-5 w-5" />}
    description={isEn ? 'Receipt or voice → review → choose an account → Save' : 'রিসিপ্ট বা ভয়েস → যাচাই → অ্যাকাউন্ট নির্বাচন → Save'} onClose={onClose}
    footer={draft ? <button type="button" className={`${primaryButton} w-full`} disabled={!confirmed || busy} onClick={apply}>
      {isEn ? 'Use in transaction form' : 'এন্ট্রি ফর্মে বসান'}</button> : <button type="button" className={`${primaryButton} w-full`}
        disabled={busy || !consent || !isOnline || !owner || (source === 'receipt' ? !receipt : !audio)} onClick={createDraft}>
        {busy && !recording ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {isEn ? 'Create draft' : 'খসড়া তৈরি করুন'}</button>}>
    <div className="space-y-4 text-sm">
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-700">{error}</p>}
      {!draft && <>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={isEn ? 'Entry source' : 'এন্ট্রির উৎস'}>
          {(['receipt', 'voice'] as const).map(item => <button key={item} type="button" disabled={busy} aria-pressed={source === item}
            onClick={() => switchSource(item)} className={`${secondaryButton} ${source === item ? 'border-blue-500 bg-blue-50 text-blue-700' : ''}`}>
            {item === 'receipt' ? <Camera className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {item === 'receipt' ? (isEn ? 'Receipt' : 'রিসিপ্ট') : (isEn ? 'Voice' : 'ভয়েস')}</button>)}
        </div>
        <label className={`${secondaryButton} w-full cursor-pointer ${busy ? 'pointer-events-none opacity-40' : ''}`}>
          <Upload className="h-4 w-4" />{source === 'receipt' ? (isEn ? 'Choose receipt image' : 'রিসিপ্টের ছবি বেছে নিন') : (isEn ? 'Choose audio file' : 'অডিও ফাইল বেছে নিন')}
          <input className="sr-only" type="file" disabled={busy} accept={source === 'receipt' ? 'image/jpeg,image/png,image/webp' : 'audio/*'}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseFile(file); }} />
        </label>
        {source === 'receipt' && receipt && <><img src={receiptUrl} alt={isEn ? 'Selected receipt' : 'নির্বাচিত রিসিপ্ট'} className="max-h-48 w-full rounded-xl bg-slate-50 object-contain" /><p className="break-words text-xs text-slate-600">{receipt.fileName}</p></>}
        {source === 'voice' && <>
          <button type="button" className={`${secondaryButton} w-full`} disabled={busy && !recording} onClick={() => recording ? capture.current?.stop() : void record()}>
            {recording ? <Square className="h-4 w-4 text-rose-600" /> : <Mic className="h-4 w-4" />}
            {recording ? (isEn ? 'Stop recording' : 'রেকর্ড বন্ধ করুন') : (isEn ? 'Record up to 45 seconds' : 'সর্বোচ্চ ৪৫ সেকেন্ড রেকর্ড করুন')}</button>
          {recording && <p role="status" className="text-rose-600">{isEn ? 'Recording…' : 'রেকর্ড হচ্ছে…'}</p>}
          {audio && <p className="break-words text-xs text-slate-600">{audio.name} · {Math.ceil(audio.blob.size / 1024)} KB</p>}
          {audioUrl && <audio controls src={audioUrl} className="w-full" />}
        </>}
        <p className="text-xs leading-relaxed text-slate-500">{isEn ? 'Images: JPEG, PNG or WebP. Audio or image: up to 2 MB. Only the selected media is sent to Google Gemini through our AI service. AI can make mistakes.' : 'ছবি: JPEG, PNG বা WebP। ছবি বা অডিও সর্বোচ্চ ২ মেগাবাইট। শুধু বেছে নেওয়া মিডিয়া আমাদের AI সেবার মাধ্যমে Google Gemini-তে যাবে। AI ভুল করতে পারে।'}</p>
        <label className="flex items-start gap-3 rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-slate-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />
          {isEn ? 'I agree to send this image or audio to Google Gemini to prepare a transaction draft.' : 'লেনদেনের খসড়া তৈরির জন্য এই ছবি বা অডিও Google Gemini-তে পাঠাতে সম্মত আছি।'}</label>
        {(!isOnline || !owner) && <p className="text-xs text-amber-700">{isEn ? 'Internet and a connected Google account are required for AI entry.' : 'AI এন্ট্রির জন্য ইন্টারনেট ও সংযুক্ত Google অ্যাকাউন্ট প্রয়োজন।'}</p>}
      </>}
      {draft && <>
        <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{isEn ? 'Check against your receipt or spoken words. This is a draft; your accounts have not changed.' : 'রিসিপ্ট বা বলা কথার সঙ্গে মিলিয়ে দেখুন। এটি খসড়া; এখনও কোনো লেনদেন সংরক্ষণ হয়নি।'}</p>
        {source === 'receipt' && receiptUrl && <details className="rounded-xl border border-slate-200 p-3 text-xs"><summary className="cursor-pointer font-semibold">{isEn ? 'Compare with receipt' : 'রিসিপ্টের সঙ্গে মিলিয়ে দেখুন'}</summary><img src={receiptUrl} alt={isEn ? 'Original receipt' : 'আসল রিসিপ্ট'} className="mt-3 max-h-72 w-full object-contain" /></details>}
        {source === 'voice' && audioUrl && <audio controls src={audioUrl} className="w-full" />}
        {draft.transcript && <div className="rounded-xl bg-slate-50 p-3"><p className="mb-1 text-xs font-semibold">{isEn ? 'What AI heard' : 'AI যা শুনেছে'}</p><p className="whitespace-pre-wrap break-words text-xs">{draft.transcript}</p></div>}
        {draft.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800">{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <label className="block text-xs font-semibold">{isEn ? 'Transaction type' : 'লেনদেনের ধরন'}
          <AppSelect aria-label={isEn ? 'Transaction type' : 'লেনদেনের ধরন'} className={fieldClass} value={review.type} onChange={event => setField('type', event.target.value)}>
            <option value="">{isEn ? 'Choose type' : 'ধরন বেছে নিন'}</option><option value="expense">{isEn ? 'Expense' : 'খরচ'}</option>
            <option value="income">{isEn ? 'Income' : 'জমা'}</option><option value="transfer">{isEn ? 'Transfer' : 'স্থানান্তর'}</option></AppSelect></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-semibold">{isEn ? 'Amount' : 'টাকার অঙ্ক'}<input inputMode="decimal" className={fieldClass} value={review.amount} onChange={event => setField('amount', event.target.value)} /></label>
          <label className="block text-xs font-semibold">{isEn ? 'Currency' : 'মুদ্রা'}<AppSelect aria-label={isEn ? 'Currency' : 'মুদ্রা'} className={fieldClass} value={review.currency} onChange={event => setField('currency', event.target.value)}><option value="">{isEn ? 'Confirm currency' : 'মুদ্রা নিশ্চিত করুন'}</option><option value="BDT">BDT — ৳</option></AppSelect></label>
          <label className="block text-xs font-semibold">{isEn ? 'Date (optional)' : 'তারিখ (ঐচ্ছিক)'}<input type="date" className={fieldClass} value={review.date} onChange={event => setField('date', event.target.value)} /></label>
          <label className="block text-xs font-semibold">{isEn ? 'Time (optional)' : 'সময় (ঐচ্ছিক)'}<input type="time" className={fieldClass} value={review.time} onChange={event => setField('time', event.target.value)} /></label>
        </div>
        <p className="text-xs text-slate-500">{isEn ? 'Blank date/time uses the time when you Save the transaction.' : 'তারিখ/সময় ফাঁকা থাকলে লেনদেন Save করার সময় বসবে।'}</p>
        <label className="block text-xs font-semibold">{isEn ? 'Note' : 'নোট'}<textarea className={fieldClass} maxLength={1000} value={review.note} onChange={event => setField('note', event.target.value)} /></label>
        <label className="flex items-start gap-3 text-xs leading-relaxed"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
          {isEn ? 'I checked these details. Next I will choose the account and category, then Save.' : 'তথ্যগুলো যাচাই করেছি। এরপর অ্যাকাউন্ট ও ক্যাটাগরি বেছে নিয়ে Save করব।'}</label>
        <button type="button" className={secondaryButton} onClick={resetReview}>{isEn ? 'Back to source' : 'রিসিপ্ট/ভয়েসে ফিরে যান'}</button>
      </>}
    </div>
  </ModalShell>;
}
