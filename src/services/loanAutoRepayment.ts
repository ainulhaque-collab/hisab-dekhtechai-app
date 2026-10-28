import type { LocalDatabase } from '../storage/db';
import { loanToday } from '../storage/loanBook';
import { planLoanAutoRepayment } from '../domain/savingsLoans';

const running = new WeakSet<LocalDatabase>();
/** Foreground only, invoked AFTER verified Drive sync on the issuing device.
 * Committed-history IDs permit later partial payments without duplicate debits. */
export async function runForegroundLoanRepayments(db: LocalDatabase, now = new Date()): Promise<{ paid: number; failed: number }> {
  const result = { paid: 0, failed: 0 };
  const owner = db.getIdentity()?.ownerSubjectHash;
  const verified = db.getRawState().preferences.get('last-verified-sync-v1');
  const age = now.getTime() - Date.parse(verified?.at);
  if (!owner || verified?.ownerHash !== owner || !Number.isFinite(age) || age < -5000 || age > 120_000 ||
    running.has(db) || db.isTransactionInProgress()) return result;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', hourCycle: 'h23' }).format(now);
  running.add(db);
  try {
    const day = loanToday(now);
    for (const row of db.getSavingsLoans(undefined, day)) {
      const t = row.issue.terms;
      if (!row.autoRepayEnabled || row.issue.executorDeviceId !== db.getDeviceId() || row.pendingReferences || t.dueDate > day ||
        t.dueDate === day && Number(time) < 19 || row.balance.status === 'paid') continue;
      if (db.getIdentity()?.ownerSubjectHash !== owner || db.isTransactionInProgress()) break;
      try {
        const projection = db.getSavingsProjection(t.borrowerWorkspaceId);
        if (projection.orphanAllocationCount || projection.orphanReleaseCount) continue;
        const available = projection.accounts.find(a => a.accountId === t.borrowerAccountId)?.availableMinor || '0';
        const proposed = planLoanAutoRepayment(t, row.payments, day, available);
        if (proposed.status !== 'proposal') continue;
        await db.repaySavingsLoan(t.id, proposed.payment.id, proposed.amountMinor, now, true);
        result.paid++;
      } catch { result.failed++; }
    }
    return result;
  } finally { running.delete(db); }
}
