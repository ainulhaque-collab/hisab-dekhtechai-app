import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Canonical JSON serialization (RFC 8785 compatible) and SHA-256 computation
 */

export function canonicalJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalJson(item)).join(',') + ']';
  }

  const sortedKeys = Object.keys(obj).sort();
  const pairs: string[] = [];

  for (const key of sortedKeys) {
    const val = obj[key];
    if (val !== undefined && typeof val !== 'function' && typeof val !== 'symbol') {
      pairs.push(`${JSON.stringify(key)}:${canonicalJson(val)}`);
    }
  }

  return '{' + pairs.join(',') + '}';
}

/**
 * Computes SHA-256 hash as lowercase hex string.
 * Works seamlessly in both browser (window.crypto.subtle) and Node.js.
 */
export async function computeSha256(content: string): Promise<string> {
  return computeSha256Sync(content);
}

export function computeSha256Sync(content: string): string {
  // Identical UTF-8 SHA-256 on native, HTTPS, localhost and LAN HTTP.
  // LAN HTTP has no WebCrypto; a non-cryptographic fallback corrupts owner IDs and backups.
  return bytesToHex(sha256(utf8ToBytes(content)));
}
