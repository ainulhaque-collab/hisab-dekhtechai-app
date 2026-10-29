import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarMonth, dateLabel, dateParts, localDate, moveCalendarMonth } from '../components/calendarDate';

test('Calendar preserves canonical date-only values, leap years and early years without rollover', () => {
  assert.deepEqual(dateParts('2028-02-29'), { year: 2028, month: 2, day: 29 });
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '2026-1-1']) assert.equal(dateParts(value), null);
  assert.deepEqual(dateParts('0001-01-01'), { year: 1, month: 1, day: 1 });
  assert.equal(calendarMonth(2028, 2).filter(Boolean).length, 29);
  assert.equal(calendarMonth(2026, 2).filter(Boolean).length, 28);
  assert.equal(calendarMonth(2026, 10).indexOf('2026-10-01'), 4);
  assert.equal(calendarMonth(2026, 10).filter(Boolean).at(-1), '2026-10-31');
});

test('Calendar navigation crosses years, guards bounds and labels without timezone conversion', () => {
  assert.deepEqual(moveCalendarMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(moveCalendarMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.equal(moveCalendarMonth(1, 1, -1), null);
  assert.equal(moveCalendarMonth(9999, 12, 1), null);
  assert.match(dateLabel('2026-12-15', 'en'), /15 December 2026/);
  assert.match(dateLabel('2026-12-15', 'bn'), /১৫/);
  const local = new Date(2026, 9, 28, 23, 59);
  assert.equal(localDate(local), '2026-10-28');
});
