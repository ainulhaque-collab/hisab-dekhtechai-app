import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Camera, ImagePlus, Mic, Square, Sparkles, LoaderCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ReceiptBlob } from '../contracts/types';
import { aiEndpoint, aiErrorMessage, extractEntry } from '../ai/client';
import { encodeAudioBytes, ExtractionInput } from '../ai/media';
import { EntryDraft } from '../ai/entryDraft';
import { VoiceCapture } from '../ai/voiceCapture';
import { aiConsentStore, AI_CONSENT_CHANGED } from '../ai/consent';
import { requestAIMediaPermissions } from '../ai/nativeMedia';
import { prepareAIReceipt } from '../ai/receiptCapture';
import { ModalShell, primaryButton, secondaryButton } from './ModalShell';

export function AIEntryModal({ onClose, onApply }: {
  onClose: () => void; onApply: (entry: EntryDraft, receipt: ReceiptBlob | null) => void;
}) {
  const { language, auth, db, isOnline } = useApp();
  const en = language === 'en';
  const owner = db.getIdentity()?.ownerSubjectHash || '';
  const ownerAtOpen = useRef(owner);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const [permissionHint, setPermissionHint] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const capture = useRef<VoiceCapture | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const locked = useRef(false);
  let endpoint = '';
  try { endpoint = aiEndpoint(import.meta.env.VITE_AI_API_BASE_URL || '', window.location.origin, Capacitor.isNativePlatform()); } catch { /* Report before opening a sensor. */ }
  const unavailable = !endpoint || !owner || !isOnline;
  const sameOwner = () => ownerAtOpen.current === db.getIdentity()?.ownerSubjectHash && ownerAtOpen.current === auth.getProfile()?.subjectHash;

  useEffect(() => {
    mounted.current = true;
    const check = async () => {
      try {
        const enabled = await (await aiConsentStore()).allowed(ownerAtOpen.current);
        if (!mounted.current) return;
        setAllowed(enabled);
        if (!enabled) { abort.current?.abort(); capture.current?.cancel(); }
      } catch { if (mounted.current) setError(en ? 'AI permission could not be loaded. Reopen this screen.' : 'AI অনুমতি পড়া যায়নি। স্ক্রিনটি আবার খুলুন।'); }
      finally { if (mounted.current) setLoading(false); }
    };
    const background = () => { capture.current?.cancel(); if (mounted.current) setRecording(false); };
    const visibility = () => { if (document.hidden) background(); else void check(); };
    const changed = () => { void check(); };
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(AI_CONSENT_CHANGED) : null;
    if (channel) channel.onmessage = changed;
    void check();
    window.addEventListener(AI_CONSENT_CHANGED, changed);
    window.addEventListener('hisab-background', background);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false; abort.current?.abort(); capture.current?.cancel(); channel?.close();
      window.removeEventListener(AI_CONSENT_CHANGED, changed);
      window.removeEventListener('hisab-background', background);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [en]);
  useEffect(() => {
    if (owner !== ownerAtOpen.current) { abort.current?.abort(); capture.current?.cancel(); setAllowed(false); }
  }, [owner]);

  const enable = async () => {
    if (locked.current || unavailable) return;
    locked.current = true; setBusy(true); setError('');
    try {
      if (!sameOwner()) throw new Error('AI_AUTH_REQUIRED');
      try { await requestAIMediaPermissions(); } catch { if (mounted.current) setPermissionHint(true); }
      if (!mounted.current || !sameOwner()) return;
      await (await aiConsentStore()).allow(ownerAtOpen.current);
      if (mounted.current && sameOwner()) setAllowed(true);
    } catch { if (mounted.current) setError(en ? 'AI permission could not be saved. Connect Google and try again.' : 'AI অনুমতি রাখা যায়নি। Google সংযোগ দিয়ে আবার চেষ্টা করুন।'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const send = async (input: ExtractionInput, image: ReceiptBlob | null) => {
    if (!sameOwner()) throw new Error('AI_OWNER_MISMATCH');
    if (!await (await aiConsentStore()).allowed(ownerAtOpen.current)) throw new Error('AI_MEDIA_OR_CONSENT_INVALID');
    if (!mounted.current) return;
    const controller = new AbortController(); abort.current = controller;
    const result = await extractEntry(input, ownerAtOpen.current, auth, { endpoint, signal: controller.signal });
    if (!mounted.current || controller.signal.aborted) return;
    if (!sameOwner()) throw new Error('AI_OWNER_MISMATCH');
    if (!await (await aiConsentStore()).allowed(ownerAtOpen.current)) throw new Error('AI_MEDIA_OR_CONSENT_INVALID');
    if (!mounted.current || controller.signal.aborted) return;
    if (!sameOwner()) throw new Error('AI_OWNER_MISMATCH');
    onApply(result.draft, image);
  };
  const chooseImage = async (file?: File) => {
    if (!file || locked.current || !allowed || unavailable) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const image = await prepareAIReceipt(file).catch(() => { throw new Error('AI_IMAGE_INVALID'); });
      await send({ source: 'receipt', receipt: image, consentToProcess: true }, image);
    } catch (failure) { if (mounted.current) setError(aiErrorMessage(failure, en)); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const record = async () => {
    if (locked.current || !allowed || unavailable) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(en ? 'Voice recording is unavailable in this browser.' : 'এই ব্রাউজারে ভয়েস রেকর্ড করা যাচ্ছে না।'); return;
    }
    locked.current = true; setBusy(true); setError('');
    let active: VoiceCapture | null = null;
    try {
      await requestAIMediaPermissions(['microphone']);
      if (!mounted.current || !sameOwner()) return;
      active = new VoiceCapture(); capture.current = active;
      const blob = await active.start(() => { if (mounted.current) setRecording(true); });
      if (mounted.current) setRecording(false);
      await send({ source: 'voice', mimeType: blob.type, dataBase64: encodeAudioBytes(new Uint8Array(await blob.arrayBuffer())), consentToProcess: true }, null);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error && failure.message.startsWith('AI_RECORDING')
        ? (en ? 'Recording stopped. Allow microphone access and try again.' : 'রেকর্ড বন্ধ হয়েছে। মাইক্রোফোনের অনুমতি দিয়ে আবার চেষ্টা করুন।') : aiErrorMessage(failure, en));
    } finally {
      active?.cancel(); capture.current = null; locked.current = false;
      if (mounted.current) { setBusy(false); setRecording(false); }
    }
  };
  const openCamera = async () => {
    if (locked.current) return;
    locked.current = true;
    try { await requestAIMediaPermissions(['camera']); if (mounted.current && sameOwner()) cameraInput.current?.click(); }
    catch { if (mounted.current) setPermissionHint(true); }
    finally { locked.current = false; }
  };
  return <ModalShell title={en ? 'Add with AI' : 'AI দিয়ে এন্ট্রি'} icon={<Sparkles className="h-5 w-5" />}
    description={en ? 'Photo or voice → details filled in → Save' : 'ছবি বা কথা → ফর্মে তথ্য → Save'} onClose={onClose}>
    <div className="space-y-4 text-sm">
      {!endpoint && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-900">{en ? 'AI service is not connected to this app version yet. You can enter transactions manually.' : 'এই সংস্করণে AI সার্ভারের সংযোগ এখনও দেওয়া হয়নি। আপাতত সাধারণভাবে এন্ট্রি দিতে পারবেন।'}</p>}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-700">{error}</p>}
      {loading ? <p role="status">{en ? 'Loading…' : 'লোড হচ্ছে…'}</p> : !allowed ? <div className="space-y-4">
        <p className="leading-relaxed text-slate-600">{en ? 'Send only the photo or voice you choose to Google Gemini to fill your transaction form. Remember this permission on this device. Change it anytime in Settings → Privacy.' : 'আপনার বেছে নেওয়া ছবি বা ভয়েস Google Gemini-তে পাঠিয়ে ফর্ম পূরণ হবে। এই ডিভাইসে অনুমতি মনে রাখা হবে। সেটিংস → গোপনীয়তা থেকে যেকোনো সময় বন্ধ করতে পারবেন।'}</p>
        <button type="button" className={`${primaryButton} w-full`} disabled={busy || unavailable} onClick={() => void enable()}>{en ? 'Enable AI entry' : 'AI এন্ট্রি চালু করুন'}</button>
      </div> : <>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className={`${secondaryButton} min-h-24 flex-col`} disabled={busy || unavailable} onClick={() => void openCamera()}><Camera className="h-6 w-6" />{en ? 'Take photo' : 'ছবি তুলুন'}</button>
          <button type="button" className={`${secondaryButton} min-h-24 flex-col`} disabled={busy || unavailable} onClick={() => galleryInput.current?.click()}><ImagePlus className="h-6 w-6" />{en ? 'Choose image' : 'গ্যালারি'}</button>
        </div>
        <input ref={cameraInput} className="sr-only" tabIndex={-1} aria-label={en ? 'Receipt camera' : 'রিসিপ্টের ক্যামেরা'} type="file" accept="image/*" capture="environment" disabled={busy || unavailable}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseImage(file); }} />
        <input ref={galleryInput} className="sr-only" tabIndex={-1} aria-label={en ? 'Receipt image' : 'রিসিপ্টের ছবি'} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || unavailable}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseImage(file); }} />
        <button type="button" className={`${primaryButton} min-h-14 w-full ${recording ? 'bg-rose-600 hover:bg-rose-700' : ''}`} disabled={unavailable || (busy && !recording)}
          onClick={() => recording ? capture.current?.stop() : void record()}>
          {recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}{recording ? (en ? 'Stop & fill form' : 'থামিয়ে ফর্ম পূরণ করুন') : (en ? 'Speak your entry' : 'কথা বলে এন্ট্রি দিন')}</button>
        {recording && <p role="status" className="text-center text-rose-700">{en ? 'Listening… up to 45 seconds' : 'শুনছি… সর্বোচ্চ ৪৫ সেকেন্ড'}</p>}
        {busy && !recording && <p role="status" className="flex items-center justify-center gap-2 text-blue-700"><LoaderCircle className="h-4 w-4 animate-spin" />{en ? 'Filling your form…' : 'ফর্ম পূরণ হচ্ছে…'}</p>}
        <p className="text-xs leading-relaxed text-slate-500">{en ? 'Only selected media goes to Google Gemini. Check the filled details, then Save once. Nothing is saved automatically.' : 'শুধু বেছে নেওয়া মিডিয়া Google Gemini-তে যায়। পূরণ করা তথ্য দেখে একবার Save করুন। নিজে থেকে লেনদেন সংরক্ষণ হয় না।'}</p>
      </>}
      {permissionHint && <p className="text-xs text-amber-800">{en ? 'Allow camera or microphone access in phone settings. You can still choose a gallery image.' : 'ফোনের সেটিংসে ক্যামেরা বা মাইক্রোফোনের অনুমতি দিন। গ্যালারি থেকে ছবি বেছে নিতে পারবেন।'}</p>}
      {(!owner || !isOnline) && <p className="text-xs text-amber-800">{en ? 'Connect Google and the internet to use AI.' : 'AI ব্যবহার করতে Google সংযোগ ও ইন্টারনেট প্রয়োজন।'}</p>}
    </div>
  </ModalShell>;
}
