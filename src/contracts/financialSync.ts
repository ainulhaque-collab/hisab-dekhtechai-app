import type { SyncOperationType } from './types';

export type SyncProviderKind = 'LocalOnly' | 'Postgres';
export type SyncCursor = string | null;

/** Supplied by a verified Auth adapter, never inferred from email or legacy ownerHash. */
export interface SyncIdentity { readonly subject: string; readonly issuer: string }
export interface SyncAuthPort {
  getVerifiedIdentity(): Promise<SyncIdentity | null>;
  signOut(): Promise<void>;
}

/** A routing fence, not proof of server-side authorization. */
export interface SyncScope {
  readonly ownerId: string;
  readonly workspaceId: string;
  readonly deviceId: string;
}

/** Versioned transport envelope. Domain handlers must validate each payload before use. */
export interface FinancialSyncOperation {
  readonly protocolVersion: 1;
  readonly operationId: string;
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly sequence: string;
  readonly entityId: string;
  readonly type: SyncOperationType;
  readonly createdAtUtc: string;
  readonly contentSha256: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PushRequest {
  readonly requestId: string;
  readonly scope: SyncScope;
  readonly operations: readonly FinancialSyncOperation[];
}
export interface PullRequest {
  readonly requestId: string;
  readonly scope: SyncScope;
  readonly cursor: SyncCursor;
  readonly limit: number;
}

export interface LocalOnlyResult { readonly kind: 'local_only' }
export interface PushOutcome {
  readonly operationId: string;
  readonly contentSha256: string;
  readonly outcome: 'accepted' | 'duplicate' | 'conflict' | 'rejected' | 'retry';
}
export interface SyncAcknowledgement {
  readonly operationId: string;
  readonly contentSha256: string;
}
export interface RemotePushResult {
  readonly kind: 'remote';
  readonly requestId: string;
  readonly ownerId: string;
  readonly workspaceId: string;
  readonly outcomes: readonly PushOutcome[];
}
export interface SyncChange {
  readonly changeId: string;
  readonly operation: FinancialSyncOperation;
}
export interface RemotePullResult {
  readonly kind: 'remote';
  readonly requestId: string;
  readonly ownerId: string;
  readonly workspaceId: string;
  readonly previousCursor: SyncCursor;
  readonly nextCursor: SyncCursor;
  readonly hasMore: boolean;
  readonly changes: readonly SyncChange[];
}

/** Remote adapters own credentials; UI/domain code receives no token or SDK client. */
export interface SyncProvider {
  readonly kind: SyncProviderKind;
  push(request: PushRequest, signal?: AbortSignal): Promise<LocalOnlyResult | RemotePushResult>;
  pull(request: PullRequest, signal?: AbortSignal): Promise<LocalOnlyResult | RemotePullResult>;
}

/** Implement in PR-3 over SQLite/IndexedDB, with owner/workspace-scoped durable state. */
export interface LocalSyncStorePort {
  readPending(scope: SyncScope, limit: number): Promise<readonly FinancialSyncOperation[]>;
  readCursor(scope: SyncScope): Promise<SyncCursor>;
  /** Atomically compare active scope AND each pending operation's current hash before acknowledging. */
  acknowledge(scope: SyncScope, expected: readonly SyncAcknowledgement[]): Promise<void>;
  /** Compare expectedCursor, validate/merge all changes, persist nextCursor atomically or roll everything back. */
  applyPullPageAtomically(scope: SyncScope, expectedCursor: SyncCursor, page: RemotePullResult): Promise<void>;
}
