import type { Account, SyncOperation, Workspace } from '../contracts/types';
import { projectSavingsGoals, validateSavingsDeletion, validateSavingsGoalEvent, type SavingsEventRecord } from '../domain/savingsGoals';
import { canonicalJson, computeSha256Sync } from '../sync/canonical';

/** An additive workspace metadata extension. Protocol-1 clients retain the full
 * immutable operation while ignoring this field; journals/schema stay unchanged. */
export function isSavingsOperation(op: SyncOperation): boolean {
  return !!op?.payload && (Object.prototype.hasOwnProperty.call(op.payload, 'savingsEvent') ||
    Object.prototype.hasOwnProperty.call(op.payload, 'savingsDeletion'));
}

function eventFromOperation(op: SyncOperation) {
  if (Object.prototype.hasOwnProperty.call(op.payload, 'savingsDeletion')) return validateSavingsDeletion(op.payload.savingsDeletion);
  const event = validateSavingsGoalEvent(op.payload.savingsEvent);
  if (event.action === 'goal.delete') throw new Error('SAVINGS_EVENT_INVALID');
  return event;
}

export function savingsRecords(operations: Iterable<SyncOperation>, workspaceId: string): SavingsEventRecord[] {
  return Array.from(operations).filter(op => isSavingsOperation(op) && op.entityId === workspaceId)
    .map(op => ({ operationId: op.operationId, createdAtUtc: op.createdAtUtc,
      event: eventFromOperation(op) }));
}

/** Validate retained history as well as fresh operations: an older client may
 * already have marked an extension applied without understanding its contents. */
export function validateSavingsOperations(operations: Iterable<SyncOperation>, workspaces: Map<string, Workspace>,
  accounts: Map<string, Account>): void {
  const savings = Array.from(operations).filter(isSavingsOperation);
  const goalWorkspaces = new Map<string, string>();
  const allocations = new Map<string, { goalId: string; workspaceId: string }>();
  for (const op of savings) {
    const ws = workspaces.get(op.entityId);
    const field = Object.prototype.hasOwnProperty.call(op.payload, 'savingsDeletion') ? 'savingsDeletion' : 'savingsEvent';
    if (op.type !== 'workspace.update' || op.payload.id !== op.entityId ||
        Object.keys(op.payload).some(key => !['id', field].includes(key)) ||
        !ws || ws.ownerSubjectHash !== op.ownerHash || op.authorSubjectHash && op.authorSubjectHash !== op.ownerHash)
      throw new Error('SAVINGS_OWNER_MISMATCH');
    if (op.contentSha256 && op.contentSha256 !== computeSha256Sync(canonicalJson(op.payload))) throw new Error('SAVINGS_EVENT_INVALID');
    const event = eventFromOperation(op);
    if (event.action === 'goal.set') {
      if (event.goal.workspaceId !== op.entityId || goalWorkspaces.has(event.goal.id) && goalWorkspaces.get(event.goal.id) !== op.entityId)
        throw new Error('SAVINGS_EVENT_CONFLICT');
      goalWorkspaces.set(event.goal.id, op.entityId);
    } else if (event.action === 'allocation.add') {
      const account = accounts.get(event.accountId);
      if (account && (account.workspaceId !== op.entityId || (account.classification || 'asset') !== 'asset'))
        throw new Error('SAVINGS_ACCOUNT_UNAVAILABLE');
      const prior = allocations.get(event.allocationId);
      if (prior && (prior.workspaceId !== op.entityId || prior.goalId !== event.goalId)) throw new Error('SAVINGS_EVENT_CONFLICT');
      allocations.set(event.allocationId, { goalId: event.goalId, workspaceId: op.entityId });
    }
  }
  for (const op of savings) {
    const event = eventFromOperation(op);
    if (event.action === 'goal.set') continue;
    if (goalWorkspaces.has(event.goalId) && goalWorkspaces.get(event.goalId) !== op.entityId) throw new Error('SAVINGS_EVENT_CONFLICT');
    if (event.action === 'allocation.release') {
      const add = allocations.get(event.allocationId);
      if (add && (add.workspaceId !== op.entityId || add.goalId !== event.goalId)) throw new Error('SAVINGS_EVENT_CONFLICT');
    }
  }
  for (const id of new Set(savings.map(op => op.entityId))) {
    // Validate immutable collisions and release references even when projection
    // caches are absent. Missing legacy-deleted accounts simply cannot fund goals.
    projectSavingsGoals(savingsRecords(savings, id), id, {}, '2000-01-01');
  }
}
