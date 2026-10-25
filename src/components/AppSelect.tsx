import { Check, ChevronDown, Search, X, ListFilter } from 'lucide-react';
import { useDialog } from './useDialog';
import React, { Children, isValidElement, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  onChange?: (event: { target: { value: string } }) => void;
};
type Option = { value: string; label: React.ReactNode; text: string; disabled: boolean };
function textOf(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return Children.toArray(node).map(textOf).join('');
}
export function selectOptions(children: React.ReactNode, disabled = false): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: React.ReactNode; disabled?: boolean; value?: string }>(child)) return [];
    if (child.type !== 'option') return selectOptions(child.props.children, disabled || child.props.disabled);
    return [{ value: String(child.props.value ?? textOf(child.props.children)), label: child.props.children,
      text: textOf(child.props.children), disabled: disabled || !!child.props.disabled }];
  });
}

/** DOM picker: never invokes the WebView's platform select popup. */
export function AppSelect({ children, value, onChange, disabled, className, id, ...props }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listId = useId();
  const options = selectOptions(children);
  const selected = options.find(o => o.value === String(value ?? ''));
  const shown = options.filter(o => o.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const label = props['aria-label'] || (id && typeof document !== 'undefined' && document.querySelector(`label[for="${id}"]`)?.textContent) || 'Select / নির্বাচন';
  const bn = /[\u0980-\u09FF]/.test(String(label));
  useDialog(open, panel, () => setOpen(false));
  return <>
    <button ref={trigger} id={id} type="button" disabled={disabled} className={`${className || ''} flex items-center justify-between gap-2 text-left disabled:opacity-40`}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={String(label)}
      onClick={() => { setQuery(''); setOpen(true); }}
      onKeyDown={e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); } }}>
      <span className="min-w-0 truncate">{selected?.label || (bn ? 'নির্বাচন করুন' : 'Select an option')}</span><ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[200] bg-slate-950/45 backdrop-blur-sm flex items-end sm:items-center justify-center p-2 sm:p-5"
      onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={String(label)}
        className="bg-white text-slate-900 rounded-[24px] w-full max-w-md shadow-2xl ring-1 ring-white/70 flex flex-col max-h-[85dvh] overflow-hidden"
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
          const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') || []);
          const index = nodes.indexOf(document.activeElement as HTMLElement);
          if (['ArrowDown','ArrowUp','Home','End'].includes(e.key) && (e.target as HTMLElement).tagName !== 'INPUT') {
            e.preventDefault(); nodes[e.key === 'Home' ? 0 : e.key === 'End' ? nodes.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + nodes.length) % nodes.length]?.focus();
          }
        }}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center"><ListFilter className="h-4 w-4" /></div>
          <div className="flex-1"><div className="text-sm font-bold">{label}</div><p className="mt-0.5 text-[11px] text-slate-400">{bn ? 'একটি অপশন নির্বাচন করুন' : 'Choose an option to continue'}</p></div>
          <button type="button" aria-label={bn ? 'বন্ধ করুন' : 'Close picker'} onClick={() => setOpen(false)} className="p-2 rounded-full text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        {options.length > 6 && <div className="relative mx-4 mt-3 mb-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input aria-label={bn ? 'খুঁজুন' : 'Search options'} placeholder={bn ? 'অপশন খুঁজুন…' : 'Search options…'} value={query}
          onChange={e => setQuery(e.target.value)} className="w-full py-2.5 pl-9 pr-3 border border-slate-200 rounded-xl text-xs text-slate-900 bg-slate-50 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" /></div>}
        <div id={listId} role="listbox" aria-label={String(label)} className="overflow-y-auto overscroll-contain min-h-0 p-3 space-y-1">
          {shown.length === 0 && <p role="status" className="p-8 text-center text-sm text-slate-400">{bn ? 'কোনো ফল পাওয়া যায়নি' : 'No matching options'}</p>}
          {shown.map((o, i) => <button key={`${o.value}-${i}`} type="button" role="option" aria-selected={o.value === String(value ?? '')}
            disabled={o.disabled} className="flex w-full items-center justify-between gap-3 text-left px-3.5 py-3.5 min-h-12 rounded-xl bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 aria-selected:bg-blue-50 aria-selected:text-blue-800 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40"
            onClick={() => { onChange?.({ target: { value: o.value } }); setOpen(false); }}><span className="min-w-0 break-words">{o.label}</span><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${o.value === String(value ?? '') ? 'bg-blue-700 text-white' : 'border border-slate-200'}`}>{o.value === String(value ?? '') && <Check className="h-3 w-3" strokeWidth={3} />}</span></button>)}
        </div>
        <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"><button type="button" className="w-full min-h-10 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50" onClick={() => setOpen(false)}>{bn ? 'বাতিল' : 'Cancel'}</button></div>
      </div>
    </div>, document.body)}
  </>;
}
