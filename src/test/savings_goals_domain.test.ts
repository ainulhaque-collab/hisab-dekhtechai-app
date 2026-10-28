import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSavingsGoals, validateSavingsGoalEvent, type SavingsEventRecord, type SavingsGoal, type SavingsGoalEvent } from '../domain/savingsGoals';

const today = '2026-10-27';
const goal = (changes: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 'car', workspaceId: 'personal', name: 'My car', kind: 'general', targetMinor: '100000', revision: 1, archived: false, ...changes,
});
const set = (definition = goal(), operationId = `goal-${definition.id}`): SavingsEventRecord => ({
  operationId, createdAtUtc: '2026-10-25T12:00:00.000Z', event: { version: 1, action: 'goal.set', goal: definition },
});
const add = (allocationId: string, amountMinor: string, changes: Partial<Extract<SavingsGoalEvent, { action: 'allocation.add' }>> = {}, timestamp = '2026-10-26T12:00:00.000Z'): SavingsEventRecord => ({
  operationId: `add-${allocationId}`, createdAtUtc: timestamp,
  event: { version: 1, action: 'allocation.add', goalId: 'car', allocationId, accountId: 'cash', amountMinor, ...changes },
});
const release = (operationId: string, allocationId: string, amountMinor: string, goalId = 'car'): SavingsEventRecord => ({
  operationId, createdAtUtc: '2026-10-27T12:00:00.000Z', event: { version: 1, action: 'allocation.release', goalId, allocationId, amountMinor },
});
const project = (records: SavingsEventRecord[], balances: Record<string, string> = { cash: '100000' }) => projectSavingsGoals(records, 'personal', balances, today);

test('Savings: offline allocations compete deterministically across goals without exceeding the account balance', () => {
  const records = [set(), set(goal({ id: 'holiday' })), add('b', '80000', { goalId: 'holiday' }), add('a', '80000')];
  const result = project(records);
  assert.equal(result.goals[0].fundedMinor, '80000');
  assert.equal(result.goals[1].fundedMinor, '20000');
  assert.equal(result.goals[1].shortfallMinor, '60000');
  assert.deepEqual(result.accounts, [{ accountId: 'cash', balanceMinor: '100000', allocatedMinor: '100000', availableMinor: '0' }]);
  for (let shift = 0; shift < records.length; shift++) {
    const shuffled = [...records.slice(shift), ...records.slice(0, shift)].reverse();
    assert.deepEqual(project(shuffled), result);
  }
});

test('Savings: funding sorts creation instants before operation IDs, including fractional timestamp representations', () => {
  const result = project([set(), add('z', '80000', {}, '2026-10-26T11:59:59.999Z'), add('a', '80000', {}, '2026-10-26T12:00:00Z')]);
  assert.deepEqual(result.goals[0].contributions.map(item => [item.allocationId, item.fundedMinor]), [['z', '80000'], ['a', '20000']]);
});

test('Savings: replay deduplicates operations and immutable allocations without recreating released money', () => {
  const allocation = add('a', '80000');
  const released = release('release-a', 'a', '30000');
  const retry = { ...allocation, operationId: 'add-retry', createdAtUtc: '2026-10-28T12:00:00Z' };
  const records = [set(), allocation, allocation, retry, released, released];
  const result = project(records);
  assert.equal(result.goals[0].contributions.length, 1);
  assert.equal(result.goals[0].requestedMinor, '50000');
  assert.equal(result.goals[0].fundedMinor, '50000');
  assert.equal(result.goals[0].contributions[0].releasedMinor, '30000');
  assert.deepEqual(project(records.reverse()), result);
});

test('Savings: concurrent releases cap at the original allocation; release-before-add is preserved', () => {
  const releases = [release('release-1', 'a', '60000'), release('release-2', 'a', '60000')];
  const pending = project([set(), ...releases]);
  assert.equal(pending.orphanReleaseCount, 2);
  const records = [...releases, add('a', '100000'), set()];
  const result = project(records);
  assert.equal(result.orphanReleaseCount, 0);
  assert.deepEqual(result.goals[0].contributions[0], {
    allocationId: 'a', accountId: 'cash', amountMinor: '100000', releasedMinor: '100000', requestedMinor: '0', fundedMinor: '0', shortfallMinor: '0', createdAtUtc: '2026-10-26T12:00:00.000Z',
  });
  assert.equal(result.accounts[0].availableMinor, '100000');
  assert.deepEqual(project(records.reverse()), result);
});

test('Savings: late goal metadata preserves orphan adds and never allocates invisible funds', () => {
  const records = [add('a', '50000'), release('release-a', 'a', '10000')];
  const pending = project(records);
  assert.equal(pending.orphanAllocationCount, 1);
  assert.equal(pending.accounts[0].allocatedMinor, '0');
  assert.equal(pending.goals.length, 0);
  const resolved = project([...records, set()]);
  assert.equal(resolved.orphanAllocationCount, 0);
  assert.equal(resolved.goals[0].requestedMinor, '40000');
});

test('Savings: altered operation IDs and immutable allocation IDs fail closed', () => {
  const original = add('a', '100');
  const changedOperation = add('a', '101');
  assert.throws(() => project([set(), original, changedOperation]), /SAVINGS_EVENT_CONFLICT/);
  for (const changed of [{ amountMinor: '101' }, { accountId: 'bank' }, { goalId: 'holiday' }, { note: 'changed' }]) {
    const changedAllocation = { ...add('a', '100', changed), operationId: 'changed-operation' };
    assert.throws(() => project([set(), original, changedAllocation]), /SAVINGS_EVENT_CONFLICT/);
  }
  assert.throws(() => project([set(), original, release('release-a', 'a', '1', 'holiday')]), /SAVINGS_EVENT_CONFLICT/);
  assert.throws(() => project([set(), release('release-a', 'a', '1'), release('release-b', 'a', '1', 'holiday')]), /SAVINGS_EVENT_CONFLICT/);
});

test('Savings: metadata selects highest revision then greatest operation ID, independent of arrival time', () => {
  const old = set(goal({ revision: 1, name: 'Old name' }), 'metadata-z');
  const a = set(goal({ revision: 2, name: 'A version' }), 'metadata-a');
  const b = set(goal({ revision: 2, name: 'B version' }), 'metadata-b');
  b.createdAtUtc = '2026-10-20T12:00:00Z';
  const result = project([b, old, a]);
  assert.equal(result.goals[0].goal.name, 'B version');
  assert.deepEqual(project([a, old, b]), result);
  assert.throws(() => project([old, set(goal({ workspaceId: 'business', revision: 2 }), 'cross-workspace')]), /SAVINGS_EVENT_CONFLICT/);
});

test('Savings: archived history remains explicit while funding becomes available to active goals', () => {
  const result = project([set(goal({ archived: true })), set(goal({ id: 'holiday' })), add('a', '70000'), add('b', '70000', { goalId: 'holiday' })]);
  const archived = result.goals[0];
  assert.equal(archived.requestedMinor, '70000');
  assert.equal(archived.fundedMinor, '0');
  assert.equal(archived.shortfallMinor, '70000');
  assert.equal(archived.contributions.length, 1);
  assert.equal(result.goals[1].fundedMinor, '70000');
  assert.equal(result.accounts[0].availableMinor, '30000');
});

test('Savings: missing, zero and negative account balances never fund a goal', () => {
  const records = [set(), add('missing', '100', { accountId: 'missing' }), add('negative', '200', { accountId: 'negative' }), add('zero', '300', { accountId: 'zero' })];
  const result = project(records, { negative: '-500', zero: '0' });
  assert.equal(result.goals[0].fundedMinor, '0');
  assert.equal(result.goals[0].shortfallMinor, '600');
  assert.deepEqual(result.accounts, [
    { accountId: 'missing', balanceMinor: '0', allocatedMinor: '0', availableMinor: '0' },
    { accountId: 'negative', balanceMinor: '-500', allocatedMinor: '0', availableMinor: '0' },
    { accountId: 'zero', balanceMinor: '0', allocatedMinor: '0', availableMinor: '0' },
  ]);
});

test('Savings: progress and remaining use funded money only, and never exceed their display bounds', () => {
  const underfunded = project([set(goal({ targetMinor: '100' })), add('a', '200')], { cash: '25' }).goals[0];
  assert.equal(underfunded.remainingMinor, '75');
  assert.equal(underfunded.progressPercent, 25);
  const overfunded = project([set(goal({ targetMinor: '100' })), add('a', '200')]).goals[0];
  assert.equal(overfunded.fundedMinor, '200');
  assert.equal(overfunded.remainingMinor, '0');
  assert.equal(overfunded.progressPercent, 100);
});

test('Savings: emergency target and coverage use exact integer math at the 18-digit boundary', () => {
  const emergency = goal({ kind: 'emergency', essentialMonthlyMinor: '333333333333333333', coverageMonths: 3, targetMinor: '999999999999999999' });
  const result = project([set(emergency), add('a', '499999999999999999')], { cash: '499999999999999999' }).goals[0];
  assert.equal(result.remainingMinor, '500000000000000000');
  assert.equal(result.emergencyCoverageMonths, '1.49');
  assert.equal(result.progressPercent, 49.99);
  assert.throws(() => validateSavingsGoalEvent(set({ ...emergency, targetMinor: '999999999999999998' }).event), /SAVINGS_INVALID_EVENT/);
  assert.throws(() => validateSavingsGoalEvent(set({ ...emergency, coverageMonths: 25 }).event), /SAVINGS_INVALID_EVENT/);
});

test('Savings: monthly recommendation includes both calendar endpoint months and rounds up whole paisa', () => {
  const records = [set(goal({ targetMinor: '100', deadline: '2026-12-01' })), add('a', '1')];
  assert.equal(project(records, { cash: '0' }).goals[0].recommendedMonthlyMinor, '34');
  assert.equal(project(records).goals[0].recommendedMonthlyMinor, '33');
  assert.equal(projectSavingsGoals(records, 'personal', { cash: '0' }, '2026-11-30').goals[0].recommendedMonthlyMinor, '50');
  assert.equal(projectSavingsGoals(records, 'personal', { cash: '0' }, '2027-01-01').goals[0].recommendedMonthlyMinor, '100');
  assert.equal(project([set()]).goals[0].recommendedMonthlyMinor, null);
  assert.equal(project([set(goal({ targetMinor: '1', deadline: '2026-10-01' })), add('a', '1')]).goals[0].recommendedMonthlyMinor, '0');
});

test('Savings: schema rejects unknown versions, unsafe data, noncanonical money and impossible dates', () => {
  const malformed: unknown[] = [
    null, [], { ...set().event, version: 2 }, { ...set().event, action: 'journal.add' },
    { ...set().event, surprise: true },
    ...['', '0', '-1', '01', '1.00', '1e3', '1000000000000000000', 100, 1n].map(targetMinor => ({ version: 1, action: 'goal.set', goal: { ...goal(), targetMinor } })),
    ...['2026-02-29', '2026-04-31', '0000-01-01', '2026-1-01'].map(deadline => set(goal({ deadline })).event),
    set(goal({ name: ' ' })).event, set(goal({ name: 'x'.repeat(81) })).event,
    set(goal({ id: '__proto__' })).event, set(goal({ id: 'bad/id' })).event,
    set(goal({ name: '\u202Ehidden' })).event, set(goal({ name: '\ud800' })).event,
    set(goal({ revision: 0 })).event, set(goal({ archived: undefined as unknown as boolean })).event,
    set(goal({ monthlyContributionMinor: '0' })).event,
    add('a', '1', { note: 'x'.repeat(201) }).event,
    add('a', '1', { note: 'new\nline' }).event,
    JSON.parse('{"version":1,"action":"goal.set","__proto__":{},"goal":{}}'),
    Object.create({ version: 1, action: 'goal.set', goal: goal() }),
  ];
  for (const value of malformed) assert.throws(() => validateSavingsGoalEvent(value), /SAVINGS_INVALID_EVENT/);
  const accessor = { version: 1, action: 'goal.set', get goal() { throw new Error('must not execute'); } };
  assert.throws(() => validateSavingsGoalEvent(accessor), /SAVINGS_INVALID_EVENT/);
  assert.doesNotThrow(() => validateSavingsGoalEvent(set(goal({ deadline: '2028-02-29', name: 'গাড়ি কেনা 🚗' })).event));
});

test('Savings: invalid projection metadata and balances fail safely; other workspaces do not reserve local funds', () => {
  const records = [set(goal({ workspaceId: 'business' })), add('a', '100')];
  assert.equal(project(records).accounts[0].allocatedMinor, '0');
  assert.equal(project(records).goals.length, 0);
  for (const balance of ['-0', '01', '1.1', 'NaN', '1000000000000000000']) {
    assert.throws(() => project([], { cash: balance }), /SAVINGS_INVALID_PROJECTION_INPUT/);
  }
  assert.throws(() => projectSavingsGoals([], 'personal', {}, '2026-02-30'), /SAVINGS_INVALID_PROJECTION_INPUT/);
  assert.throws(() => project([{ ...set(), createdAtUtc: '2026-02-30T12:00:00Z' }]), /SAVINGS_INVALID_EVENT/);
  assert.throws(() => project([{ ...set(), createdAtUtc: '2026-10-27T12:00:00+06:00' }]), /SAVINGS_INVALID_EVENT/);
});

test('Savings: projections do not mutate records, balances or any ledger data', () => {
  const records = [set(), add('a', '300')];
  const balances = { cash: '1000' };
  const journal = Object.freeze({ transactions: Object.freeze(['existing-transaction']), balance: '1000' });
  const before = JSON.stringify({ records, balances, journal });
  for (const item of records) { Object.freeze(item.event); Object.freeze(item); }
  Object.freeze(balances);
  const result = project(records, balances);
  assert.equal(result.goals[0].fundedMinor, '300');
  assert.equal(result.accounts[0].balanceMinor, '1000');
  assert.equal(JSON.stringify({ records, balances, journal }), before);
  result.goals[0].goal.name = 'Changed projection';
  assert.equal((records[0].event as Extract<SavingsGoalEvent, { action: 'goal.set' }>).goal.name, 'My car');
});
