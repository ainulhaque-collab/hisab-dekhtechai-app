import test from 'node:test';
import assert from 'node:assert/strict';
import type { FinancialSyncOperation, PushRequest, PullRequest, SyncProvider } from '../contracts/financialSync';
import { acceptedSyncOperations, assertPushRequest, syncMinorUnits, validatePullPage } from '../sync/financialSyncBoundary';
import { selectSyncProvider } from '../sync/providers/localOnly';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { buildOpeningBalanceJournal, generateUUID } from '../domain/journal';
import { canonicalJson, computeSha256 } from '../sync/canonical';

const owner = '11111111-1111-4111-8111-111111111111';
const workspace = '22222222-2222-4222-8222-222222222222';
const device = '33333333-3333-4333-8333-333333333333';
const other = '99999999-9999-4999-8999-999999999999';
const scope = { ownerId: owner, workspaceId: workspace, deviceId: device };
const op = (sequence = '1'): FinancialSyncOperation => ({
  protocolVersion: 1, operationId: generateUUID(), workspaceId: workspace, deviceId: device,
  sequence, entityId: generateUUID(), type: 'journal.post', createdAtUtc: '2026-11-04T08:00:00.000Z',
  contentSha256: 'a'.repeat(64), payload: { amountMinor: '12080' },
});
const push = (operations = [op()]): PushRequest => ({ requestId: generateUUID(), scope, operations });
const pull = (cursor: string | null = 'opaque:900719925474099312345'): PullRequest => ({ requestId: generateUUID(), scope, cursor, limit: 20 });
const reply = (request: PushRequest) => ({ kind: 'remote', requestId: request.requestId,
  ownerId: owner, workspaceId: workspace, outcomes: request.operations.map(operation => ({
    operationId: operation.operationId, contentSha256: operation.contentSha256, outcome: 'accepted',
  })) });
const page = (request: PullRequest) => ({ kind: 'remote', requestId: request.requestId,
  ownerId: owner, workspaceId: workspace, previousCursor: request.cursor,
  nextCursor: 'opaque:900719925474099312346', hasMore: false,
  changes: [{ changeId: 'server-event:1', operation: op() }],
});
const rejects = (work: () => unknown) => assert.throws(work, /^SyncContractError: SYNC_CONTRACT_INVALID$/);

test('Minor units retain exact signed-bigint boundaries and reject lossy JSON numbers', () => {
  for (const amount of ['0', '12080', '-12080', '9007199254740993', '9223372036854775807', '-9223372036854775808']) {
    assert.equal(syncMinorUnits(amount), amount);
  }
  for (const amount of [12080, 9007199254740993, 120.8, 1n, '120.80', '১২০৮০', '1e3', '+1', '01', '-0', '', ' 1',
    '9223372036854775808', '-9223372036854775809', NaN, Infinity, null, {}]) rejects(() => syncMinorUnits(amount));
});

test('Envelope rejects foreign workspace/device, reused IDs/sequences and unsupported operations', () => {
  const request = push([op('9007199254740993'), op('9007199254740994')]);
  assert.doesNotThrow(() => assertPushRequest(request));
  for (const mutation of [
    { workspaceId: other }, { deviceId: other }, { sequence: 1 }, { sequence: '0' },
    { sequence: '9223372036854775808' }, { contentSha256: '' }, { protocolVersion: 2 },
    { type: 'journal.overwrite' }, { type: '__proto__' }, { payload: null },
    { createdAtUtc: '2026-02-30T08:00:00.000Z' }, { createdAtUtc: '2026-11-04T08:00:00+06:00' },
  ]) rejects(() => assertPushRequest(push([{ ...op(), ...mutation } as FinancialSyncOperation])));
  rejects(() => assertPushRequest({ ...request, scope: { ...scope, ownerId: 'legacy-google-hash' } }));
  rejects(() => assertPushRequest(push([request.operations[0], { ...request.operations[1], operationId: request.operations[0].operationId }])));
  rejects(() => assertPushRequest(push([op('2'), op('2')])));
  rejects(() => assertPushRequest(push(Array.from({ length: 101 }, (_, n) => op(String(n + 1))))));
});

test('Only exact accepted/duplicate acknowledgements leave the pending set', () => {
  const request = push(Array.from({ length: 5 }, (_, n) => op(String(n + 1))));
  const response = reply(request);
  ['accepted', 'duplicate', 'conflict', 'rejected', 'retry'].forEach((outcome, n) => { response.outcomes[n].outcome = outcome; });
  assert.deepEqual(acceptedSyncOperations(request, response), request.operations.slice(0, 2).map(operation => ({ operationId: operation.operationId, contentSha256: operation.contentSha256 })));
  assert.deepEqual(acceptedSyncOperations(request, response), acceptedSyncOperations(request, response), 'Duplicate replies produce stable IDs, not a second posting');
});

test('Wrong owner/request/hash, partial replies and duplicate/unknown acknowledgements fail as a whole', () => {
  const request = push([op('1'), op('2')]);
  for (const mutation of [{ ownerId: other }, { workspaceId: other }, { requestId: other }, { kind: 'ok' }, { outcomes: [] }]) {
    rejects(() => acceptedSyncOperations(request, { ...reply(request), ...mutation }));
  }
  for (const mutation of [{ contentSha256: 'b'.repeat(64) }, { operationId: other }, { outcome: 'uploaded' }]) {
    const response = reply(request); Object.assign(response.outcomes[1], mutation);
    rejects(() => acceptedSyncOperations(request, response));
  }
  const response = reply(request); response.outcomes[1] = { ...response.outcomes[0] };
  rejects(() => acceptedSyncOperations(request, response));
  for (const malformed of [null, true, [], {}, { status: 200 }, { kind: 'local_only', outcomes: reply(request).outcomes }]) {
    rejects(() => acceptedSyncOperations(request, malformed));
  }
});

test('Pull preserves opaque cursor strings and accepts changes authored on another device', () => {
  const request = pull(), response = page(request);
  response.changes[0].operation = { ...response.changes[0].operation, deviceId: other };
  const validated = validatePullPage(request, response)!;
  assert.equal(validated.previousCursor, request.cursor);
  assert.equal(validated.nextCursor, 'opaque:900719925474099312346');
  assert.equal(validated.changes[0].operation.deviceId, other);
  assert.equal(validatePullPage(request, { kind: 'local_only' }), null);
  assert.doesNotThrow(() => validatePullPage(request, { ...response, changes: [], nextCursor: request.cursor }));
});

test('Pull rejects stale/reset cursors, non-progress, mixed scope, duplicate or over-limit events', () => {
  const request = pull(), response = page(request);
  for (const mutation of [
    { ownerId: other }, { workspaceId: other }, { requestId: other }, { previousCursor: null },
    { nextCursor: request.cursor }, { nextCursor: null }, { nextCursor: 9007199254740992 },
    { nextCursor: 'bad\ncursor' }, { hasMore: 'false' },
    { changes: [{ ...response.changes[0], operation: { ...op(), workspaceId: other } }] },
    { changes: [response.changes[0], response.changes[0]] },
    { changes: [response.changes[0], { changeId: 'different', operation: response.changes[0].operation }] },
  ]) rejects(() => validatePullPage(request, { ...response, ...mutation }));
  rejects(() => validatePullPage(request, { ...response, hasMore: true, changes: [], nextCursor: request.cursor }));
  rejects(() => validatePullPage(request, { ...response, changes: [], nextCursor: null }));
  rejects(() => validatePullPage({ ...request, limit: 0 }, response));
  rejects(() => validatePullPage({ ...request, limit: 101 }, response));
  rejects(() => validatePullPage({ ...request, limit: 1 }, { ...response, changes: [response.changes[0], { changeId: 'different', operation: op() }] }));
});

test('Provider routing defaults to local and fails closed without an explicit Postgres adapter', async () => {
  const local = selectSyncProvider();
  assert.equal(local.kind, 'LocalOnly');
  assert.deepEqual(await local.push(push()), { kind: 'local_only' });
  assert.deepEqual(await local.pull(pull()), { kind: 'local_only' });
  assert.throws(() => selectSyncProvider('Postgres'), /SYNC_PROVIDER_UNAVAILABLE/);
  assert.throws(() => selectSyncProvider('Postgres', local), /SYNC_PROVIDER_UNAVAILABLE/);
  assert.throws(() => selectSyncProvider('Drive' as never), /SYNC_PROVIDER_UNAVAILABLE/);
  assert.throws(() => selectSyncProvider('Postgres', { kind: 'Postgres' } as SyncProvider), /SYNC_PROVIDER_UNAVAILABLE/);
  const explicit: SyncProvider = { kind: 'Postgres', push: async () => { throw Error('NOT_IMPLEMENTED_IN_PR1'); }, pull: async () => { throw Error('NOT_IMPLEMENTED_IN_PR1'); } };
  assert.equal(selectSyncProvider('Postgres', explicit), explicit);
});

test('Offline journal/outbox survive LocalOnly attempts and driver reload without a network request', async () => {
  const driver = new LocalStorageFallbackDriver(), db = new LocalDatabase('pr1-synthetic-local-only', driver);
  await db.init(); db.setDeviceIdentity(device, 'Synthetic local-only test');
  const ws = db.createWorkspace('Synthetic sync test', 'personal');
  const account = db.createAccount(ws.id, 'Synthetic cash', 'cash', '0');
  const journal = buildOpeningBalanceJournal({ workspaceId: ws.id, assetAccountId: account.id, amountMinor: '12080',
    effectiveDate: '2026-11-04', opId: generateUUID() });
  const payload = { balancedJournal: journal }, contentSha256 = await computeSha256(canonicalJson(payload));
  const operation = { protocolVersion: 1 as const, ownerHash: 'local-owner', deviceId: device, seq: db.getNextDeviceSeq(),
    operationId: journal.transaction.createdOpId, entityId: journal.transaction.id, type: 'journal.post' as const,
    createdAtUtc: journal.transaction.occurredAtUtc, payload, contentSha256 };
  await db.commitJournalWithOutbox(journal, operation); await db.waitForPendingWrites();
  const before = canonicalJson(db.getRawState().journalTransactions.get(journal.transaction.id));
  const pending = db.getPendingOutbox().map(item => item.operationId);
  const request = push([{ ...op(), operationId: operation.operationId, workspaceId: ws.id, entityId: journal.transaction.id, payload, contentSha256 }]);
  const scoped = { ...request, scope: { ...scope, workspaceId: ws.id } };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('OFFLINE_SYNTHETIC'); };
  try {
    const provider = selectSyncProvider();
    assert.deepEqual(acceptedSyncOperations(scoped, await provider.push(scoped)), []);
    const pullRequest = { ...pull(null), scope: scoped.scope };
    assert.equal(validatePullPage(pullRequest, await provider.pull(pullRequest)), null);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
  const restored = new LocalDatabase('pr1-synthetic-local-only', driver); await restored.init();
  assert.equal(canonicalJson(restored.getTransaction(journal.transaction.id)), before);
  assert.deepEqual(restored.getPendingOutbox().map(item => item.operationId), pending);
  assert.equal(restored.getTransaction(journal.transaction.id)!.lines.reduce((sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n), 0n);
});
