import { LocalDatabase } from './db';
import { workspaceMedia, WorkspaceMediaStore } from './workspaceMedia';
import { mergeWorkspaceImage } from './workspaceImages';
import { canonicalJson, computeSha256Sync } from '../sync/canonical';
import { WorkspaceImage } from '../contracts/types';

/** Copy only this owner's legacy images. Keep originals for rollback/retry.
 * A replicated removal revision prevents old local photos from resurfacing. */
export async function migrateLegacyWorkspaceImages(db: LocalDatabase, store: WorkspaceMediaStore = workspaceMedia): Promise<number> {
  const owner = db.getIdentity()?.ownerSubjectHash || 'local-owner';
  // Older v1 clients retained new operation fields but did not project images.
  // Rebuild that projection after upgrade, without re-posting immutable operations.
  const recovered = new Map<string, WorkspaceImage>();
  for (const op of db.getRawState().syncOperations.values()) {
    const id = op.type === 'workspace.create' ? op.payload.workspace?.id : op.type === 'workspace.update' ? op.payload.id : undefined;
    const image = op.type === 'workspace.create' ? op.payload.workspace?.image : op.type === 'workspace.update' ? op.payload.image : undefined;
    const workspace = id && db.getWorkspace(id);
    if (!workspace || workspace.deletedAt || image === undefined || workspace.ownerSubjectHash !== owner || op.ownerHash !== owner ||
        op.entityId !== id || op.authorSubjectHash && op.authorSubjectHash !== owner) continue;
    if (op.contentSha256 !== computeSha256Sync(canonicalJson(op.payload))) throw new Error('Workspace image operation checksum mismatch.');
    const current = recovered.get(id) || workspace.image;
    const next = mergeWorkspaceImage(current, image)!;
    if (next !== current) recovered.set(id, next);
  }
  const pending: Array<{ id: string; data: string }> = [];
  for (const workspace of db.getAllWorkspaces()) {
    if (workspace.ownerSubjectHash !== owner || workspace.image !== undefined || recovered.has(workspace.id)) continue;
    const data = await store.get(workspace.id, owner);
    if (data) pending.push({ id: workspace.id, data });
  }
  if (!pending.length && !recovered.size) return 0;
  await db.beginTransaction();
  let migrated = 0;
  try {
    if ((db.getIdentity()?.ownerSubjectHash || 'local-owner') !== owner) throw new Error('Workspace image owner changed.');
    for (const [id, image] of recovered) {
      const workspace = db.getWorkspace(id);
      if (workspace && !workspace.deletedAt && workspace.ownerSubjectHash === owner) {
        workspace.image = mergeWorkspaceImage(workspace.image, image); migrated++;
      }
    }
    for (const { id, data } of pending) {
      const workspace = db.getWorkspace(id);
      if (!workspace || workspace.deletedAt || workspace.ownerSubjectHash !== owner || workspace.image !== undefined) continue;
      db.editWorkspace(id, { imageDataUrl: data }); migrated++;
    }
    await db.commitTransaction();
    return migrated;
  } catch (error) { await db.rollbackTransaction(); throw error; }
}
