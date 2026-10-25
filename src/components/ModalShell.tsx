import React, { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialog } from './useDialog';

export function ModalShell({ title, description, icon, children, footer, onClose, busy = false }: {
  title: string; description?: string; icon?: React.ReactNode; children: React.ReactNode;
  footer?: React.ReactNode; onClose: () => void; busy?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const heading = useId();
  useDialog(true, panel, () => { if (!busy) onClose(); });
  return createPortal(<div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/45 backdrop-blur-sm p-2 sm:p-5"
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={heading}
      className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-white text-slate-900 shadow-2xl ring-1 ring-white/70">
      <div className="flex items-start gap-3 px-5 py-5 sm:px-6 border-b border-slate-100">
        {icon && <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 ring-1 ring-blue-100/70">{icon}</div>}
        <div className="min-w-0 flex-1 pt-0.5"><h2 id={heading} className="text-[17px] font-bold tracking-tight leading-tight">{title}</h2>
          {description && <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>}
        </div>
        <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="-mr-1 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
      {footer && <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
    </section>
  </div>, document.body);
}

export const primaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white shadow-sm shadow-blue-900/10 transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40';
export const secondaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40';
export const fieldClass = 'mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 shadow-xs outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50';
