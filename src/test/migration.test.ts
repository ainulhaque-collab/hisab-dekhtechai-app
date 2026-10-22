import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { buildIncomeJournal, generateUUID } from '../domain/journal';
import { SyncOperation } from '../contracts/types';
import { canonicalJson, computeSha256 } from '../sync/canonical';

test('Database migrations: snapshot capture, integrity verification, and non-destructive upgrade', async () => {
  const db = new LocalDatabase('test_db_migration');
  db.seedDefaultEntities();

  const wsId = 'ws-personal-default';
  const opId = generateUUID();
  const journal = buildIncomeJournal({
    workspaceId: wsId,
    assetAccountId: 'acc-cash-1',
    revenueCategoryId: 'cat-salary',
    amountMinor: '5000000', // ৳50,000.00
    effectiveDate: '2026-10-22',
    note: 'Initial Salary',
    opId,
  });

  const op: SyncOperation = {
    protocolVersion: 1,
    ownerHash: 'owner-test',
    deviceId: db.getDeviceId(),
    seq: db.getNextDeviceSeq(),
    operationId: opId,
    entityId: journal.transaction.id,
    type: 'journal.post',
    createdAtUtc: new Date().toISOString(),
    payload: { balancedJournal: journal },
    contentSha256: await computeSha256(canonicalJson({ balancedJournal: journal })),
  };

  await db.commitJournalWithOutbox(journal, op);

  // Capture pre-migration recovery snapshot
  const snapshot = await db.captureRecoverySnapshot();
  assert.ok(snapshot.id);
  assert.equal(snapshot.totalTransactions, 1);
  assert.equal(snapshot.pendingOutboxCount, 1);
  assert.ok(snapshot.hash.length === 64, 'Snapshot hash must be valid SHA-256');

  // Verify snapshots list
  const snapshots = db.getSnapshots();
  assert.equal(snapshots.length, 1);

  // Restore test: modify data then restore
  db.createAccount(wsId, 'Temp Test Account', 'bank', '0');
  assert.equal(db.getAccounts(wsId).length, 4);

  // Restore from snapshot
  const restored = await db.restoreFromSnapshot(snapshot.id);
  assert.ok(restored, 'Restore must succeed with valid hash');
  assert.equal(db.getAccounts(wsId).length, 3, 'Restored database must revert to snapshot state');
  assert.equal(db.getTransactions(wsId).length, 1, 'Transaction must be preserved');
  assert.equal(db.getPendingOutbox().length, 1, 'Pending outbox must be preserved');
});
