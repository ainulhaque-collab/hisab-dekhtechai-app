export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Pure byte validation, shared by the browser and Node API without device stores. */
export function validateImageSignature(bytes: Uint8Array, mime: string): void {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (bytes.length > MAX_IMAGE_BYTES || !bytes.length || !(({ 'image/jpeg': jpeg, 'image/png': png, 'image/webp': webp })[mime]))
    throw new Error('Choose a valid JPEG, PNG or WebP image up to 5 MB.');
}
