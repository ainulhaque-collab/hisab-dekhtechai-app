import test from 'node:test';
import assert from 'node:assert/strict';
import { localDate, resolveJournalTime, transactionTimeLabel, validateTransactionTime } from '../domain/transactionTime';
import { buildIncomeJournal, buildTransferJournal, generateUUID } from '../domain/journal';
import { LocalDatabase } from '../storage/db';
import { LocalStorageFallbackDriver } from '../storage/drivers/durableStorage';
import { canonicalJson, computeSha256 } from '../sync/canonical';
import { encodeBackup } from '../storage/backup';

test('Unselected date/time uses the save clock, including a later calendar day', () => {
  const earlier = new Date(2026, 9, 26, 23, 59, 0);
  const later = new Date(2026, 9, 27, 0, 1, 42, 123);
  assert.notEqual(localDate(earlier), localDate(later));
  const result = resolveJournalTime({}, later);
  assert.equal(result.effectiveDate, '2026-10-27');
  assert.equal(result.occurredAtUtc, later.toISOString());
  assert.equal(result.createdAtUtc, later.toISOString());
  assert.equal(result.occurredTimezoneOffsetMinutes, later.getTimezoneOffset());
});

test('Selected date/time preserves wall time while audit timestamp remains the actual entry time', () => {
  const now = new Date(2026, 9, 27, 18, 44, 22);
  const result = resolveJournalTime({ effectiveDate: '2026-10-20', effectiveTime: '09:15' }, now);
  const chosen = new Date(result.occurredAtUtc);
  assert.equal(localDate(chosen), '2026-10-20');
  assert.equal(chosen.getHours(), 9); assert.equal(chosen.getMinutes(), 15);
  assert.equal(chosen.getSeconds(), 0);
  assert.equal(result.createdAtUtc, now.toISOString());
  const dateOnly = resolveJournalTime({ effectiveDate: '2026-10-20' }, now);
  assert.equal(new Date(dateOnly.occurredAtUtc).getHours(), 18);
  assert.equal(new Date(dateOnly.occurredAtUtc).getSeconds(), 22);
});

test('Origin offset survives midnight and receiver timezone differences; legacy clocks are not invented', () => {
  const value = resolveJournalTime({ effectiveDate: '2026-10-27', occurredAtUtc: '2026-10-26T18:30:00.000Z', occurredTimezoneOffsetMinutes: -360 });
  assert.equal(transactionTimeLabel(value), '2026-10-27 · 00:30 (UTC+06:00)');
  assert.throws(() => validateTransactionTime({ ...value, effectiveDate: '2026-10-26' }), /does not match/);
  const legacy = { effectiveDate: '2020-01-01', occurredAtUtc: '2026-10-26T18:30:00.000Z' };
  const original = canonicalJson(legacy);
  assert.equal(transactionTimeLabel(legacy), '2020-01-01');
  validateTransactionTime(legacy);
  assert.equal(canonicalJson(legacy), original);
});

test('Impossible dates, malformed clocks and forged timezone/audit values fail before journal creation', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '26-10-2026'])
    assert.throws(() => resolveJournalTime({ effectiveDate: date }));
  for (const time of ['24:00', '12:60', '9:15', '12:15:60']) assert.throws(() => resolveJournalTime({ effectiveTime: time }));
  const record = resolveJournalTime();
  assert.throws(() => validateTransactionTime({ ...record, occurredTimezoneOffsetMinutes: 841 }));
  assert.throws(() => validateTransactionTime({ ...record, occurredAtUtc: 'bad' }));
  assert.throws(() => validateTransactionTime({ ...record, createdAtUtc: 'bad' }));
  assert.throws(() => resolveJournalTime({ occurredAtUtc: record.occurredAtUtc }));
});

test('Journal time survives local restart, backup validation and correction without changing original audit', async () => {
  const key = `time-${generateUUID()}`, driver = new LocalStorageFallbackDriver();
  const db = new LocalDatabase(key, driver); await db.init();
  const time = resolveJournalTime({ effectiveDate: '2026-10-27', occurredAtUtc: '2026-10-26T18:30:00.000Z', occurredTimezoneOffsetMinutes: -360 });
  const journal = buildIncomeJournal({ ...time, workspaceId: 'ws-personal-default', assetAccountId: 'acc-cash-1', revenueCategoryId: 'cat-salary', amountMinor: '1000', opId: generateUUID() });
  const payload = { balancedJournal: journal };
  await db.commitJournalWithOutbox(journal, { protocolVersion: 1, ownerHash: 'local-owner', deviceId: db.getDeviceId(), seq: db.getNextDeviceSeq(), operationId: journal.transaction.createdOpId, entityId: journal.transaction.id, type: 'journal.post', payload, createdAtUtc: new Date().toISOString(), contentSha256: await computeSha256(canonicalJson(payload)) });
  const stored = new LocalDatabase(key, driver); await stored.init();
  const before = structuredClone(stored.getTransactions('ws-personal-default')[0]);
  assert.equal(before.occurredAtUtc, time.occurredAtUtc);
  assert.equal(before.occurredTimezoneOffsetMinutes, -360);
  const backup = await stored.exportBackupFile(); await stored.importBackupFile(backup);
  await stored.editTransaction(before.id, { amountMinor: '1100', effectiveDate: before.effectiveDate, assetAccountId: 'acc-cash-1', categoryId: 'cat-salary' });
  const original = stored.getRawState().journalTransactions.get(before.id)!;
  assert.equal(original.createdAtUtc, before.createdAtUtc);
  const replacement = stored.getRawState().journalTransactions.get(original.isReplacedBy!)!;
  assert.equal(replacement.occurredAtUtc, before.occurredAtUtc);
  assert.equal(replacement.occurredTimezoneOffsetMinutes, -360);
  const invalid = structuredClone(stored.toSerializable());
  invalid.journalTransactions[0][1].occurredTimezoneOffsetMinutes = 900;
  const snapshot = canonicalJson(stored.toSerializable());
  await assert.rejects(stored.importBackupFile(await encodeBackup(invalid)));
  assert.equal(canonicalJson(stored.toSerializable()), snapshot);
  const transfer = buildTransferJournal({ ...time, workspaceId: 'ws-personal-default', fromAssetAccountId: 'a', toAssetAccountId: 'b', amountMinor: '100', opId: generateUUID() });
  assert.equal(transfer.transaction.occurredAtUtc, time.occurredAtUtc);
});
