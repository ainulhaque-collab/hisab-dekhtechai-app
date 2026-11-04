import type { Account, JournalTransaction, SyncOperation, Workspace } from '../contracts/types';
import { canonicalJson, computeSha256Sync } from '../sync/canonical';

export interface ReconciliationRecord {
  id: string; accountId: string; expectedMinor: string; actualMinor: string;
  fingerprint: string; note?: string;
}
export type ReportEvent = { version: 1; action: 'bookmark.set'; transactionId: string; revision: number; enabled: boolean }
  | { version: 1; action: 'reconciliation.record'; record: ReconciliationRecord };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160;
const minor = (value: unknown): value is string => typeof value === 'string' && /^-?(0|[1-9]\d{0,39})$/.test(value) && value !== '-0';
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
export function validateReportEvent(value: unknown): ReportEvent {
  if (!object(value) || value.version !== 1) throw new Error('REPORT_METADATA_INVALID');
  if (value.action === 'bookmark.set' && keys(value,['version','action','transactionId','revision','enabled']) &&
    id(value.transactionId) && Number.isSafeInteger(value.revision) && Number(value.revision) >= 1 && Number(value.revision) <= 1_000_000_000 && typeof value.enabled === 'boolean') return value as unknown as ReportEvent;
  if (value.action === 'reconciliation.record' && keys(value,['version','action','record']) && object(value.record)) {
    const r = value.record;
    if (keys(r,['id','accountId','expectedMinor','actualMinor','fingerprint','note']) && id(r.id) && id(r.accountId) &&
      minor(r.expectedMinor) && minor(r.actualMinor) && typeof r.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(r.fingerprint) &&
      (r.note === undefined || typeof r.note === 'string' && r.note.length <= 240)) return value as unknown as ReportEvent;
  }
  throw new Error('REPORT_METADATA_INVALID');
}
export function isReportOperation(op: SyncOperation): boolean {
  return !!op?.payload && Object.prototype.hasOwnProperty.call(op.payload,'reportEvent');
}
/** Additive immutable protocol-1 metadata, retained by older clients. Never
 * rewrites a journal, changes a balance or creates an extra storage authority. */
export function validateReportOperations(operations: Iterable<SyncOperation>, workspaces: Map<string, Workspace>,
  accounts: Map<string, Account>, transactions: Map<string, JournalTransaction>): void {
  const reconciliations = new Map<string,string>();
  for (const op of operations) if (isReportOperation(op)) {
    const ws = workspaces.get(op.entityId);
    if(typeof op.createdAtUtc!=='string'||!Number.isFinite(Date.parse(op.createdAtUtc))) throw new Error('REPORT_METADATA_INVALID');
    if (op.type !== 'workspace.update' || !ws || ws.ownerSubjectHash !== op.ownerHash ||
      op.authorSubjectHash && op.authorSubjectHash !== op.ownerHash || op.payload.id !== op.entityId || !keys(op.payload,['id','reportEvent'])) throw new Error('REPORT_METADATA_OWNER');
    if (op.contentSha256 && op.contentSha256 !== computeSha256Sync(canonicalJson(op.payload))) throw new Error('REPORT_METADATA_CHECKSUM');
    const event = validateReportEvent(op.payload.reportEvent);
    if (event.action === 'bookmark.set') {
      const tx = transactions.get(event.transactionId);
      if (tx && tx.workspaceId !== op.entityId) throw new Error('REPORT_METADATA_REFERENCE');
    } else {
      const account = accounts.get(event.record.accountId);
      if (account && (account.workspaceId !== op.entityId || (account.classification || 'asset') !== 'asset' || account.id.startsWith('sl-account-'))) throw new Error('REPORT_METADATA_REFERENCE');
      const content = canonicalJson({workspaceId:op.entityId,...event.record});
      if (reconciliations.has(event.record.id) && reconciliations.get(event.record.id) !== content) throw new Error('REPORT_METADATA_CONFLICT');
      reconciliations.set(event.record.id,content);
    }
  }
}
export function projectReportMetadata(operations: Iterable<SyncOperation>, workspaceId: string) {
  const bookmarks = new Map<string,{enabled:boolean;revision:number}>();
  const records = new Map<string, ReconciliationRecord & { createdAtUtc: string }>();
  for (const op of operations) if (isReportOperation(op) && op.entityId === workspaceId) {
    const event = validateReportEvent(op.payload.reportEvent);
    if (event.action === 'bookmark.set') {
      const previous = bookmarks.get(event.transactionId);
      // Logical revisions ignore clock skew; concurrent removes beat adds.
      // Re-adding after observing a remove increments the known revision.
      if (!previous || event.revision > previous.revision || event.revision === previous.revision && !event.enabled)
        bookmarks.set(event.transactionId,{enabled:event.enabled,revision:event.revision});
    } else if (!records.has(event.record.id) || op.createdAtUtc < records.get(event.record.id)!.createdAtUtc)
      records.set(event.record.id,{...event.record,createdAtUtc:op.createdAtUtc});
  }
  return { bookmarks, reconciliations:[...records.values()].sort((a,b)=>b.createdAtUtc.localeCompare(a.createdAtUtc)||a.id.localeCompare(b.id)) };
}
export function reconciliationFingerprint(account: Account, transactions: JournalTransaction[]): string {
  const journals = transactions.filter(tx=>tx.workspaceId===account.workspaceId).map(tx=>({id:tx.id,
    lines:tx.lines.filter(line=>!line.categoryId && line.accountId===account.id).map(line=>({id:line.id,debitMinor:line.debitMinor,creditMinor:line.creditMinor})).sort((a,b)=>a.id.localeCompare(b.id))
  })).filter(tx=>tx.lines.length).sort((a,b)=>a.id.localeCompare(b.id));
  return computeSha256Sync(canonicalJson({version:1,workspaceId:account.workspaceId,accountId:account.id,openingMinor:account.openingBalanceMinor,journals}));
}
