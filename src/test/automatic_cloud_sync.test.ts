import test, { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { AutomaticSync } from '../sync/automaticSync';
import { SyncOrchestrator } from '../sync/orchestrator';
import { SimulatedGoogleDriveTransport, RealGoogleDriveTransport, DriveTransport } from '../drive/transport';
import { GoogleAuthManager, computeOwnerSubjectHash } from '../auth/googleAuth';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import { buildIncomeJournal, generateUUID } from '../domain/journal';
import { decodeBackup } from '../storage/backup';
import { financialFingerprint } from '../sync/cloudBackup';
import { googleErrorMessage } from '../auth/authErrors';

test('OAuth testing denial explains account approval without echoing the Google error body', () => {
  const denied = new Error('Access blocked: App has not completed the Google verification process. Only developer-approved testers. qa@example.invalid');
  assert.match(googleErrorMessage(denied, true), /test user/);
  assert.ok(!googleErrorMessage(denied, false).includes('qa@example.invalid'));
  assert.match(googleErrorMessage(new Error('access_denied'), true), /approve your account/);
});

async function database() {
  const driver = new LocalStorageFallbackDriver(), key = `automatic-${generateUUID()}`;
  const db = new LocalDatabase(key, driver); await db.init(); return { db, driver, key };
}
async function profile() {
  return { subjectId: 'shared-google-sub', subjectHash: await computeOwnerSubjectHash('shared-google-sub'),
    displayName: 'Synthetic QA', email: 'qa@example.invalid', accessToken: 'mock-token', isDriveAuthorized: true };
}
async function post(db: LocalDatabase, account = 'acc-cash-1', category = 'cat-salary', amount = '12345') {
  const journal = buildIncomeJournal({ workspaceId: db.getAccount(account)!.workspaceId, assetAccountId: account,
    revenueCategoryId: category, amountMinor: amount, effectiveDate: '2026-10-26', opId: generateUUID() });
  const payload = { balancedJournal: journal };
  await db.commitJournalWithOutbox(journal, { protocolVersion: 1, ownerHash: db.getIdentity()?.ownerSubjectHash || 'local-owner',
    deviceId: db.getDeviceId(), seq: db.getNextDeviceSeq(), operationId: journal.transaction.createdOpId,
    entityId: journal.transaction.id, type: 'journal.post', payload, contentSha256: await computeSha256(canonicalJson(payload)),
    createdAtUtc: new Date().toISOString() });
  return journal;
}
async function tick(t: TestContext, ms: number) { t.mock.timers.tick(ms); await immediate(); await immediate(); }
function clock(t: TestContext) { t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 }); }

test('Durable change notifications emit after commit, never after failed or rolled-back saves', async () => {
  const { db, driver } = await database(); let changes = 0; db.subscribeToLocalChanges(() => changes++);
  await db.beginTransaction(); db.createWorkspace('Rolled back', 'business'); assert.equal(changes, 0); await db.rollbackTransaction();
  await db.beginTransaction(); db.createWorkspace('Saved one', 'business'); db.createWorkspace('Saved two', 'personal');
  assert.equal(changes, 0); await db.commitTransaction(); assert.equal(changes, 1);
  await db.captureRecoverySnapshot(); assert.equal(changes, 1);
  driver.faultInjection = 'throw_on_write'; db.createWorkspace('Not saved', 'business');
  await assert.rejects(db.waitForPendingWrites()); assert.equal(changes, 1);
});

test('Automatic sync debounces multiple durable mutations, then continues polling for remote changes', async t => {
  SimulatedGoogleDriveTransport.clearSharedCloud(); const { db } = await database();
  const transport = new SimulatedGoogleDriveTransport(), sync = new SyncOrchestrator(db, transport);
  let runs = 0; const trigger = sync.triggerSync.bind(sync); sync.triggerSync = async (...args) => { runs++; await trigger(...args); };
  clock(t); const worker = new AutomaticSync(db, sync, { enabled: () => true, authorize: async () => true }); t.after(() => worker.stop());
  worker.start(); await tick(t, 0); assert.equal(runs, 1);
  db.createWorkspace('A', 'business'); db.createWorkspace('B', 'business'); db.createWorkspace('C', 'business'); await db.waitForPendingWrites();
  await tick(t, 749); assert.equal(runs, 1); await tick(t, 1); assert.equal(runs, 2); assert.equal(db.getPendingOutbox().length, 0);
  await tick(t, 15_000); await tick(t, 750); assert.equal(runs, 3);
  worker.stop(); db.createWorkspace('Stopped', 'business'); await db.waitForPendingWrites(); await tick(t, 30_000); assert.equal(runs, 3);
});

test('Automatic retries preserve offline changes, respect backoff and recover without a manual sync', async t => {
  SimulatedGoogleDriveTransport.clearSharedCloud(); const { db } = await database(); db.createWorkspace('Offline change', 'business'); await db.waitForPendingWrites();
  const transport = new SimulatedGoogleDriveTransport(); transport.simulateFault = 'network_disconnected';
  const sync = new SyncOrchestrator(db, transport); clock(t);
  const worker = new AutomaticSync(db, sync, { enabled: () => true, authorize: async () => true }); t.after(() => worker.stop());
  worker.start(); await tick(t, 0); assert.equal(db.getPendingOutbox().length, 1);
  transport.simulateFault = 'none'; await tick(t, 4_999); assert.equal(db.getPendingOutbox().length, 1);
  await tick(t, 1); assert.equal(db.getPendingOutbox().length, 0); assert.equal(sync.getStatus().state, 'synced_verified');
});

test('Hidden or offline clients wait until foreground/reconnection and authorization never opens a popup', async t => {
  SimulatedGoogleDriveTransport.clearSharedCloud(); const { db } = await database(); db.createWorkspace('Pending', 'personal'); await db.waitForPendingWrites();
  const sync = new SyncOrchestrator(db, new SimulatedGoogleDriveTransport()); let enabled = false, authorized = 0; clock(t);
  const worker = new AutomaticSync(db, sync, { enabled: () => enabled, authorize: async () => { authorized++; return true; } }); t.after(() => worker.stop());
  worker.start(); await tick(t, 30_000); assert.equal(authorized, 0); assert.equal(db.getPendingOutbox().length, 1);
  enabled = true; worker.request(true); await tick(t, 0); assert.equal(authorized, 1); assert.equal(db.getPendingOutbox().length, 0);
});

test('A receiving device discovers remote records on the foreground poll without local edits', async t => {
  SimulatedGoogleDriveTransport.clearSharedCloud(); const { db: a } = await database(), { db: b } = await database();
  const transport = new SimulatedGoogleDriveTransport(), syncA = new SyncOrchestrator(a, transport), syncB = new SyncOrchestrator(b, transport);
  clock(t); const worker = new AutomaticSync(b, syncB, { enabled: () => true, authorize: async () => true }); t.after(() => worker.stop());
  worker.start(); await tick(t, 0); const journal = await post(a); await syncA.triggerSync();
  assert.equal(b.getTransaction(journal.transaction.id), undefined);
  await tick(t, 15_000); await tick(t, 750); assert.ok(b.getTransaction(journal.transaction.id));
});

test('New device reads cloud definitions before publishing defaults and preserves names, balances and complete backups', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud(); const owner = await profile(), { db: a } = await database();
  const transport = new SimulatedGoogleDriveTransport(), sa = new SyncOrchestrator(a, transport, { cloudBackups: true });
  a.getAccount('acc-cash-1')!.name = 'Original wallet'; a.getAccount('acc-cash-1')!.openingBalanceMinor = '700';
  a.editWorkspace('ws-personal-default', { name: 'Original ledger', description: 'Existing description' });
  await sa.bootstrapAndRestore(owner, true); await post(a); await sa.triggerSync();
  const { db: b } = await database(), sb = new SyncOrchestrator(b, transport, { cloudBackups: true }); await sb.bootstrapAndRestore(owner);
  assert.equal(b.getAccount('acc-cash-1')?.name, 'Original wallet'); assert.equal(b.getAccount('acc-cash-1')?.openingBalanceMinor, '700');
  assert.equal(b.getWorkspace('ws-personal-default')?.name, 'Original ledger');
  assert.equal(b.getWorkspace('ws-personal-default')?.description, 'Existing description');
  await sa.triggerSync(); assert.equal(a.getWorkspace('ws-personal-default')?.name, 'Original ledger');
  assert.equal(a.calculateAccountSummaries('ws-personal-default')[0].currentBalanceMinor, b.calculateAccountSummaries('ws-personal-default')[0].currentBalanceMinor);
  const backup = await decodeBackup(await sb.downloadCloudBackup()); assert.equal(await financialFingerprint(backup), await financialFingerprint(b.toSerializable()));
  assert.ok(sb.getStatus().lastCloudBackupAt); assert.ok((await transport.listAppDataFiles()).some(file => file.name.startsWith('hsc-v1-checkpoint-')));
  const before = (await transport.listAppDataFiles()).length; await sb.triggerSync(); assert.equal((await transport.listAppDataFiles()).length, before);
});

test('All category, party, group membership, budget and recurring rule changes enter the outbox and replay', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud(); const owner = await profile(), { db: a } = await database();
  const transport = new SimulatedGoogleDriveTransport(), sa = new SyncOrchestrator(a, transport); await sa.bootstrapAndRestore(owner);
  const ws = a.createWorkspace('Business', 'business'), category = a.createCategory(ws.id, 'Sales', 'income');
  a.editCategory(category.id, 'Online sales'); const party = a.createParty(ws.id, 'QA customer', 'customer'); a.editParty(party.id, { notes: 'Note' });
  const group = a.createAccountGroup(ws.id, 'Original group'); a.updateAccountGroup(group.id, { name: 'New group' });
  const account = a.createAccount(ws.id, 'Wallet', 'cash'); a.addAccountToGroup(account.id, group.id);
  a.setBudget({ id: 'qa-budget', workspaceId: ws.id, categoryId: category.id, limitMinor: '10000', period: 'monthly', alertThresholds: [80], updatedAt: new Date().toISOString() });
  a.setRecurringRule({ id: 'qa-rule', workspaceId: ws.id, name: 'Salary', frequency: 'monthly', type: 'income', accountId: account.id,
    categoryId: category.id, amountMinor: '5000', autoPostEnabled: false, active: true, generation: 1, createdAt: new Date().toISOString() });
  await a.waitForPendingWrites(); const createAccount = a.getPendingOutbox().find(op => op.type === 'account.create' && op.entityId === account.id)!;
  assert.notEqual(createAccount.payload.account.groupId, group.id, 'Create payload must not mutate with later account updates');
  await sa.triggerSync(); const { db: b } = await database(), sb = new SyncOrchestrator(b, transport); await sb.bootstrapAndRestore(owner);
  assert.equal(b.getAccount(account.id)?.groupId, group.id); assert.equal(b.getAccountGroup(group.id)?.name, 'New group');
  assert.equal(b.getCategories(ws.id)[0].name, 'Online sales'); assert.equal(b.getParty(party.id)?.notes, 'Note');
  assert.equal(b.getBudgets(ws.id)[0].limitMinor, '10000'); assert.equal(b.getRecurringRules(ws.id)[0].amountMinor, '5000');
  a.deleteCategory(category.id); a.deleteParty(party.id); a.removeAccountFromGroup(account.id); await a.waitForPendingWrites(); await sa.triggerSync(); await sb.triggerSync();
  assert.equal(b.getCategories(ws.id).length, 0); assert.equal(b.getParties(ws.id).length, 0); assert.equal(b.getAccount(account.id)?.groupId, null);
});

test('Corrections and deletions preserve reversal IDs, UI flags and balanced totals across devices', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud(); const owner = await profile(), { db: a } = await database();
  const transport = new SimulatedGoogleDriveTransport(), sa = new SyncOrchestrator(a, transport); await sa.bootstrapAndRestore(owner);
  const first = await post(a); await a.editTransaction(first.transaction.id, { assetAccountId: 'acc-cash-1', categoryId: 'cat-salary', amountMinor: '30000', effectiveDate: '2026-10-26', note: 'Corrected' });
  const second = await post(a, 'acc-cash-1', 'cat-salary', '1000'); await a.deleteTransaction(second.transaction.id); await sa.triggerSync();
  const { db: b } = await database(), sb = new SyncOrchestrator(b, transport); await sb.bootstrapAndRestore(owner);
  assert.equal(sb.getStatus().state, 'synced_verified'); assert.ok(b.getTransaction(first.transaction.id)?.isReplacedBy); assert.equal(b.getTransaction(second.transaction.id)?.isDeleted, true);
  assert.deepEqual(new Set(a.getTransactions('ws-personal-default').map(tx => tx.id)), new Set(b.getTransactions('ws-personal-default').map(tx => tx.id)));
  assert.equal(b.calculateAccountSummaries('ws-personal-default')[0].currentBalanceMinor, '30000'); assert.equal(b.verifyLedgerIntegrity('ws-personal-default').isValid, true);
});

test('A lost Drive checkpoint is rebuilt; unreadable cloud backup never gains a verified timestamp', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud(); const { db } = await database(), owner = await profile();
  const transport = new SimulatedGoogleDriveTransport(), sync = new SyncOrchestrator(db, transport, { cloudBackups: true }); await sync.bootstrapAndRestore(owner);
  const checkpoint = (await transport.listAppDataFiles()).find(file => file.name.startsWith('hsc-v1-checkpoint-'))!;
  await transport.deleteFile(checkpoint.id); await sync.triggerSync(); assert.ok(sync.getStatus().lastCloudBackupAt); assert.ok(await sync.downloadCloudBackup());
  const { db: fresh } = await database(); fresh.setIdentity(owner.subjectHash);
  const broken: DriveTransport = { listAppDataFiles: async () => [], uploadBatchFile: async name => ({ fileId: 'broken', name }),
    downloadBatchFile: async () => '{}', deleteFile: async () => {}, getQuotaStatus: async () => ({ usedBytes: 0, totalBytes: 1, isFull: false }) };
  // Metadata preparation also uses read-back, so no failed upload is ever claimed as a complete backup.
  const bad = new SyncOrchestrator(fresh, broken, { cloudBackups: true }); await bad.triggerSync();
  assert.notEqual(bad.getStatus().state, 'synced_verified'); assert.equal(bad.getStatus().lastCloudBackupAt, null);
});

test('Malformed or unbalanced remote journals roll back the batch rather than report successful sync', async () => {
  const { db: a } = await database(), { db: b } = await database(); await post(a); const operations = structuredClone(a.getPendingOutbox());
  operations[0].payload.balancedJournal.lines[0].debitMinor = '1'; operations[0].contentSha256 = await computeSha256(canonicalJson(operations[0].payload));
  const sync = new SyncOrchestrator(b, new SimulatedGoogleDriveTransport());
  await assert.rejects(sync.applyBatchOperations({ protocolVersion: 1, ownerHash: 'local-owner', deviceId: a.getDeviceId(), batchId: 'bad',
    fromSeq: 1, toSeq: 1, operations, batchSha256: '', byteLength: 1, createdAtUtc: new Date().toISOString() }), /Unbalanced/);
  assert.equal(b.getTransactions('ws-personal-default').length, 0); assert.equal(b.getRawState().appliedOperations.size, 0);
});

test('Expired browser authorization fails without opening GIS from a timer', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window'); let popups = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { protocol: 'http:', hostname: 'localhost' }, google: { accounts: { oauth2: {
    initTokenClient: (config: any) => ({ requestAccessToken: () => { popups++; void config.callback({ access_token: 'synthetic-token', expires_in: 3600,
      scope: 'openid email profile https://www.googleapis.com/auth/drive.appdata' }); } }),
  } } } } });
  try {
    const auth = new GoogleAuthManager(); auth.fetchFn = async () => new Response(JSON.stringify({ sub: 'shared-google-sub', name: 'QA', email: 'qa@example.invalid' }));
    await auth.promptGoogleSignIn(); assert.equal(popups, 1); auth.getProfile()!.tokenExpiresAt = 0;
    await assert.rejects(auth.getValidAccessToken(), /AUTH_REQUIRED/); await assert.rejects(auth.renewAccessTokenSilent(), /AUTH_REQUIRED/);
    assert.equal(popups, 1);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('Unique device identity migration preserves old pending UUIDs and starts a separate sequence', async () => {
  const { db, driver, key } = await database(); db.setDeviceIdentity('legacy-simulator-A', 'Old'); db.createWorkspace('Old record', 'personal'); await db.waitForPendingWrites();
  const previous = db.getPendingOutbox()[0]; const restarted = new LocalDatabase(key, driver); await restarted.init(); restarted.setDeviceIdentity('unique-web-browser', 'Browser');
  const ws = restarted.createWorkspace('New record', 'business'); await restarted.waitForPendingWrites();
  assert.ok(restarted.getPendingOutbox().some(op => op.operationId === previous.operationId && op.deviceId === 'legacy-simulator-A'));
  const current = restarted.getPendingOutbox().find(op => op.entityId === ws.id)!; assert.equal(current.deviceId, 'unique-web-browser'); assert.equal(current.seq, 1);
});

test('Journal dependencies can arrive in reverse order inside a batch without losing any operations', async () => {
  const { db: a } = await database(), { db: b } = await database();
  const ws = a.createWorkspace('Later definition', 'business'), account = a.createAccount(ws.id, 'Wallet', 'cash'), category = a.createCategory(ws.id, 'Sales', 'income');
  const journal = await post(a, account.id, category.id); const operations = a.getPendingOutbox().reverse();
  const sync = new SyncOrchestrator(b, new SimulatedGoogleDriveTransport());
  await sync.applyBatchOperations({ protocolVersion: 1, ownerHash: 'local-owner', deviceId: a.getDeviceId(), batchId: 'reversed', fromSeq: 1, toSeq: 4,
    operations, batchSha256: '', byteLength: 1, createdAtUtc: new Date().toISOString() });
  assert.ok(b.getTransaction(journal.transaction.id)); assert.equal(b.getRawState().appliedOperations.size, 4);
});

test('A late offline journal recovers the retained definition of an empty account deleted on another device', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud(); const owner = await profile(), { db: a } = await database();
  const transport = new SimulatedGoogleDriveTransport(), sa = new SyncOrchestrator(a, transport); await sa.bootstrapAndRestore(owner);
  const account = a.createAccount('ws-personal-default', 'Later activity', 'cash'); await a.waitForPendingWrites(); await sa.triggerSync();
  const { db: b } = await database(), sb = new SyncOrchestrator(b, transport); await sb.bootstrapAndRestore(owner);
  await post(b, account.id); assert.equal(a.safeDeleteAccount(account.id, 'DELETE').mode, 'deleted'); await a.waitForPendingWrites();
  await sa.triggerSync(); await sb.triggerSync(); await sa.triggerSync();
  assert.equal(sa.getStatus().state, 'synced_verified'); assert.equal(a.getAccount(account.id)?.archivedAt != null, true);
  assert.equal(a.calculateAccountSummaries('ws-personal-default').find(summary => summary.accountId === account.id)?.currentBalanceMinor, '12345');
  assert.equal(a.verifyLedgerIntegrity('ws-personal-default').isValid, true);
});

test('Real REST transport contract: Android and Web tokens share scoped files and verified backup contents', async () => {
  const files = new Map<string, { id: string; name: string; text: string; version: string }>(); let next = 0;
  const customFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), token = new Headers(init?.headers).get('Authorization');
    assert.ok(['Bearer android-qa-token', 'Bearer web-qa-token'].includes(token!));
    if (url.pathname === '/drive/v3/about') return Response.json({ storageQuota: { usage: '1000', limit: '15000000000' } });
    if (url.pathname === '/drive/v3/files') {
      assert.equal(url.searchParams.get('spaces'), 'appDataFolder');
      return Response.json({ files: [...files.values()].map(file => ({ id: file.id, name: file.name, version: file.version,
        size: String(new TextEncoder().encode(file.text).length), mimeType: 'application/json' })) });
    }
    if (url.pathname === '/upload/drive/v3/files') {
      const boundary = new Headers(init?.headers).get('Content-Type')!.split('boundary=')[1];
      const parts = String(init?.body).split(`--${boundary}`).filter(part => part.includes('Content-Type:'));
      const metadata = JSON.parse(parts[0].slice(parts[0].indexOf('\r\n\r\n') + 4).trim());
      assert.deepEqual(metadata.parents, ['appDataFolder']);
      const text = parts[1].slice(parts[1].indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
      const id = `qa-file-${++next}`; files.set(id, { id, name: metadata.name, text, version: '1' });
      return Response.json({ id, name: metadata.name });
    }
    const id = url.pathname.split('/').at(-1)!; const file = files.get(id);
    return file ? new Response(file.text) : new Response('Missing', { status: 404 });
  };
  const owner = await profile(), { db: phone } = await database(), { db: web } = await database();
  const phoneSync = new SyncOrchestrator(phone, new RealGoogleDriveTransport('android-qa-token', { customFetch, initialRetryDelayMs: 0 }), { cloudBackups: true });
  const webSync = new SyncOrchestrator(web, new RealGoogleDriveTransport('web-qa-token', { customFetch, initialRetryDelayMs: 0 }), { cloudBackups: true });
  await phoneSync.bootstrapAndRestore(owner); const journal = await post(phone); await phoneSync.triggerSync(); await webSync.bootstrapAndRestore(owner);
  assert.equal(phoneSync.getStatus().state, 'synced_verified'); assert.equal(webSync.getStatus().state, 'synced_verified'); assert.ok(web.getTransaction(journal.transaction.id));
  const downloaded = await decodeBackup(await webSync.downloadCloudBackup()); assert.equal(downloaded.journalTransactions.length, 1);
  assert.equal(downloaded.localIdentity.ownerSubjectHash, owner.subjectHash);
  assert.ok(!JSON.stringify(downloaded).includes('android-qa-token')); assert.ok(!JSON.stringify(downloaded).includes('web-qa-token'));
  // Drive versions invalidate the local read cache when bytes are changed remotely.
  const opFile = [...files.values()].find(file => file.name.startsWith('hsc-v1-ops-'))!; opFile.text = '{}'; opFile.version = '2';
  await webSync.triggerSync(); assert.notEqual(webSync.getStatus().state, 'synced_verified'); assert.ok(web.getTransaction(journal.transaction.id));
});
