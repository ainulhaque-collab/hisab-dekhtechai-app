export interface JournalTimeInput {
  effectiveDate?: string;
  effectiveTime?: string;
  occurredAtUtc?: string;
  /** JavaScript convention: minutes to add to local wall time to obtain UTC. */
  occurredTimezoneOffsetMinutes?: number;
}

export function localDate(date = new Date()): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateParts(value: string): number[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid transaction date.');
  const parts = value.split('-').map(Number);
  const check = new Date(0);
  check.setUTCHours(0, 0, 0, 0);
  check.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  if (check.getUTCFullYear() !== parts[0] || check.getUTCMonth() !== parts[1] - 1 || check.getUTCDate() !== parts[2])
    throw new Error('Choose a valid transaction date.');
  return parts;
}

function validInstant(value: string): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** New records carry an explicit wall-clock offset; legacy records are never rewritten. */
export function validateTransactionTime(record: {
  effectiveDate: string; occurredAtUtc: string;
  occurredTimezoneOffsetMinutes?: number; createdAtUtc?: string;
}): void {
  if (record.createdAtUtc !== undefined && !validInstant(record.createdAtUtc))
    throw new Error('Invalid transaction creation timestamp.');
  if (record.occurredTimezoneOffsetMinutes === undefined) return;
  const offset = record.occurredTimezoneOffsetMinutes;
  if (!Number.isInteger(offset) || Math.abs(offset) > 14 * 60 || !validInstant(record.occurredAtUtc))
    throw new Error('Invalid transaction time or timezone offset.');
  dateParts(record.effectiveDate);
  const dateAtOrigin = new Date(Date.parse(record.occurredAtUtc) - offset * 60_000).toISOString().slice(0, 10);
  if (dateAtOrigin !== record.effectiveDate) throw new Error('Transaction time does not match its date.');
}

/** Resolve at submission, rather than when a possibly long-lived form was opened. */
export function resolveJournalTime(input: JournalTimeInput = {}, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error('Device date and time are unavailable.');
  const createdAtUtc = now.toISOString();
  if (input.occurredAtUtc !== undefined) {
    if (input.occurredTimezoneOffsetMinutes === undefined || input.effectiveTime)
      throw new Error('An explicit UTC transaction time requires its timezone offset.');
    const effectiveDate = input.effectiveDate || new Date(Date.parse(input.occurredAtUtc) - input.occurredTimezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
    const result = { effectiveDate, occurredAtUtc: input.occurredAtUtc,
      occurredTimezoneOffsetMinutes: input.occurredTimezoneOffsetMinutes, createdAtUtc };
    validateTransactionTime(result);
    return result;
  }
  const effectiveDate = input.effectiveDate || localDate(now);
  const [year, month, day] = dateParts(effectiveDate);
  const chosen = new Date(now.getTime());
  chosen.setFullYear(year, month - 1, day);
  if (input.effectiveTime) {
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(input.effectiveTime)) throw new Error('Choose a valid transaction time.');
    const [hours, minutes, seconds = 0] = input.effectiveTime.split(':').map(Number);
    chosen.setHours(hours, minutes, seconds, 0);
    if (chosen.getHours() !== hours || chosen.getMinutes() !== minutes || chosen.getSeconds() !== seconds)
      throw new Error('This local time is unavailable in the device timezone.');
  }
  if (localDate(chosen) !== effectiveDate) throw new Error('Choose a valid transaction date and time.');
  return { effectiveDate, occurredAtUtc: chosen.toISOString(),
    occurredTimezoneOffsetMinutes: chosen.getTimezoneOffset(), createdAtUtc };
}

/** Old records have no reliable occurrence clock: display their date without inventing one. */
export function transactionTimeLabel(record: {
  effectiveDate: string; occurredAtUtc: string; occurredTimezoneOffsetMinutes?: number;
}): string {
  if (record.occurredTimezoneOffsetMinutes === undefined) return record.effectiveDate;
  try {
    validateTransactionTime(record);
    const wallTime = new Date(Date.parse(record.occurredAtUtc) - record.occurredTimezoneOffsetMinutes * 60_000);
    const minutes = -record.occurredTimezoneOffsetMinutes;
    const sign = minutes < 0 ? '-' : '+';
    const zone = `${sign}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
    return `${record.effectiveDate} · ${wallTime.toISOString().slice(11, 16)} (UTC${zone})`;
  } catch { return record.effectiveDate; }
}
