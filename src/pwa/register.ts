import { Capacitor } from '@capacitor/core';

export function registerOfflineShell(onUpdate: (registration:ServiceWorkerRegistration)=>void) {
  if(!import.meta.env.PROD || Capacitor.isNativePlatform() || !globalThis.isSecureContext || !('serviceWorker' in navigator)) return ()=>{};
  let disposed = false;
  const notify = (registration:ServiceWorkerRegistration) => {
    if(!disposed && registration.waiting && navigator.serviceWorker.controller) onUpdate(registration);
  };
  void navigator.serviceWorker.register('/push-sw.js',{scope:'/'}).then(registration=>{
    notify(registration);
    registration.addEventListener('updatefound',()=>{
      registration.installing?.addEventListener('statechange',()=>notify(registration));
    });
    void registration.update().catch(()=>{});
  }).catch(()=>{ /* Manual use stays available; never claim offline readiness on failure. */ });
  return ()=>{disposed=true;};
}
