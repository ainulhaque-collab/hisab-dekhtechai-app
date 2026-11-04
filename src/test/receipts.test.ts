import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { receiptFromBytes, receiptImageUrl, validateReceiptBlob, MAX_RECEIPT_BYTES } from '../storage/receipts';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { buildIncomeJournal, generateUUID } from '../domain/journal';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import { SimulatedGoogleDriveTransport } from '../drive/transport';
import { SyncOrchestrator } from '../sync/orchestrator';
import { computeOwnerSubjectHash } from '../auth/googleAuth';
import { encodeBackup } from '../storage/backup';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lIAAAAAASUVORK5CYII=', 'base64'));
const makeBlob = () => receiptFromBytes(png, 'image/png', 'receipt.png');
async function database(driver = new LocalStorageFallbackDriver()) {
  const key = `receipt-${generateUUID()}`, db = new LocalDatabase(key, driver); await db.init(); return { db, driver, key };
}
async function posting(db: LocalDatabase, blob = makeBlob()) {
  const journal = buildIncomeJournal({ workspaceId: 'ws-personal-default', assetAccountId: 'acc-cash-1', revenueCategoryId: 'cat-salary', amountMinor: '1000', effectiveDate: '2026-10-26', opId: generateUUID(), receiptBlobSha256: blob.sha256, receiptName: blob.fileName });
  const payload = { balancedJournal: journal };
  const op = { protocolVersion: 1 as const, ownerHash: db.getIdentity()?.ownerSubjectHash || 'local-owner', deviceId: db.getDeviceId(), seq: db.getNextDeviceSeq(), operationId: journal.transaction.createdOpId, entityId: journal.transaction.id, type: 'journal.post' as const, payload, createdAtUtc: new Date().toISOString(), contentSha256: await computeSha256(canonicalJson(payload)) };
  return { journal, op, blob };
}

test('Receipt identity hashes actual bytes and rejects MIME spoofing, corruption and size mismatch', () => {
  const blob = makeBlob();
  assert.equal(blob.sha256, createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(validateReceiptBlob(blob), png);
  assert.ok(receiptImageUrl(blob).startsWith('data:image/png;base64,'));
  assert.throws(() => receiptFromBytes(png, 'image/jpeg', 'fake.jpg'));
  assert.throws(() => receiptFromBytes(new TextEncoder().encode('<svg />'), 'image/svg+xml', 'x.svg'));
  assert.throws(() => receiptFromBytes(new Uint8Array(MAX_RECEIPT_BYTES + 1), 'image/png', 'large.png'));
  assert.throws(() => validateReceiptBlob({ ...blob, sha256: 'a'.repeat(64) }), /checksum/);
  assert.throws(() => validateReceiptBlob({ ...blob, byteLength: png.length + 1 }));
  assert.throws(() => validateReceiptBlob({ ...blob, dataBase64: blob.dataBase64! + '=' }));
});

test('Receipt, journal and both outbox operations commit once and survive restart/correction', async () => {
  const { db, driver, key } = await database(); const { journal, op, blob } = await posting(db);
  await db.commitJournalWithOutbox(journal, op, blob);
  await db.commitJournalWithOutbox(journal, op, blob);
  assert.equal(db.getTransactions('ws-personal-default').length, 1);
  assert.equal(db.getPendingOutbox().filter(item => item.type === 'receipt.attach').length, 1);
  const stored = new LocalDatabase(key, driver); await stored.init();
  assert.deepEqual(validateReceiptBlob(stored.getReceiptBlob(blob.sha256)!), png);
  await stored.editTransaction(journal.transaction.id, { amountMinor: '1100', effectiveDate: '2026-10-26', assetAccountId: 'acc-cash-1', categoryId: 'cat-salary' });
  const original = stored.getTransaction(journal.transaction.id)!;
  assert.equal(stored.getTransaction(original.isReplacedBy!)?.receiptBlobSha256, blob.sha256);
  assert.equal(stored.verifyLedgerIntegrity('ws-personal-default').isValid, true);
});

test('A failed durable commit leaves no journal, receipt or outbox entry behind', async () => {
  class FailingDriver extends LocalStorageFallbackDriver {
    fail = false;
    async setItem(key: string, value: string) { if (this.fail) throw new Error('Injected storage failure'); await super.setItem(key, value); }
  }
  const driver = new FailingDriver(); const { db } = await database(driver);
  const { journal, op, blob } = await posting(db);
  const before = canonicalJson(db.toSerializable()); driver.fail = true;
  await assert.rejects(db.commitJournalWithOutbox(journal, op, blob), /storage failure/);
  driver.fail = false;
  assert.equal(canonicalJson(db.toSerializable()), before);
  assert.equal(db.getReceiptBlob(blob.sha256), undefined);
});

test('A receipt cannot be attached to a mismatched journal hash', async () => {
  const { db } = await database(); const { journal, op, blob } = await posting(db);
  journal.transaction.receiptBlobSha256 = 'b'.repeat(64);
  await assert.rejects(db.commitJournalWithOutbox(journal, op, blob), /does not match/);
  assert.equal(db.getTransactions('ws-personal-default').length, 0);
});

test('Receipt content restores across two Drive clients, duplicate sync and a verified backup import', async () => {
  SimulatedGoogleDriveTransport.clearSharedCloud();
  const profile = { subjectId: 'receipt-qa', subjectHash: await computeOwnerSubjectHash('receipt-qa'), email: 'qa@example.invalid', displayName: 'QA', isDriveAuthorized: true, accessToken: 'synthetic-qa' };
  const { db: source } = await database(); const { journal, op, blob } = await posting(source);
  await source.commitJournalWithOutbox(journal, op, blob);
  const transport = new SimulatedGoogleDriveTransport();
  const sender = new SyncOrchestrator(source, transport, { cloudBackups: true }); await sender.bootstrapAndRestore(profile, true);
  const { db: target } = await database(); const receiver = new SyncOrchestrator(target, transport, { cloudBackups: true });
  await receiver.bootstrapAndRestore(profile); await receiver.triggerSync();
  assert.equal(target.getTransactions('ws-personal-default').length, 1);
  assert.deepEqual(validateReceiptBlob(target.getReceiptBlob(blob.sha256)!), png);
  await target.importBackupFile(await sender.downloadCloudBackup());
  assert.deepEqual(validateReceiptBlob(target.getReceiptBlob(blob.sha256)!), png);
  const corrupted = structuredClone(target.toSerializable());
  corrupted.receiptBlobs[0][1].byteLength++;
  const before = canonicalJson(target.toSerializable());
  await assert.rejects(target.importBackupFile(await encodeBackup(corrupted)));
  assert.equal(canonicalJson(target.toSerializable()), before);
});
