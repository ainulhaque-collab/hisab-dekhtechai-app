export function localDate(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function dateParts(value: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) };
}

const formatters = new Map<'en' | 'bn', Intl.DateTimeFormat>();
export function dateLabel(value: string, language: 'en' | 'bn'): string {
  if (!dateParts(value)) return value;
  let formatter = formatters.get(language);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'bn-BD', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
    formatters.set(language, formatter);
  }
  return formatter.format(new Date(`${value}T12:00:00Z`));
}

export function moveCalendarMonth(year: number, month: number, delta: number): { year: number; month: number } | null {
  const serial = (year - 1) * 12 + month - 1 + delta;
  if (!Number.isInteger(serial) || serial < 0 || serial >= 9999 * 12) return null;
  return { year: Math.floor(serial / 12) + 1, month: serial % 12 + 1 };
}

export function calendarMonth(year: number, month: number): (string | null)[] {
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  if (!dateParts(`${prefix}-01`)) return [];
  const offset = new Date(`${prefix}-01T12:00:00Z`).getUTCDay();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1;
    const value = `${prefix}-${String(day).padStart(2, '0')}`;
    return day >= 1 && day <= 31 && dateParts(value) ? value : null;
  });
}
