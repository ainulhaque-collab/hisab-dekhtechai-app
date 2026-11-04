import type { LocalOnlyResult, SyncProvider, SyncProviderKind } from '../../contracts/financialSync';

const savedLocally: LocalOnlyResult = Object.freeze({ kind: 'local_only' });

/** No DB, network, credentials, cursor advancement or outbox acknowledgement. */
export const localOnlySyncProvider: SyncProvider = Object.freeze({
  kind: 'LocalOnly',
  push: async () => savedLocally,
  pull: async () => savedLocally,
});

/** Postgres must be explicitly supplied; a missing adapter never pretends to sync. */
export function selectSyncProvider(
  kind: SyncProviderKind = 'LocalOnly',
  postgres?: SyncProvider,
): SyncProvider {
  if (kind === 'LocalOnly') return localOnlySyncProvider;
  if (kind === 'Postgres' && postgres?.kind === 'Postgres' &&
      typeof postgres.push === 'function' && typeof postgres.pull === 'function') return postgres;
  throw new Error('SYNC_PROVIDER_UNAVAILABLE');
}
