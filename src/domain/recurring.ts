/**
 * Deterministic Recurring Schedules and Budget Math
 */

import { UUID, RecurringRule, RecurringOccurrence, PaisaString, Budget } from '../contracts/types';
import { toPaisa } from './money';

/**
 * Computes deterministic occurrence ID for recurring rules.
 * sha256 or safe hash of (ruleId + ":" + effectiveDate + ":" + generation)
 */
export function computeOccurrenceId(ruleId: UUID, effectiveDate: string, generation: number): string {
  const payload = `${ruleId}:${effectiveDate}:${generation}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `occ-${hex}-${ruleId.slice(0, 8)}-${effectiveDate.replace(/-/g, '')}`;
}

/**
 * Evaluates whether a recurring rule is due on a given target date.
 */
export function isRuleDueOnDate(rule: RecurringRule, date: Date): boolean {
  if (!rule.active) return false;
  
  if (rule.frequency === 'daily') {
    return true;
  }
  
  if (rule.frequency === 'weekly') {
    const dayOfWeek = date.getDay(); // 0 is Sunday, 5 is Friday
    return rule.dayOfWeek === undefined || rule.dayOfWeek === dayOfWeek;
  }
  
  if (rule.frequency === 'monthly') {
    const dayOfMonth = date.getDate();
    return rule.dayOfMonth === undefined || rule.dayOfMonth === dayOfMonth;
  }
  
  return false;
}

/**
 * Budget compliance calculation.
 * Returns percentage used and alert status.
 */
export function evaluateBudget(
  budget: Budget,
  spentMinor: PaisaString
): {
  spentMinor: PaisaString;
  limitMinor: PaisaString;
  percentageUsed: number;
  isOverBudget: boolean;
  alertLevel: 'ok' | 'warning' | 'danger';
} {
  const spent = toPaisa(spentMinor);
  const limit = toPaisa(budget.limitMinor);

  if (limit <= 0n) {
    return {
      spentMinor,
      limitMinor: budget.limitMinor,
      percentageUsed: 0,
      isOverBudget: false,
      alertLevel: 'ok',
    };
  }

  const percentageUsed = Math.round(Number((spent * 10000n) / limit) / 100);
  const isOverBudget = spent > limit;

  let alertLevel: 'ok' | 'warning' | 'danger' = 'ok';
  if (isOverBudget) {
    alertLevel = 'danger';
  } else if (percentageUsed >= 80) {
    alertLevel = 'warning';
  }

  return {
    spentMinor,
    limitMinor: budget.limitMinor,
    percentageUsed,
    isOverBudget,
    alertLevel,
  };
}
