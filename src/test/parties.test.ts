import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDatabase } from '../storage/db';
import { buildIncomeJournal, buildExpenseJournal, assertJournalBalanced } from '../domain/journal';

test('Business Ledger: Multiple persons / parties management and transaction linkage', async () => {
  const db = new LocalDatabase('test_db_parties');
  db.seedDefaultEntities();

  const wsBusinessId = 'ws-business-default';

  // 1. Add multiple persons to the single business ledger
  const partner = db.createParty(wsBusinessId, 'জামাল সাহেব', 'partner', '01711000001', '৫০% অংশীদার');
  const staff = db.createParty(wsBusinessId, 'মো: সুমন', 'staff', '01811000002', 'দোকানের ম্যানেজার');
  const customer = db.createParty(wsBusinessId, 'হাজী ট্রেডার্স', 'customer', '01911000003', 'পাইকারি ক্রেতা');
  const supplier = db.createParty(wsBusinessId, 'মেঘনা মিলস', 'supplier', '01611000004', 'কাঁচামাল সরবরাহকারী');

  const parties = db.getParties(wsBusinessId);
  // Default seeded had 2 parties + our 4 new parties = at least 4 new parties
  assert.ok(parties.some((p) => p.name === 'জামাল সাহেব' && p.role === 'partner'));
  assert.ok(parties.some((p) => p.name === 'মো: সুমন' && p.role === 'staff'));
  assert.ok(parties.some((p) => p.name === 'হাজী ট্রেডার্স' && p.role === 'customer'));
  assert.ok(parties.some((p) => p.name === 'মেঘনা মিলস' && p.role === 'supplier'));

  // 2. Post an expense journal linked to the staff (e.g., salary payment)
  const salaryJournal = buildExpenseJournal({
    workspaceId: wsBusinessId,
    assetAccountId: 'acc-cash-1',
    expenseCategoryId: 'cat-staff-salary',
    amountMinor: '1500000', // 15,000 BDT
    effectiveDate: '2026-10-22',
    note: 'সুমনের অক্টোবর মাসের বেতন',
    opId: 'op-salary-1',
    partyId: staff.id,
  });

  assertJournalBalanced(salaryJournal.lines);
  assert.equal(salaryJournal.transaction.partyId, staff.id);

  // 3. Post an income journal linked to the customer (e.g., wholesale payment)
  const salesJournal = buildIncomeJournal({
    workspaceId: wsBusinessId,
    assetAccountId: 'acc-cash-1',
    revenueCategoryId: 'cat-sales',
    amountMinor: '4500000', // 45,000 BDT
    effectiveDate: '2026-10-22',
    note: 'হাজী ট্রেডার্স পাইকারি বিক্রয়',
    opId: 'op-sales-1',
    partyId: customer.id,
  });

  assertJournalBalanced(salesJournal.lines);
  assert.equal(salesJournal.transaction.partyId, customer.id);

  // 4. Edit party details
  db.editParty(staff.id, { phone: '01899999999', notes: 'সিনিয়র ম্যানেজার' });
  const updatedStaff = db.getParty(staff.id);
  assert.equal(updatedStaff?.phone, '01899999999');
  assert.equal(updatedStaff?.notes, 'সিনিয়র ম্যানেজার');

  // 5. Delete / Archive a party
  db.deleteParty(partner.id);
  const remainingParties = db.getParties(wsBusinessId);
  assert.ok(!remainingParties.some((p) => p.id === partner.id));
});
