import { RefObject, useEffect, useRef } from 'react';
const dialogs: symbol[] = [];
let previousOverflow = '';
/** Only the top dialog consumes Back/Escape. Nested pickers preserve their parent form. */
export function useDialog(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const token = Symbol();
    const previousFocus = document.activeElement as HTMLElement | null;
    if (!dialogs.length) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    dialogs.push(token);
    const top = () => dialogs[dialogs.length - 1] === token;
    const back = (e: Event) => { if (top()) { e.preventDefault(); e.stopImmediatePropagation(); close.current(); } };
    const keyboard = (e: KeyboardEvent) => {
      if (!top()) return;
      if (e.key === 'Escape') back(e);
      if (e.key === 'Tab') {
        const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex="0"]') || []);
        if (!nodes.length) return;
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        e.preventDefault(); nodes[(index + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus();
      }
    };
    const initialFocus = panel.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]') ||
      panel.current?.querySelector<HTMLElement>('[aria-selected="true"]') ||
      panel.current?.querySelector<HTMLElement>('input:not(:disabled)') || panel.current?.querySelector<HTMLElement>('button:not(:disabled)');
    initialFocus?.focus();
    window.addEventListener('hisab-back', back);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      const index = dialogs.indexOf(token); if (index >= 0) dialogs.splice(index, 1);
      window.removeEventListener('hisab-back', back); document.removeEventListener('keydown', keyboard, true);
      if (!dialogs.length) document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open, panel]);
}
