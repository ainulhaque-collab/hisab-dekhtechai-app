/**
 * Savings goals are reservations of existing account balances, never ledger entries.
 * Recompute this projection from the complete, append-only event set after sync.
 */
export interface SavingsGoal {
  id: string;
  workspaceId: string;
  name: string;
  kind: 'general' | 'emergency';
  targetMinor: string;
  deadline?: string;
  monthlyContributionMinor?: string;
  essentialMonthlyMinor?: string;
  coverageMonths?: number;
  revision: number;
  archived: boolean;
}

export type SavingsGoalEvent =
  | { version: 1; action: 'goal.set'; goal: SavingsGoal }
  | { version: 1; action: 'goal.delete'; goalId: string }
  | { version: 1; action: 'allocation.add'; goalId: string; allocationId: string; accountId: string; amountMinor: string; note?: string }
  | { version: 1; action: 'allocation.release'; goalId: string; allocationId: string; amountMinor: string };

export interface SavingsEventRecord {
  operationId: string;
  createdAtUtc: string;
  event: SavingsGoalEvent;
}

export interface SavingsContributionProjection {
  allocationId: string;
  accountId: string;
  amountMinor: string;
  releasedMinor: string;
  requestedMinor: string;
  fundedMinor: string;
  shortfallMinor: string;
  note?: string;
  createdAtUtc: string;
}

export interface ProjectedSavingsGoal {
  goal: SavingsGoal;
  /** Durable tombstone; metadata/history remain available for sync validation. */
  deleted?: true;
  requestedMinor: string;
  fundedMinor: string;
  shortfallMinor: string;
  remainingMinor: string;
  progressPercent: number;
  recommendedMonthlyMinor: string | null;
  emergencyCoverageMonths: string | null;
  contributions: SavingsContributionProjection[];
}

export interface SavingsAccountProjection {
  accountId: string;
  balanceMinor: string;
  allocatedMinor: string;
  availableMinor: string;
}

export interface SavingsProjection {
  goals: ProjectedSavingsGoal[];
  accounts: SavingsAccountProjection[];
  /** Pending metadata/adds may arrive in a later offline-sync batch. */
  orphanAllocationCount: number;
  orphanReleaseCount: number;
}

const MAX_RECORDS = 100_000;
const MAX_ACCOUNTS = 10_000;
const positiveMinor = /^[1-9]\d{0,17}$/;
const signedMinor = /^(?:0|-?[1-9]\d{0,17})$/;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const unsafeText = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

function invalid(): never { throw new Error('SAVINGS_INVALID_EVENT'); }
function conflict(): never { throw new Error('SAVINGS_EVENT_CONFLICT'); }
function invalidProjection(): never { throw new Error('SAVINGS_INVALID_PROJECTION_INPUT'); }

/** Reject prototypes/accessors and unknown keys before reading untrusted fields. */
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return invalid();
  if (Object.getOwnPropertySymbols(value).length) return invalid();
  const result = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.includes(key) || unsafeKeys.has(key) || !descriptor || !('value' in descriptor)) return invalid();
  }
  return result;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !identifier.test(value) || unsafeKeys.has(value)) return invalid();
  return value;
}

function text(value: unknown, limit: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > limit || (!allowEmpty && !value.trim()) || unsafeText.test(value)) return invalid();
  // JSON may contain isolated UTF-16 surrogates; they cannot be safely rendered/exported.
  for (let index = 0; index < value.length; index++) {
    const char = value.charCodeAt(index);
    if (char >= 0xd800 && char <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return invalid();
    } else if (char >= 0xdc00 && char <= 0xdfff) return invalid();
  }
  return value;
}

function amount(value: unknown): string {
  if (typeof value !== 'string' || !positiveMinor.test(value)) return invalid();
  return value;
}

function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') return invalid();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid();
  return value;
}

function validateGoal(value: unknown): SavingsGoal {
  const item = object(value, ['id', 'workspaceId', 'name', 'kind', 'targetMinor', 'deadline', 'monthlyContributionMinor', 'essentialMonthlyMinor', 'coverageMonths', 'revision', 'archived']);
  if (item.kind !== 'general' && item.kind !== 'emergency') return invalid();
  if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 1 || typeof item.archived !== 'boolean') return invalid();
  const goal: SavingsGoal = {
    id: id(item.id), workspaceId: id(item.workspaceId), name: text(item.name, 80),
    kind: item.kind, targetMinor: amount(item.targetMinor), revision: item.revision as number, archived: item.archived,
  };
  if (item.deadline !== undefined) goal.deadline = date(item.deadline);
  if (item.monthlyContributionMinor !== undefined) goal.monthlyContributionMinor = amount(item.monthlyContributionMinor);
  if (goal.kind === 'emergency') {
    goal.essentialMonthlyMinor = amount(item.essentialMonthlyMinor);
    if (!Number.isInteger(item.coverageMonths) || (item.coverageMonths as number) < 1 || (item.coverageMonths as number) > 24) return invalid();
    goal.coverageMonths = item.coverageMonths as number;
    if (BigInt(goal.targetMinor) !== BigInt(goal.essentialMonthlyMinor) * BigInt(goal.coverageMonths)) return invalid();
  } else if (item.essentialMonthlyMinor !== undefined || item.coverageMonths !== undefined) return invalid();
  return goal;
}

/** Validates a closed versioned schema and returns a detached, canonical value. */
export function validateSavingsGoalEvent(value: unknown): SavingsGoalEvent {
  const envelope = object(value, ['version', 'action', 'goal', 'goalId', 'allocationId', 'accountId', 'amountMinor', 'note']);
  if (envelope.version !== 1) return invalid();
  if (envelope.action === 'goal.set') {
    const item = object(value, ['version', 'action', 'goal']);
    return { version: 1, action: 'goal.set', goal: validateGoal(item.goal) };
  }
  if (envelope.action === 'allocation.add') {
    const item = object(value, ['version', 'action', 'goalId', 'allocationId', 'accountId', 'amountMinor', 'note']);
    const event: Extract<SavingsGoalEvent, { action: 'allocation.add' }> = {
      version: 1, action: 'allocation.add', goalId: id(item.goalId), allocationId: id(item.allocationId),
      accountId: id(item.accountId), amountMinor: amount(item.amountMinor),
    };
    if (item.note !== undefined) event.note = text(item.note, 200, true);
    return event;
  }
  if (envelope.action === 'allocation.release') {
    const item = object(value, ['version', 'action', 'goalId', 'allocationId', 'amountMinor']);
    return { version: 1, action: 'allocation.release', goalId: id(item.goalId), allocationId: id(item.allocationId), amountMinor: amount(item.amountMinor) };
  }
  if (envelope.action === 'goal.delete') {
    const item = object(value, ['version', 'action', 'goalId']);
    return { version: 1, action: 'goal.delete', goalId: id(item.goalId) };
  }
  return invalid();
}

/** Separate wire extension so older savings clients retain, rather than reject,
 * deletion operations whose action they do not yet understand. */
export function validateSavingsDeletion(value: unknown): Extract<SavingsGoalEvent, { action: 'goal.delete' }> {
  const item = object(value, ['version', 'goalId']);
  if (item.version !== 1) return invalid();
  return { version: 1, action: 'goal.delete', goalId: id(item.goalId) };
}

function record(value: unknown): SavingsEventRecord {
  const item = object(value, ['operationId', 'createdAtUtc', 'event']);
  if (typeof item.createdAtUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(item.createdAtUtc)) return invalid();
  const parsed = new Date(item.createdAtUtc);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== item.createdAtUtc.slice(0, 19) || item.createdAtUtc.startsWith('0000-')) return invalid();
  return { operationId: id(item.operationId), createdAtUtc: item.createdAtUtc, event: validateSavingsGoalEvent(item.event) };
}

const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const chronology = (left: SavingsEventRecord, right: SavingsEventRecord) =>
  Date.parse(left.createdAtUtc) - Date.parse(right.createdAtUtc) || compareText(left.operationId, right.operationId);
const maximum = (left: bigint, right: bigint) => left > right ? left : right;
const minimum = (left: bigint, right: bigint) => left < right ? left : right;

/**
 * Recommendation includes the current calendar month and deadline month. Past
 * deadlines use one month. It rounds up to a whole paisa; no deadline yields null.
 */
function monthlyRecommendation(remaining: bigint, deadline: string | undefined, today: string): string | null {
  if (!deadline) return null;
  const months = Math.max(1, (Number(deadline.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(deadline.slice(5, 7)) - Number(today.slice(5, 7)) + 1);
  return ((remaining + BigInt(months) - 1n) / BigInt(months)).toString();
}

/**
 * Deterministic, read-only reservation projection. All unarchived goals compete
 * for each account's max(0, current balance), in add creation order then operation
 * ID order. Oversubscribed and archived requests remain visible as shortfalls.
 */
export function projectSavingsGoals(records: SavingsEventRecord[], workspaceId: string, balances: Record<string, string>, today: string): SavingsProjection {
  try { id(workspaceId); date(today); } catch { return invalidProjection(); }
  if (!Array.isArray(records) || records.length > MAX_RECORDS) return invalidProjection();
  let balanceEntries: [string, unknown][];
  try {
    if (!balances || typeof balances !== 'object' || Array.isArray(balances)) return invalidProjection();
    const keys = Object.getOwnPropertyNames(balances);
    if (keys.length > MAX_ACCOUNTS) return invalidProjection();
    const safe = object(balances, keys);
    balanceEntries = keys.map(key => [id(key), safe[key]]);
  } catch { return invalidProjection(); }
  const accountBalances = new Map<string, bigint>();
  for (const [accountId, value] of balanceEntries) {
    if (typeof value !== 'string' || !signedMinor.test(value)) return invalidProjection();
    accountBalances.set(accountId, BigInt(value));
  }

  const unique = new Map<string, SavingsEventRecord>();
  for (const raw of records) {
    const checked = record(raw);
    const prior = unique.get(checked.operationId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(checked)) return conflict();
    unique.set(checked.operationId, checked);
  }

  const goals = new Map<string, SavingsEventRecord & { event: Extract<SavingsGoalEvent, { action: 'goal.set' }> }>();
  const adds = new Map<string, SavingsEventRecord & { event: Extract<SavingsGoalEvent, { action: 'allocation.add' }> }>();
  const releases = new Map<string, { goalId: string; total: bigint; count: number }>();
  const deletions = new Set<string>();
  for (const item of unique.values()) {
    const event = item.event;
    if (event.action === 'goal.set') {
      const prior = goals.get(event.goal.id);
      if (prior && prior.event.goal.workspaceId !== event.goal.workspaceId) return conflict();
      if (!prior || event.goal.revision > prior.event.goal.revision ||
        (event.goal.revision === prior.event.goal.revision && compareText(item.operationId, prior.operationId) > 0)) {
        goals.set(event.goal.id, item as typeof prior & { event: typeof event });
      }
    } else if (event.action === 'goal.delete') {
      deletions.add(event.goalId);
    } else if (event.action === 'allocation.add') {
      const prior = adds.get(event.allocationId);
      if (prior && JSON.stringify(prior.event) !== JSON.stringify(event)) return conflict();
      // An exact allocation replay under a new operation ID is still one reservation.
      if (!prior || chronology(item, prior) < 0) adds.set(event.allocationId, item as typeof prior & { event: typeof event });
    } else {
      const prior = releases.get(event.allocationId);
      if (prior && prior.goalId !== event.goalId) return conflict();
      releases.set(event.allocationId, { goalId: event.goalId, total: (prior?.total || 0n) + BigInt(event.amountMinor), count: (prior?.count || 0) + 1 });
    }
  }
  for (const [allocationId, release] of releases) {
    const add = adds.get(allocationId);
    if (add && add.event.goalId !== release.goalId) return conflict();
  }

  const projected = new Map<string, ProjectedSavingsGoal>();
  for (const item of goals.values()) {
    if (item.event.goal.workspaceId !== workspaceId) continue;
    const goal = item.event.goal;
    projected.set(goal.id, { goal, ...(deletions.has(goal.id) ? { deleted: true as const } : {}), requestedMinor: '0', fundedMinor: '0', shortfallMinor: '0', remainingMinor: goal.targetMinor, progressPercent: 0,
      recommendedMonthlyMinor: monthlyRecommendation(BigInt(goal.targetMinor), goal.deadline, today),
      emergencyCoverageMonths: goal.kind === 'emergency' ? '0.00' : null, contributions: [] });
  }

  const allocated = new Map<string, bigint>();
  let orphanAllocationCount = 0;
  let orphanReleaseCount = 0;
  for (const [allocationId, release] of releases) if (!adds.has(allocationId)) orphanReleaseCount += release.count;
  for (const item of [...adds.values()].sort(chronology)) {
    const event = item.event;
    if (!goals.has(event.goalId)) { orphanAllocationCount++; continue; }
    const projection = projected.get(event.goalId);
    if (!projection) continue;
    const amount = BigInt(event.amountMinor);
    const released = minimum(amount, releases.get(event.allocationId)?.total || 0n);
    const requested = amount - released;
    const reserved = allocated.get(event.accountId) || 0n;
    const available = maximum(0n, accountBalances.get(event.accountId) || 0n) - reserved;
    const funded = projection.deleted || projection.goal.archived ? 0n : minimum(requested, available);
    allocated.set(event.accountId, reserved + funded);
    const contribution: SavingsContributionProjection = {
      allocationId: event.allocationId, accountId: event.accountId, amountMinor: amount.toString(), releasedMinor: released.toString(),
      requestedMinor: requested.toString(), fundedMinor: funded.toString(), shortfallMinor: (requested - funded).toString(), createdAtUtc: item.createdAtUtc,
    };
    if (event.note !== undefined) contribution.note = event.note;
    projection.contributions.push(contribution);
    projection.requestedMinor = (BigInt(projection.requestedMinor) + requested).toString();
    projection.fundedMinor = (BigInt(projection.fundedMinor) + funded).toString();
  }

  for (const item of projected.values()) {
    const funded = BigInt(item.fundedMinor);
    const target = BigInt(item.goal.targetMinor);
    const remaining = maximum(0n, target - funded);
    item.shortfallMinor = (BigInt(item.requestedMinor) - funded).toString();
    item.remainingMinor = remaining.toString();
    item.progressPercent = Number(minimum(10_000n, funded * 10_000n / target)) / 100;
    item.recommendedMonthlyMinor = monthlyRecommendation(remaining, item.goal.deadline, today);
    if (item.goal.kind === 'emergency') {
      const hundredths = funded * 100n / BigInt(item.goal.essentialMonthlyMinor!);
      item.emergencyCoverageMonths = `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}`;
    }
  }
  const accountIds = new Set([...accountBalances.keys(), ...allocated.keys()]);
  return {
    goals: [...projected.values()].sort((left, right) => compareText(left.goal.id, right.goal.id)),
    accounts: [...accountIds].sort(compareText).map(accountId => {
      const balance = accountBalances.get(accountId) || 0n;
      const reserved = allocated.get(accountId) || 0n;
      return { accountId, balanceMinor: balance.toString(), allocatedMinor: reserved.toString(), availableMinor: (maximum(0n, balance) - reserved).toString() };
    }),
    orphanAllocationCount, orphanReleaseCount,
  };
}
