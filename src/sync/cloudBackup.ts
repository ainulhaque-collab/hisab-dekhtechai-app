import { LocalDatabase } from '../storage/db';
import { DriveTransport } from '../drive/transport';
import { decodeBackup } from '../storage/backup';
import { canonicalJson, computeSha256 } from './canonical';
import { isSavingsOperation } from '../storage/savingsOperations';
import { isLoanOperation } from '../storage/loanBook';
import { isReportOperation } from '../storage/reportMetadata';

const KEY = 'verified-drive-backup-v1';
export interface CloudBackupReceipt { ownerHash: string; fingerprint: string; fileId: string; verifiedAt: string }
const collections = ['workspaces', 'accounts', 'accountGroups', 'accountPermissions', 'categories', 'parties',
  'journalTransactions', 'journalLines', 'budgets', 'recurringRules', 'recurringOccurrences', 'receiptBlobs'];

export async function financialFingerprint(data: Record<string, any>): Promise<string> {
  const payload = Object.fromEntries(collections.map(key => [key, [...(data[key] || [])].sort(([a], [b]) => a.localeCompare(b))]));
  const savings = (data.syncOperations || []).filter(([, op]: [string, any]) => isSavingsOperation(op));
  // Omit the extension when empty to preserve existing checkpoint fingerprints.
  if (savings.length) payload.savingsOperations = [...savings].sort(([a], [b]) => a.localeCompare(b));
  const loans = (data.syncOperations || []).filter(([, op]: [string, any]) => isLoanOperation(op));
  if (loans.length) payload.loanOperations = [...loans].sort(([a], [b]) => a.localeCompare(b));
  const reportMetadata = (data.syncOperations || []).filter(([, op]: [string, any]) => isReportOperation(op));
  if (reportMetadata.length) payload.reportOperations = [...reportMetadata].sort(([a], [b]) => a.localeCompare(b));
  return computeSha256(canonicalJson(payload));
}

export function getCloudBackupReceipt(db: LocalDatabase): CloudBackupReceipt | null {
  const receipt = db.getRawState().preferences.get(KEY);
  return receipt?.ownerHash === db.getIdentity()?.ownerSubjectHash ? receipt : null;
}

export async function verifyCloudBackup(text: string, ownerHash: string, fingerprint?: string): Promise<void> {
  const data = await decodeBackup(text);
  if (data.localIdentity?.ownerSubjectHash !== ownerHash) throw new Error('Cloud backup owner mismatch.');
  if (fingerprint && await financialFingerprint(data) !== fingerprint) throw new Error('Cloud backup read-back verification failed.');
}

/** Complete immutable recovery copy alongside the retained per-device operation logs. */
export async function ensureCloudBackup(db: LocalDatabase, transport: DriveTransport): Promise<CloudBackupReceipt> {
  const ownerHash = db.getIdentity()?.ownerSubjectHash;
  if (!ownerHash) throw new Error('AUTH_REQUIRED: A verified Google owner is required for cloud backup.');
  await db.waitForPendingWrites();
  const fingerprint = await financialFingerprint(db.toSerializable());
  const files = await transport.listAppDataFiles();
  const previous = getCloudBackupReceipt(db);
  if (previous?.fingerprint === fingerprint && files.some(file => file.id === previous.fileId) &&
      Date.now() - Date.parse(previous.verifiedAt) < 10 * 60_000) return previous;
  const prefix = `hsc-v1-checkpoint-${ownerHash}-${fingerprint}`;
  let fileId: string | undefined;
  for (const file of files.filter(file => file.name.startsWith(prefix)).reverse()) {
    try { await verifyCloudBackup(await transport.downloadBatchFile(file.id), ownerHash, fingerprint); fileId = file.id; break; }
    catch { /* Keep damaged older copies; a new verified copy can repair backup availability. */ }
  }
  if (!fileId) {
    const text = await db.exportBackupFile();
    const uploaded = await transport.uploadBatchFile(`${prefix}-${Date.now()}.json`, text);
    if (!uploaded.fileId) throw new Error('Cloud backup upload returned no file identity.');
    const remote = await transport.downloadBatchFile(uploaded.fileId);
    if (remote !== text) throw new Error('Cloud backup read-back verification failed.');
    await verifyCloudBackup(remote, ownerHash, fingerprint);
    fileId = uploaded.fileId;
  }
  const receipt = { ownerHash, fingerprint, fileId, verifiedAt: new Date().toISOString() };
  db.getRawState().preferences.set(KEY, receipt);
  await db.persist();
  return receipt;
}
