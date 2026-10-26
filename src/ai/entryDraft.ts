import { parsePaisaString, paisaToDecimalString } from '../domain/money';
import { resolveJournalTime } from '../domain/transactionTime';

export interface EntryDraft {
  transactionType: 'income' | 'expense' | 'transfer' | 'unknown';
  amountDecimal: string | null;
  currency: 'BDT' | 'unknown';
  merchant: string | null;
  transactionDate: string | null;
  transactionTime: string | null;
  transcript: string | null;
  note: string;
  warnings: string[];
  requiresConfirmation: true;
}

export const entryDraftSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    transactionType: { type: 'string', enum: ['income', 'expense', 'transfer', 'unknown'] },
    amountDecimal: { type: ['string', 'null'] }, currency: { type: 'string', enum: ['BDT', 'unknown'] },
    merchant: { type: ['string', 'null'] }, transactionDate: { type: ['string', 'null'] },
    transactionTime: { type: ['string', 'null'] }, transcript: { type: ['string', 'null'] },
    note: { type: 'string' }, warnings: { type: 'array', items: { type: 'string' }, maxItems: 10 },
  },
  required: ['transactionType', 'amountDecimal', 'currency', 'merchant', 'transactionDate', 'transactionTime', 'transcript', 'note', 'warnings'],
};

/** Model JSON remains untrusted, even when it was generated with a schema. */
export function validateEntryDraft(value: unknown): EntryDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI_DRAFT_INVALID');
  const raw = value as Record<string, unknown>;
  const keys = new Set(Object.keys(entryDraftSchema.properties));
  if (Object.keys(raw).some(key => !keys.has(key))) throw new Error('AI_DRAFT_INVALID');
  const text = (key: string, max: number, nullable = true): string | null => {
    const field = raw[key];
    if (field === null && nullable) return null;
    if (typeof field !== 'string' || field.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(field)) throw new Error('AI_DRAFT_INVALID');
    return nullable && !field.trim() ? null : field.trim();
  };
  if (!['income', 'expense', 'transfer', 'unknown'].includes(raw.transactionType as string) ||
      !['BDT', 'unknown'].includes(raw.currency as string)) throw new Error('AI_DRAFT_INVALID');
  const amount = text('amountDecimal', 64);
  let amountDecimal: string | null = null;
  if (amount !== null) {
    let paisa: bigint;
    try { paisa = parsePaisaString(amount); } catch { throw new Error('AI_DRAFT_INVALID_AMOUNT'); }
    if (paisa <= 0n) throw new Error('AI_DRAFT_INVALID_AMOUNT');
    amountDecimal = paisaToDecimalString(paisa);
  }
  const transactionDate = text('transactionDate', 10), transactionTime = text('transactionTime', 8);
  if (transactionDate !== null || transactionTime !== null) {
    try { resolveJournalTime({ effectiveDate: transactionDate || undefined, effectiveTime: transactionTime || undefined }); }
    catch { throw new Error('AI_DRAFT_INVALID_DATE_TIME'); }
  }
  if (!Array.isArray(raw.warnings) || raw.warnings.length > 10 || raw.warnings.some(item => typeof item !== 'string' || item.length > 300))
    throw new Error('AI_DRAFT_INVALID');
  return { transactionType: raw.transactionType as EntryDraft['transactionType'], amountDecimal,
    currency: raw.currency as EntryDraft['currency'], merchant: text('merchant', 250), transactionDate,
    transactionTime, transcript: text('transcript', 6000), note: text('note', 1000, false)!,
    warnings: [...raw.warnings] as string[], requiresConfirmation: true };
}
