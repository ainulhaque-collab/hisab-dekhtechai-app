import { createDurableStorageDriver, DurableStorageDriver } from './drivers/durableStorage';

import { MAX_IMAGE_BYTES, validateImageSignature } from './imageValidation';
export { MAX_IMAGE_BYTES, validateImageSignature } from './imageValidation';

export async function optimizeWorkspaceImage(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image must be 5 MB or smaller.');
  validateImageSignature(new Uint8Array(await file.arrayBuffer()), file.type);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 32_000_000)
      throw new Error('Image dimensions are too large. Choose an image smaller than 8192 pixels and 32 megapixels.');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 384;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image processing is unavailable.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 384, 384);
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 384, 384);
    const data = canvas.toDataURL('image/jpeg', 0.85);
    if (data.length > 256 * 1024) throw new Error('Optimized image is too large.');
    return data;
  } finally { URL.revokeObjectURL(url); }
}

/** Legacy private device store, retained intact during migration to replicated
 * workspace image metadata. New edits use the main database transaction/outbox. */
export class WorkspaceMediaStore {
  private ready?: Promise<DurableStorageDriver>;
  constructor(private driver?: DurableStorageDriver) {}
  private getDriver() {
    return this.ready ??= (async () => {
      const driver = this.driver || await createDurableStorageDriver('hisab_workspace_media_v1');
      await driver.init(); return driver;
    })();
  }
  async get(workspaceId: string, ownerHash: string): Promise<string | null> {
    const raw = await (await this.getDriver()).getItem(`workspace:${workspaceId}`);
    if (!raw) return null;
    const asset = JSON.parse(raw);
    if (asset.ownerHash !== ownerHash) return null;
    if (typeof asset.data !== 'string' || !asset.data.startsWith('data:image/jpeg;base64,') || asset.data.length > 256 * 1024) return null;
    return asset.data;
  }
  async save(workspaceId: string, ownerHash: string, data: string | null) {
    const driver = await this.getDriver();
    const existing = await driver.getItem(`workspace:${workspaceId}`);
    if (existing) {
      const owner = JSON.parse(existing).ownerHash;
      if (owner !== ownerHash) throw new Error('This image belongs to another owner.');
    }
    if (data === null) await driver.removeItem(`workspace:${workspaceId}`);
    else {
      if (!data.startsWith('data:image/jpeg;base64,') || data.length > 256 * 1024) throw new Error('Invalid optimized workspace image.');
      await driver.setItem(`workspace:${workspaceId}`, JSON.stringify({ version: 1, ownerHash, data }));
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('hisab-workspace-media'));
  }
  /** Called only after verified, consented database ownership binding has committed. */
  async claimOfflineAssets(workspaceIds: string[], verifiedOwner: string) {
    const driver = await this.getDriver();
    for (const id of workspaceIds) {
      const key = `workspace:${id}`;
      const raw = await driver.getItem(key); if (!raw) continue;
      const asset = JSON.parse(raw);
      if (asset.ownerHash === 'local-owner') await driver.setItem(key, JSON.stringify({ ...asset, ownerHash: verifiedOwner }));
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('hisab-workspace-media'));
  }
}
export const workspaceMedia = new WorkspaceMediaStore();
