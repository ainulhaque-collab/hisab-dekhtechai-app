import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ReceiptBlob } from '../contracts/types';
import { validateReceiptBlob } from '../storage/receipts';

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export type ExtractionInput = { source: 'receipt'; receipt: ReceiptBlob; consentToProcess: boolean }
  | { source: 'voice'; dataBase64: string; mimeType: string; consentToProcess: boolean };

export function encodeAudioBytes(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error('AI_AUDIO_INVALID');
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(result);
}

/** Only inline media: never fetch arbitrary model-supplied or user-supplied URLs. */
export function validateExtractionMedia(input: ExtractionInput) {
  if (!input || input.consentToProcess !== true) throw new Error('AI_CONSENT_REQUIRED');
  let bytes: Uint8Array, data: string, mimeType: string;
  if (input.source === 'receipt') {
    if (Object.keys(input).some(key => !['source', 'receipt', 'consentToProcess'].includes(key))) throw new Error('AI_SOURCE_INVALID');
    bytes = validateReceiptBlob(input.receipt); data = input.receipt.dataBase64!; mimeType = input.receipt.contentType;
  } else if (input.source === 'voice') {
    if (Object.keys(input).some(key => !['source', 'dataBase64', 'mimeType', 'consentToProcess'].includes(key)) || typeof input.mimeType !== 'string') throw new Error('AI_AUDIO_INVALID');
    mimeType = input.mimeType.split(';')[0].trim();
    if (!['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/flac', 'audio/webm', 'audio/aac', 'audio/mp4', 'audio/m4a'].includes(mimeType) ||
        typeof input.dataBase64 !== 'string' || !input.dataBase64 || input.dataBase64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4)
      throw new Error('AI_AUDIO_INVALID');
    let binary: string;
    try { binary = atob(input.dataBase64); } catch { throw new Error('AI_AUDIO_INVALID'); }
    if (!binary.length || binary.length > MAX_AUDIO_BYTES || btoa(binary) !== input.dataBase64) throw new Error('AI_AUDIO_INVALID');
    bytes = Uint8Array.from(binary, character => character.charCodeAt(0)); data = input.dataBase64;
  } else throw new Error('AI_SOURCE_INVALID');
  return { data, mimeType, sourceSha256: bytesToHex(sha256(bytes)) };
}
