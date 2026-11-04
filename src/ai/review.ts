import { parsePaisaString, paisaToDecimalString } from '../domain/money';
import { resolveJournalTime } from '../domain/transactionTime';

export interface ReviewedEntry {
  type: 'income' | 'expense' | 'transfer'; amount: string; date: string; time: string; note: string;
}

/** No account, journal or sync authority. Applying a review only fills the form. */
export function validateReviewedEntry(raw: { type: string; amount: string; currency: string; date: string; time: string; note: string }): ReviewedEntry {
  if (!['income', 'expense', 'transfer'].includes(raw.type) || raw.currency !== 'BDT') throw new Error('AI_REVIEW_REQUIRED');
  const paisa = parsePaisaString(raw.amount);
  if (paisa <= 0n || raw.note.length > 1000) throw new Error('AI_REVIEW_REQUIRED');
  resolveJournalTime({ effectiveDate: raw.date || undefined, effectiveTime: raw.time || undefined });
  return { type: raw.type as ReviewedEntry['type'], amount: paisaToDecimalString(paisa), date: raw.date, time: raw.time, note: raw.note.trim() };
}
