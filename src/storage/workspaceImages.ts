import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { WorkspaceImage } from '../contracts/types';
import { validateImageSignature } from './workspaceMedia';

export const MAX_WORKSPACE_IMAGE_DATA_URL = 256 * 1024;
const prefix = 'data:image/jpeg;base64,';

/** No remote URLs, SVG or active content. Hash the actual decoded image bytes. */
export function workspaceImageHash(dataUrl: string): string {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix) || dataUrl.length > MAX_WORKSPACE_IMAGE_DATA_URL)
    throw new Error('Invalid workspace image. Choose a JPEG photo up to 256 KB after optimization.');
  const encoded = dataUrl.slice(prefix.length);
  let binary: string;
  try { binary = atob(encoded); } catch { throw new Error('Invalid workspace image encoding.'); }
  if (!binary || btoa(binary) !== encoded) throw new Error('Invalid workspace image encoding.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  validateImageSignature(bytes, 'image/jpeg');
  return bytesToHex(sha256(bytes));
}

export function validateWorkspaceImage(value: unknown): asserts value is WorkspaceImage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workspace image.');
  const image = value as WorkspaceImage;
  if (Object.keys(image).sort().join(',') !== 'dataUrl,revisionId,sha256,version' ||
      !Number.isSafeInteger(image.version) || image.version < 1 ||
      typeof image.revisionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(image.revisionId))
    throw new Error('Invalid workspace image revision.');
  if (image.dataUrl === null) {
    if (image.sha256 !== null) throw new Error('Invalid removed workspace image.');
  } else if (image.sha256 !== workspaceImageHash(image.dataUrl)) throw new Error('Workspace image checksum mismatch.');
}

export function createWorkspaceImage(dataUrl: string | null, revisionId: string, previous?: WorkspaceImage): WorkspaceImage {
  if (previous) validateWorkspaceImage(previous);
  const image = { dataUrl, sha256: dataUrl === null ? null : workspaceImageHash(dataUrl),
    version: (previous?.version || 0) + 1, revisionId };
  validateWorkspaceImage(image);
  return image;
}

/** Logical revision + UUID tie-break gives identical photo state for reordered
 * concurrent updates. No wall clock ordering and no financial records involved. */
export function mergeWorkspaceImage(current?: WorkspaceImage, incoming?: WorkspaceImage): WorkspaceImage | undefined {
  if (current !== undefined) validateWorkspaceImage(current);
  if (incoming !== undefined) validateWorkspaceImage(incoming);
  if (!incoming) return current;
  if (!current) return { ...incoming };
  const comparison = incoming.version - current.version ||
    (incoming.revisionId === current.revisionId ? 0 : incoming.revisionId > current.revisionId ? 1 : -1);
  if (!comparison && (incoming.sha256 !== current.sha256 || incoming.dataUrl !== current.dataUrl))
    throw new Error('Conflicting workspace image revision.');
  return comparison > 0 ? { ...incoming } : current;
}
