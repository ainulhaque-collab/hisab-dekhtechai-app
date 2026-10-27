import { createReceiptBlob, MAX_RECEIPT_BYTES, receiptFromBytes } from '../storage/receipts';
import { validateImageSignature } from '../storage/workspaceMedia';

/** Keep the whole receipt; resize large camera photos before sending or storing them. */
export async function prepareAIReceipt(file: File) {
  if (file.size <= MAX_RECEIPT_BYTES) return createReceiptBlob(file);
  if (file.size > 12 * 1024 * 1024) throw new Error('AI_MEDIA_TOO_LARGE');
  // This helper validates format headers; the raw-photo size is bounded above.
  validateImageSignature(new Uint8Array(await file.slice(0, 16).arrayBuffer()), file.type);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width > 8192 || height > 8192 || width * height > 32_000_000) throw new Error('AI_MEDIA_TOO_LARGE');
    const scale = Math.min(1, 2560 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('AI_MEDIA_OR_CONSENT_INVALID');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.88, 0.72, 0.55]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_RECEIPT_BYTES)
        return receiptFromBytes(new Uint8Array(await blob.arrayBuffer()), 'image/jpeg', `${file.name.replace(/\.[^.]+$/, '')}.jpg`);
    }
    throw new Error('AI_MEDIA_TOO_LARGE');
  } finally { URL.revokeObjectURL(url); }
}
