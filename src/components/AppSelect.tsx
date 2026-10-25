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
  useDialog(open, panel, () => setOpen(false));
  return <>
    <button ref={trigger} id={id} type="button" disabled={disabled} className={`${className || ''} text-left`}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={String(label)}
      onClick={() => { setQuery(''); setOpen(true); }}
      onKeyDown={e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); } }}>
      {selected?.label || 'Select / নির্বাচন'} <span aria-hidden="true">▾</span>
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[200] bg-black/50 flex items-end sm:items-center justify-center p-3"
      onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={String(label)}
        className="bg-white text-slate-900 rounded-2xl p-4 w-full max-w-md shadow-xl flex flex-col max-h-[85dvh] pb-[max(1rem,env(safe-area-inset-bottom))]"
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
          const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('input,button:not(:disabled)') || []);
          const index = nodes.indexOf(document.activeElement as HTMLElement);
          if (e.key === 'Tab') { e.preventDefault(); nodes[(index + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus(); }
          if (['ArrowDown','ArrowUp','Home','End'].includes(e.key) && (e.target as HTMLElement).tagName !== 'INPUT') {
            e.preventDefault(); nodes[e.key === 'Home' ? 0 : e.key === 'End' ? nodes.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + nodes.length) % nodes.length]?.focus();
          }
        }}>
        <div className="font-semibold mb-3">{label}</div>
        {options.length > 6 && <input aria-label="Search / খুঁজুন" placeholder="Search / খুঁজুন" value={query}
          onChange={e => setQuery(e.target.value)} className="p-3 border border-slate-300 rounded-lg mb-2 text-slate-900 bg-white" />}
        <div id={listId} role="listbox" aria-label={String(label)} className="overflow-y-auto overscroll-contain min-h-0">
          {shown.length === 0 && <p role="status" className="p-4">No options / কোনো ফল নেই</p>}
          {shown.map((o, i) => <button key={`${o.value}-${i}`} type="button" role="option" aria-selected={o.value === String(value ?? '')}
            disabled={o.disabled} className="block w-full text-left p-3 min-h-11 rounded-lg bg-white text-slate-900 aria-selected:bg-blue-100 focus:bg-blue-100 disabled:opacity-40"
            onClick={() => { onChange?.({ target: { value: o.value } }); setOpen(false); }}>{o.label}</button>)}
        </div>
        <button type="button" className="p-3 mt-2 border rounded-lg" onClick={() => setOpen(false)}>Cancel / বাতিল</button>
      </div>
    </div>, document.body)}
  </>;
}
