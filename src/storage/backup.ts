import { canonicalJson, computeSha256, computeSha256Sync } from '../sync/canonical';
import { SYSTEM_ACCOUNTS } from '../contracts/ledger';

export const MAX_BACKUP_BYTES = 40 * 1024 * 1024;
const MAPS = ['workspaces', 'accounts', 'accountGroups', 'accountPermissions', 'categories', 'parties',
  'journalTransactions', 'journalLines', 'syncOperations', 'syncOutbox', 'syncDeviceHeads', 'conflicts',
  'budgets', 'recurringRules', 'recurringOccurrences', 'receiptBlobs', 'preferences'] as const;
type Data = Record<string, any>;
export interface BackupFile {
  format: 'hisab-backup'; version: 1; createdAt: string; dataJson: string; sha256: string;
}

export async function encodeBackup(data: Data): Promise<string> {
  const dataJson = JSON.stringify({ ...data, localSnapshots: [] });
  const envelope: BackupFile = { format: 'hisab-backup', version: 1, createdAt: new Date().toISOString(),
    dataJson, sha256: await computeSha256(dataJson) };
  const text = JSON.stringify(envelope);
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('BACKUP_TOO_LARGE');
  return text;
}

export async function decodeBackup(text: string): Promise<Data> {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('BACKUP_TOO_LARGE');
  let file: BackupFile;
  try { file = JSON.parse(text); } catch { throw new Error('BACKUP_INVALID'); }
  if (file?.format !== 'hisab-backup' || file.version !== 1 || typeof file.dataJson !== 'string' ||
      typeof file.sha256 !== 'string') throw new Error('BACKUP_INVALID');
  if (await computeSha256(file.dataJson) !== file.sha256) throw new Error('BACKUP_CHECKSUM');
  try { return JSON.parse(file.dataJson); } catch { throw new Error('BACKUP_INVALID'); }
}

/** Current records win. Derived operation checksums may be absent in older local copies. */
export function mergeBackup(current: Data, incoming: Data, replaceUntouchedStarters = false): Data {
  if (!incoming || ![4, 5].includes(incoming.schemaVersion)) throw new Error('BACKUP_VERSION');
  if (!Array.isArray(incoming.workspaces) || !Array.isArray(incoming.accounts) ||
      !Array.isArray(incoming.journalTransactions) || !Array.isArray(incoming.journalLines)) throw new Error('BACKUP_INVALID');
  const owner = current.localIdentity?.ownerSubjectHash || null;
  if (owner !== (incoming.localIdentity?.ownerSubjectHash || null)) throw new Error('BACKUP_OWNER');
  const owned = (hash: any) => owner ? hash === owner : !hash || hash === 'local-owner' || hash === 'unassigned';
  const result: Data = { ...current };
  for (const key of MAPS) {
    const entries = incoming[key] || [];
    if (!Array.isArray(entries)) throw new Error('BACKUP_INVALID');
    const seen = new Set<string>();
    const merged = new Map<string, any>(current[key] || []);
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || seen.has(entry[0])) throw new Error('BACKUP_INVALID');
      const [id, value] = entry; seen.add(id);
      if (key !== 'preferences' && key !== 'syncDeviceHeads' && (!value || typeof value !== 'object')) throw new Error('BACKUP_INVALID');
      if (key === 'workspaces' && (!owned(value.ownerSubjectHash) || value.id !== id)) throw new Error('BACKUP_OWNER');
      if (key === 'syncOperations' && (!owned(value.ownerHash) || value.operationId !== id)) throw new Error('BACKUP_OWNER');
      if (key === 'syncOperations') {
        for (const op of [value, ...(merged.has(id) ? [merged.get(id)] : [])]) {
          if (op.contentSha256 && op.contentSha256 !== computeSha256Sync(canonicalJson(op.payload))) throw new Error('BACKUP_CHECKSUM');
        }
        if (merged.has(id)) {
          const { contentSha256: currentHash, ...currentOperation } = merged.get(id);
          const { contentSha256: incomingHash, ...incomingOperation } = value;
          if (canonicalJson(currentOperation) !== canonicalJson(incomingOperation)) throw new Error('BACKUP_CONFLICT');
        }
      }
      if (['journalTransactions', 'journalLines'].includes(key) && merged.has(id) &&
          canonicalJson(merged.get(id)) !== canonicalJson(value)) throw new Error('BACKUP_CONFLICT');
      if (!replaceUntouchedStarters && ['accounts', 'parties'].includes(key) && merged.has(id) &&
          merged.get(id).openingBalanceMinor !== value.openingBalanceMinor) throw new Error('BACKUP_CONFLICT');
      if (!replaceUntouchedStarters && key === 'accounts' && merged.has(id) &&
          (merged.get(id).classification || 'asset') !== (value.classification || 'asset')) throw new Error('BACKUP_CONFLICT');
      if (!merged.has(id) || (replaceUntouchedStarters && ['workspaces', 'accounts', 'categories', 'parties'].includes(key))) merged.set(id, key === 'syncOutbox' && value.uploadedStatus === 'uploading'
        ? { ...value, uploadedStatus: 'pending', nextAttemptAt: null } : value);
    }
    result[key] = Array.from(merged);
  }
  const ws = new Map<string, any>(result.workspaces), accounts = new Map<string, any>(result.accounts);
  const categories = new Map<string, any>(result.categories), journals = new Map<string, any>(result.journalTransactions);
  const lines = new Map<string, any>(result.journalLines), ops = new Map<string, any>(result.syncOperations);
  for (const entity of ws.values()) {
    if (typeof entity.name !== 'string' || !['personal', 'business'].includes(entity.kind) || entity.currency !== 'BDT') throw new Error('BACKUP_INVALID');
  }
  for (const [, account] of result.accounts) {
    if (typeof account.name !== 'string' || typeof account.openingBalanceMinor !== 'string' || !/^-?\d+$/.test(account.openingBalanceMinor)) throw new Error('BACKUP_INVALID');
  }
  for (const key of ['accounts', 'accountGroups', 'accountPermissions', 'categories', 'parties', 'budgets', 'recurringRules']) {
    for (const [id, entity] of result[key]) {
      if (entity.id !== id || !ws.has(entity.workspaceId)) throw new Error('BACKUP_INVALID');
    }
  }
  for (const [id, tx] of journals) {
    if (tx.id !== id || !ws.has(tx.workspaceId) || !Array.isArray(tx.lines) || tx.lines.length < 2) throw new Error('BACKUP_LEDGER');
    let debit = 0n, credit = 0n; const seen = new Set<string>();
    for (const line of tx.lines) {
      if (!line || seen.has(line.id) || line.transactionId !== id ||
          typeof line.debitMinor !== 'string' || typeof line.creditMinor !== 'string' ||
          !/^\d+$/.test(line.debitMinor) || !/^\d+$/.test(line.creditMinor) ||
          canonicalJson(lines.get(line.id)) !== canonicalJson(line)) throw new Error('BACKUP_LEDGER');
      seen.add(line.id);
      const account = accounts.get(line.accountId);
      if (account ? account.workspaceId !== tx.workspaceId : !Object.values(SYSTEM_ACCOUNTS).includes(line.accountId)) throw new Error('BACKUP_LEDGER');
      if (line.categoryId && categories.get(line.categoryId)?.workspaceId !== tx.workspaceId) throw new Error('BACKUP_LEDGER');
      debit += BigInt(line.debitMinor); credit += BigInt(line.creditMinor);
    }
    if (debit !== credit) throw new Error('BACKUP_LEDGER');
  }
  for (const [id, line] of lines) {
    if (line.id !== id || !journals.get(line.transactionId)?.lines.some((item: any) => item.id === id)) throw new Error('BACKUP_LEDGER');
  }
  for (const [id, entry] of result.syncOutbox) {
    if (entry.opId !== id || !ops.has(id) || !['pending', 'uploading', 'uploaded', 'failed'].includes(entry.uploadedStatus)) throw new Error('BACKUP_INVALID');
  }
  for (const op of ops.values()) {
    if (op.protocolVersion !== 1 || typeof op.deviceId !== 'string' || !op.deviceId ||
        !Number.isSafeInteger(op.seq) || op.seq < 1 || !op.payload || typeof op.payload !== 'object') throw new Error('BACKUP_INVALID');
  }
  if (!Array.isArray(incoming.appliedOperations || [])) throw new Error('BACKUP_INVALID');
  result.appliedOperations = [...new Set([...(current.appliedOperations || []), ...(incoming.appliedOperations || [])])];
  result.schemaVersion = 5;
  // Never reuse the imported device identity or roll its counter backwards.
  result.deviceIdentity = { ...current.deviceIdentity };
  for (const op of ops.values()) {
    if (op.deviceId === result.deviceIdentity.deviceId) result.deviceIdentity.counter = Math.max(result.deviceIdentity.counter, op.seq + 1);
  }
  return result;
}
