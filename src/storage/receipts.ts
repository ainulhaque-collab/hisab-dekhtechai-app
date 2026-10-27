import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ReceiptBlob } from '../contracts/types.js';
import { validateImageSignature } from './imageValidation.js';

export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export function receiptFromBytes(bytes: Uint8Array, contentType: string, fileName: string): ReceiptBlob {
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES) throw new Error('Choose a receipt image up to 2 MB.');
  validateImageSignature(bytes, contentType);
  return { sha256: bytesToHex(sha256(bytes)), contentType,
    fileName: fileName.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180) || 'receipt',
    byteLength: bytes.length, dataBase64: encode(bytes), uploadStatus: 'local_only', createdAt: new Date().toISOString() };
}

export async function createReceiptBlob(file: File): Promise<ReceiptBlob> {
  if (!file.size || file.size > MAX_RECEIPT_BYTES) throw new Error('Choose a receipt image up to 2 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateImageSignature(bytes, file.type);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 32_000_000)
      throw new Error('Choose a receipt image below 8192 pixels and 32 megapixels.');
  } finally { URL.revokeObjectURL(url); }
  return receiptFromBytes(bytes, file.type, file.name);
}

/** Verify content, rather than trusting a MIME label, filename or claimed checksum. */
export function validateReceiptBlob(blob: ReceiptBlob): Uint8Array {
  if (!blob || !/^[a-f0-9]{64}$/.test(blob.sha256) || !Number.isSafeInteger(blob.byteLength) ||
      blob.byteLength < 1 || blob.byteLength > MAX_RECEIPT_BYTES || typeof blob.dataBase64 !== 'string' ||
      blob.dataBase64.length > Math.ceil(MAX_RECEIPT_BYTES / 3) * 4 ||
      typeof blob.fileName !== 'string' || blob.fileName.length > 180 || /[\u0000-\u001f\u007f]/.test(blob.fileName))
    throw new Error('Invalid receipt attachment.');
  let binary: string;
  try { binary = atob(blob.dataBase64); } catch { throw new Error('Invalid receipt image data.'); }
  if (btoa(binary) !== blob.dataBase64 || binary.length !== blob.byteLength) throw new Error('Receipt size does not match its contents.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  validateImageSignature(bytes, blob.contentType);
  if (bytesToHex(sha256(bytes)) !== blob.sha256) throw new Error('Receipt checksum verification failed.');
  return bytes;
}

export function receiptImageUrl(blob: ReceiptBlob): string {
  validateReceiptBlob(blob);
  return `data:${blob.contentType};base64,${blob.dataBase64}`;
}
