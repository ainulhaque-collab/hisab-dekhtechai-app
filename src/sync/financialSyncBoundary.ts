import type {
  FinancialSyncOperation, PullRequest, PushRequest, RemotePullResult, SyncScope, SyncAcknowledgement,
} from '../contracts/financialSync';
import type { SyncOperationType } from '../contracts/types';

export class SyncContractError extends Error {
  constructor() { super('SYNC_CONTRACT_INVALID'); this.name = 'SyncContractError'; }
}
const invalid = (): never => { throw new SyncContractError(); };
const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null &&
  typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const cursor = (value: unknown) => value === null ||
  (typeof value === 'string' && /^[\x21-\x7e]{1,2048}$/.test(value));
const operationTypes: Record<SyncOperationType, true> = {
  'workspace.create': true, 'workspace.update': true, 'workspace.archive': true,
  'account.create': true, 'account.update': true, 'account.archive': true,
  'account.restore': true, 'account.delete': true,
  'group.create': true, 'group.update': true, 'group.archive': true, 'group.restore': true,
  'permission.grant': true, 'permission.revoke': true,
  'category.create': true, 'category.update': true, 'category.archive': true,
  'party.create': true, 'party.update': true, 'party.archive': true,
  'journal.post': true, 'journal.correct': true, 'journal.delete': true, 'budget.set': true,
  'recurring.rule.create': true, 'recurring.rule.update': true, 'recurring.occurrence.post': true,
  'receipt.attach': true,
};

/** Decimal strings keep bigint values exact in JSON and portable Postgres adapters. */
export function syncMinorUnits(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|-?[1-9][0-9]{0,18})$/.test(value)) return invalid();
  const amount = BigInt(value);
  if (amount < -9223372036854775808n || amount > 9223372036854775807n) return invalid();
  return value;
}

function validScope(scope: unknown): asserts scope is SyncScope {
  if (!record(scope) || !uuid(scope.ownerId) || !uuid(scope.workspaceId) || !uuid(scope.deviceId)) invalid();
}
function validOperation(value: unknown, workspaceId: string): asserts value is FinancialSyncOperation {
  if (!record(value) || value.protocolVersion !== 1 || !uuid(value.operationId) ||
      value.workspaceId !== workspaceId || !uuid(value.deviceId) || !uuid(value.entityId) ||
      typeof value.sequence !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value.sequence) ||
      BigInt(value.sequence) > 9223372036854775807n || !hash(value.contentSha256) ||
      typeof value.type !== 'string' || !Object.hasOwn(operationTypes, value.type) ||
      typeof value.createdAtUtc !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAtUtc) ||
      !Number.isFinite(Date.parse(value.createdAtUtc)) || new Date(value.createdAtUtc).toISOString() !== value.createdAtUtc ||
      !record(value.payload)) invalid();
}

export function assertPushRequest(request: PushRequest): void {
  if (!record(request) || !uuid(request.requestId)) invalid();
  validScope(request.scope);
  if (!Array.isArray(request.operations) || request.operations.length > 100) invalid();
  const seen = new Set<string>();
  let sequence = 0n;
  for (const operation of request.operations) {
    validOperation(operation, request.scope.workspaceId);
    if (operation.deviceId !== request.scope.deviceId || seen.has(operation.operationId) ||
        BigInt(operation.sequence) <= sequence) invalid();
    seen.add(operation.operationId); sequence = BigInt(operation.sequence);
  }
}

function validResponse(request: PushRequest | PullRequest, response: Record<string, unknown>): void {
  if (response.kind !== 'remote' || response.requestId !== request.requestId ||
      response.ownerId !== request.scope.ownerId || response.workspaceId !== request.scope.workspaceId) invalid();
}
function localOnly(response: Record<string, unknown>): boolean {
  if (response.kind !== 'local_only') return false;
  if (Object.keys(response).length !== 1) invalid();
  return true;
}

/** Validate the entire reply before returning any ID/hash pairs. HTTP 200 alone is not an acknowledgement. */
export function acceptedSyncOperations(request: PushRequest, response: unknown): readonly SyncAcknowledgement[] {
  assertPushRequest(request);
  if (!record(response)) return invalid();
  if (localOnly(response)) return Object.freeze([]);
  validResponse(request, response);
  if (!Array.isArray(response.outcomes) || response.outcomes.length !== request.operations.length) return invalid();
  const pending = new Map(request.operations.map(operation => [operation.operationId, operation.contentSha256]));
  const acknowledged: SyncAcknowledgement[] = [];
  for (const outcome of response.outcomes) {
    if (!record(outcome) || typeof outcome.operationId !== 'string' ||
        !pending.has(outcome.operationId) || pending.get(outcome.operationId) !== outcome.contentSha256 ||
        !['accepted', 'duplicate', 'conflict', 'rejected', 'retry'].includes(outcome.outcome as string)) return invalid();
    pending.delete(outcome.operationId);
    if (outcome.outcome === 'accepted' || outcome.outcome === 'duplicate') acknowledged.push(Object.freeze({
      operationId: outcome.operationId, contentSha256: outcome.contentSha256 as string,
    }));
  }
  return Object.freeze(acknowledged);
}

/** Validation only: applying changes and committing the cursor must be one local transaction. */
export function validatePullPage(request: PullRequest, response: unknown): RemotePullResult | null {
  if (!record(request) || !uuid(request.requestId)) return invalid();
  validScope(request.scope);
  if (!cursor(request.cursor) || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) return invalid();
  if (!record(response)) return invalid();
  if (localOnly(response)) return null;
  validResponse(request, response);
  if (response.previousCursor !== request.cursor || !cursor(response.nextCursor) || typeof response.hasMore !== 'boolean' ||
      !Array.isArray(response.changes) || response.changes.length > request.limit ||
      (request.cursor !== null && response.nextCursor === null) ||
      ((response.changes.length > 0 || response.hasMore) && (response.nextCursor === null || response.nextCursor === request.cursor))) return invalid();
  const ids = new Set<string>(), operations = new Set<string>();
  for (const change of response.changes) {
    if (!record(change) || typeof change.changeId !== 'string' || !cursor(change.changeId) || ids.has(change.changeId)) return invalid();
    validOperation(change.operation, request.scope.workspaceId);
    if (operations.has(change.operation.operationId)) return invalid();
    ids.add(change.changeId); operations.add(change.operation.operationId);
  }
  return response as unknown as RemotePullResult;
}
