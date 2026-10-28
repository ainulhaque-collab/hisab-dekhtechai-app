/// <reference lib="webworker" />
import { initializeApp } from 'firebase/app';
import { getMessaging } from 'firebase/messaging/sw';
import { firebaseWebConfig } from './config';
declare const self: ServiceWorkerGlobalScope;

// This worker is bundled locally; no runtime importScripts/CDN dependencies.
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
self.addEventListener('install', () => { void self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
getMessaging(initializeApp(firebaseWebConfig()));
