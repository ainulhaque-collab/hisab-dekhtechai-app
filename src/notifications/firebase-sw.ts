/// <reference lib="webworker" />
import { initializeApp } from 'firebase/app';
import { getMessaging } from 'firebase/messaging/sw';
import { firebaseWebConfig } from './config';
import { isShellRequest, shellResponse,isVersionedShellAsset } from '../pwa/offlineShell';
declare const self: ServiceWorkerGlobalScope;
declare const __OFFLINE_SHELL__: {version:string;assets:string[]};
const cacheName = `hisab-shell-${__OFFLINE_SHELL__.version}`;
const assets = new Set(__OFFLINE_SHELL__.assets);

// This worker is bundled into one classic IIFE; no module-worker, shared chunks,
// runtime importScripts or CDN dependencies are required by the browser.
// Install a click handler before Firebase so foreground-created notifications
// also return to this origin. Never follow a URL from untrusted push data.
self.addEventListener('notificationclick', event => {
  event.stopImmediatePropagation(); event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin) as WindowClient | undefined;
    if (existing) await existing.focus(); else await self.clients.openWindow('/');
  })());
});
self.addEventListener('install', event => {
  if(!assets.size) return;
  event.waitUntil((async()=>{
    const cache = await caches.open(cacheName);
    try {
      for(const path of assets) {
        const response = await fetch(new Request(path,{cache:'reload',credentials:'same-origin',redirect:'error'}));
        if(!response.ok || response.redirected || response.type === 'opaque') throw new Error('SHELL_FETCH_FAILED');
        if(path === '/index.html' && !(await response.clone().text()).includes('id="hisab-app-shell"')) throw new Error('SHELL_INVALID');
        await cache.put(path,response);
      }
    } catch(error) { await caches.delete(cacheName); throw error; }
  })());
});
self.addEventListener('message', event=>{
  if(event.data?.type === 'ACTIVATE_UPDATE' && event.source && 'url' in event.source && new URL(event.source.url).origin === self.location.origin) void self.skipWaiting();
});
self.addEventListener('activate', event => event.waitUntil((async()=>{
  // Keep one previous shell so existing tabs can still resolve their old chunks.
  const old = (await caches.keys()).filter(key=>key.startsWith('hisab-shell-') && key!==cacheName);
  await Promise.all(old.slice(0,-1).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event=>{
  if(isShellRequest(event.request,self.location.origin,assets)) event.respondWith(caches.open(cacheName).then(cache=>shellResponse(event.request,cache)));
  else if(isVersionedShellAsset(event.request,self.location.origin)) event.respondWith((async()=>{
    const previous=(await caches.keys()).filter(key=>key.startsWith('hisab-shell-')&&key!==cacheName).at(-1);
    if(previous){const cached=await(await caches.open(previous)).match(event.request);if(cached)return cached;}
    return fetch(event.request);
  })());
});
try { getMessaging(initializeApp(firebaseWebConfig())); } catch { /* Offline shell also works before push is configured. */ }
