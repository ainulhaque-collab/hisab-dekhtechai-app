import { LocalDatabase } from '../storage/db';
import { BalancedJournal, SyncOperation } from '../contracts/types';
import { SYSTEM_ACCOUNTS } from '../contracts/ledger';
import { assertJournalBalanced } from '../domain/journal';
import { canonicalJson } from './canonical';

export class SyncDependencyError extends Error {
  constructor() { super('Synchronization is waiting for referenced records.'); }
}

export function requireDependencies(db: LocalDatabase, op: SyncOperation): void {
  const state = db.getRawState(), p = op.payload;
  const existing = (records: Map<string, any>, id: string) => {
    if (!records.has(id)) throw new SyncDependencyError();
  };
  const create = { 'account.create': 'account', 'category.create': 'category', 'party.create': 'party',
    'group.create': 'group', 'permission.grant': 'grant', 'budget.set': 'budget',
    'recurring.rule.create': 'rule', 'recurring.rule.update': 'rule' } as const;
  const field = create[op.type as keyof typeof create];
  if (field) {
    const record = p[field];
    if (!record || typeof record.id !== 'string' || typeof record.workspaceId !== 'string') throw new Error('Invalid synchronized definition.');
    existing(state.workspaces, record.workspaceId);
  }
  const maps: Record<string, Map<string, any>> = { workspace: state.workspaces, account: state.accounts,
    category: state.categories, party: state.parties, group: state.accountGroups, permission: state.accountPermissions };
  const [kind, action] = op.type.split('.');
  if (maps[kind] && ['update', 'archive', 'restore', 'revoke'].includes(action)) existing(maps[kind], p.id || op.entityId);
  if (op.type === 'journal.correct' || op.type === 'journal.delete') existing(state.journalTransactions, p.originalTransactionId);
}

export function validateIncomingJournal(db: LocalDatabase, balanced: BalancedJournal): void {
  if (!balanced?.transaction?.id || !Array.isArray(balanced.lines)) throw new Error('Invalid synchronized journal.');
  const tx = balanced.transaction, state = db.getRawState();
  if (!state.workspaces.has(tx.workspaceId)) throw new SyncDependencyError();
  assertJournalBalanced(balanced.lines);
  const ids = new Set<string>();
  for (const line of balanced.lines) {
    if (!line.id || ids.has(line.id) || line.transactionId !== tx.id ||
        typeof line.debitMinor !== 'string' || typeof line.creditMinor !== 'string' ||
        !/^\d+$/.test(line.debitMinor) || !/^\d+$/.test(line.creditMinor)) throw new Error('Invalid synchronized journal line.');
    ids.add(line.id);
    let account = state.accounts.get(line.accountId);
    if (!account && !Object.values(SYSTEM_ACCOUNTS).includes(line.accountId as any)) {
      // Another device can post while an apparently empty account is deleted offline.
      // Recover its retained definition as archived rather than lose the journal.
      const history = Array.from(state.syncOperations.values()).filter(op => op.entityId === line.accountId);
      const creation = history.find(op => op.type === 'account.create')?.payload.account;
      const deletion = history.find(op => op.type === 'account.delete');
      if (creation && deletion) {
        account = { ...creation, archivedAt: deletion.createdAtUtc };
        state.accounts.set(line.accountId, account!);
      }
    }
    if (!account && !Object.values(SYSTEM_ACCOUNTS).includes(line.accountId as any)) throw new SyncDependencyError();
    if (account && account.workspaceId !== tx.workspaceId) throw new Error('Synchronized account workspace mismatch.');
    if (line.categoryId) {
      const category = state.categories.get(line.categoryId);
      if (!category) throw new SyncDependencyError();
      if (category.workspaceId !== tx.workspaceId) throw new Error('Synchronized category workspace mismatch.');
    }
    const oldLine = state.journalLines.get(line.id);
    if (oldLine && canonicalJson(oldLine) !== canonicalJson(line)) throw new Error('Immutable journal line conflict.');
  }
  if (tx.partyId && !state.parties.has(tx.partyId)) throw new SyncDependencyError();
  const old = state.journalTransactions.get(tx.id);
  if (old) {
    const immutable = (record: any) => { const { isDeleted, isReplacedBy, createdOpId, ...rest } = record; return rest; };
    if (canonicalJson(immutable(old)) !== canonicalJson(immutable({ ...tx, lines: balanced.lines }))) throw new Error('Immutable journal conflict.');
  }
}
