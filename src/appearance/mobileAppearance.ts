export type AppearancePreference = 'system' | 'light' | 'dark';
export const mobileUiEnabled = import.meta.env?.VITE_MOBILE_REDESIGN_ENABLED === 'true';
const storageKey = 'hisab_mobile_appearance_v1';
const listeners = new Set<() => void>();
let preference: AppearancePreference = 'system';
let media: MediaQueryList | undefined;
let started = false;

function valid(value: unknown): AppearancePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function appearanceSnapshot(): string {
  return `${preference}:${preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference}`;
}
function apply() {
  const theme = appearanceSnapshot().split(':')[1];
  document.documentElement.dataset.mobileUi = 'true';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101121' : '#f7f6fc');
  void import('./nativeAppearance').then(module => module.applyNativeAppearance(theme === 'dark')).catch(() => { /* A display bridge failure must not block local records. */ });
  listeners.forEach(listener => listener());
}
/** Device appearance only. Never changes ledger preferences, identity or outbox. */
export function initializeMobileAppearance() {
  if (!mobileUiEnabled || started || typeof window === 'undefined') return;
  started = true;
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
  try { preference = valid(localStorage.getItem(storageKey)); } catch { /* A denied lease must not prevent opening records. */ }
  media = window.matchMedia('(prefers-color-scheme: dark)');
  const changed = () => { if (preference === 'system') apply(); };
  if (typeof media.addEventListener === 'function') media.addEventListener('change', changed);
  else media.addListener(changed);
  window.addEventListener('hisab-foreground', apply);
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) { preference = valid(event.newValue); apply(); }
  });
  apply();
}
export function chooseAppearance(value: AppearancePreference) {
  preference = valid(value);
  try { localStorage.setItem(storageKey, preference); } catch { /* Keep the choice for this session. */ }
  apply();
}
export function subscribeAppearance(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
