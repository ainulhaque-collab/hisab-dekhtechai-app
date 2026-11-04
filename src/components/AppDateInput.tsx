import React, { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { fromBengaliDigits, toBengaliDigits } from '../domain/money';
import { AppSelect } from './AppSelect';
import { useDialog } from './useDialog';
import { calendarMonth, dateLabel, dateParts, localDate, moveCalendarMonth } from './calendarDate';

/** DOM calendar: never invokes the Android WebView's platform date popup. */
export function AppDateInput({ value, onChange, label, language, disabled, className, id }: {
  value: string; onChange: (value: string) => void; label: string; language: 'en' | 'bn';
  disabled?: boolean; className?: string; id?: string;
}) {
  const en = language === 'en';
  const panel = useRef<HTMLDivElement>(null);
  const heading = useId();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => dateParts(value) || dateParts(localDate())!);
  const [yearText, setYearText] = useState(String(view.year));
  const year = Number(fromBengaliDigits(yearText));
  const validYear = /^\d{1,4}$/.test(fromBengaliDigits(yearText)) && year >= 1 && year <= 9999;
  const digits = (text: string | number) => en ? String(text) : toBengaliDigits(String(text));
  const monthFormatter = new Intl.DateTimeFormat(en ? 'en-GB' : 'bn-BD', { month: 'long', timeZone: 'UTC' });
  const monthTitle = (month: number) => monthFormatter.format(new Date(`2000-${String(month).padStart(2, '0')}-01T12:00:00Z`));
  const choose = (date: string) => { onChange(date); setOpen(false); };
  const show = (next: { year: number; month: number }) => { setView({ ...next, day: 1 }); setYearText(String(next.year)); };
  const move = (delta: number) => { const next = moveCalendarMonth(view.year, view.month, delta); if (next) show(next); };
  useDialog(open, panel, () => setOpen(false));

  return <>
    <button id={id} type="button" disabled={disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
      className={`${className || ''} flex items-center justify-between gap-3 text-left disabled:opacity-50`}
      onClick={() => { const next = dateParts(value) || dateParts(localDate())!; setView(next); setYearText(String(next.year)); setOpen(true); }}>
      <span className={value ? '' : 'text-slate-400'}>{value ? dateLabel(value, language) : en ? 'Choose a date' : 'তারিখ বেছে নিন'}</span>
      <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
    </button>
    {open && createPortal(<div className="app-modal-backdrop fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/45 p-2 sm:items-center sm:p-5"
      onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={heading} data-app-calendar="true" style={{ colorScheme: 'light' }}
        className="app-modal-panel max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-4 text-slate-900 shadow-2xl">
        <div className="mb-4 flex items-center gap-2"><CalendarDays className="h-5 w-5 text-blue-700" /><h3 id={heading} className="flex-1 text-sm font-bold">{label}</h3>
          <button type="button" data-calendar-cancel="true" aria-label={en ? 'Close calendar' : 'ক্যালেন্ডার বন্ধ করুন'} onClick={() => setOpen(false)} className="rounded-full p-2 text-slate-500"><X className="h-4 w-4" /></button></div>
        <div className="mb-3 grid grid-cols-[44px_1fr_44px] items-center gap-2">
          <button type="button" data-calendar-previous="true" aria-label={en ? 'Previous month' : 'আগের মাস'} disabled={!moveCalendarMonth(view.year, view.month, -1)} onClick={() => move(-1)} className="flex h-11 items-center justify-center rounded-xl bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <p aria-live="polite" className="text-center text-sm font-bold">{monthTitle(view.month)} {digits(view.year)}</p>
          <button type="button" data-calendar-next="true" aria-label={en ? 'Next month' : 'পরের মাস'} disabled={!moveCalendarMonth(view.year, view.month, 1)} onClick={() => move(1)} className="flex h-11 items-center justify-center rounded-xl bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="text-xs font-medium">{en ? 'Month' : 'মাস'}<AppSelect aria-label={en ? 'Month' : 'মাস'} className="mt-1 flex min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" value={String(view.month)} onChange={event => show({ year: view.year, month: Number(event.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1)}>{monthTitle(i + 1)}</option>)}
          </AppSelect></label>
          <label className="text-xs font-medium">{en ? 'Year' : 'বছর'}<input aria-label={en ? 'Year' : 'বছর'} inputMode="numeric" maxLength={4} value={digits(yearText)}
            aria-invalid={!validYear} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
            onChange={event => { const text = fromBengaliDigits(event.target.value); setYearText(text); if (/^\d{1,4}$/.test(text) && Number(text) >= 1 && Number(text) <= 9999) setView(previous => ({ ...previous, year: Number(text) })); }} /></label>
        </div>
        {!validYear && <p role="status" className="mb-3 text-xs text-rose-700">{en ? 'Enter a year from 1 to 9999.' : '১ থেকে ৯৯৯৯-এর মধ্যে বছর লিখুন।'}</p>}
        <div className="grid grid-cols-7 text-center text-xs text-slate-500" aria-hidden="true">{(en ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি']).map(day => <span key={day} className="py-2">{day}</span>)}</div>
        <div className="grid grid-cols-7 gap-1" role="group" aria-label={en ? 'Choose day' : 'দিন বেছে নিন'}>
          {calendarMonth(view.year, view.month).map((date, i) => date ? <button key={date} type="button" data-calendar-date={date} disabled={!validYear}
            data-dialog-initial-focus={date === (value || localDate()) ? 'true' : undefined}
            aria-label={dateLabel(date, language)} aria-pressed={date === value} onClick={() => choose(date)}
            className={`min-h-11 rounded-xl text-sm font-semibold focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40 ${date === value ? 'bg-blue-700 text-white' : 'bg-white text-slate-900 hover:bg-blue-50'} ${date === localDate() && date !== value ? 'ring-1 ring-inset ring-blue-600' : ''}`}>
            {digits(Number(date.slice(8, 10)))}</button> : <span key={`empty-${i}`} />)}
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3 text-xs font-semibold">
          <button type="button" data-calendar-clear="true" className="min-h-11 rounded-xl px-3 text-slate-600" onClick={() => choose('')}>{en ? 'Clear date' : 'তারিখ মুছুন'}</button>
          <button type="button" className="min-h-11 rounded-xl bg-blue-50 px-3 text-blue-800" onClick={() => choose(localDate())}>{en ? 'Today' : 'আজ'}</button>
          <button type="button" className="min-h-11 rounded-xl px-3 text-slate-600" onClick={() => setOpen(false)}>{en ? 'Cancel' : 'বাতিল'}</button>
        </div>
      </div>
    </div>, document.body)}
  </>;
}
