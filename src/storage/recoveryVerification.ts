import { LocalDatabase } from './db';
import type { DurableStorageDriver } from './drivers/durableStorage';
import { decodeBackup } from './backup';
import { financialFingerprint } from '../sync/cloudBackup';
import { canonicalJson } from '../sync/canonical';

/** No device database, localStorage, disk, network, sync or automation access. */
class RecoveryMemoryDriver implements DurableStorageDriver {
  private records = new Map<string,string>();
  private transaction: Map<string,string> | null = null;
  async init() {}
  async getItem(key:string) { return this.records.get(key) ?? null; }
  async setItem(key:string,value:string) { this.records.set(key,value); }
  async removeItem(key:string) { this.records.delete(key); }
  async isPersistent() { return false; }
  getType() { return 'localstorage-fallback' as const; }
  async beginTransaction() { this.transaction = new Map(this.records); }
  async commitTransaction() { this.transaction = null; }
  async rollbackTransaction() { if(this.transaction) this.records = this.transaction; this.transaction = null; }
  clear() { this.records.clear(); this.transaction?.clear(); this.transaction = null; }
}

/** Exercise the real import/validation/read-back paths on an isolated copy.
 * This proves this file can restore now, not remote availability or a future
 * device's storage capacity. The returned result contains no financial amounts. */
export async function verifyBackupRecovery(text:string) {
  const expected = await decodeBackup(text);
  const driver = new RecoveryMemoryDriver();
  const db = new LocalDatabase('isolated-recovery-verification',driver,true);
  try {
    await db.init();
    // An empty isolated receiver adopts this file's namespace only. It does not
    // authenticate the file owner or change the signed-in device's identity.
    await db.loadFromSerializable({schemaVersion:5,localIdentity:expected.localIdentity || null});
    await db.importBackupFile(text);
    const restored = await decodeBackup(await db.exportBackupFile());
    if(await financialFingerprint(expected) !== await financialFingerprint(restored)) throw new Error('RECOVERY_READBACK_MISMATCH');
    const reloaded = new LocalDatabase('isolated-recovery-verification',driver,true);
    await reloaded.init();
    if(await financialFingerprint(reloaded.toSerializable()) !== await financialFingerprint(expected)) throw new Error('RECOVERY_READBACK_MISMATCH');
    for(const [,workspace] of expected.workspaces || []) {
      if(canonicalJson(db.calculateAccountSummaries(workspace.id)) !== canonicalJson(reloaded.calculateAccountSummaries(workspace.id))) throw new Error('RECOVERY_BALANCE_MISMATCH');
    }
    return { verifiedAt:new Date().toISOString(), workspaces:(expected.workspaces || []).length,
      transactions:(expected.journalTransactions || []).length, media:(expected.receiptBlobs || []).length };
  } finally { driver.clear(); }
}
