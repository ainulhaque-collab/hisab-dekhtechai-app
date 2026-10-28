import { Capacitor } from '@capacitor/core';
import { firebaseWebConfig } from './config';
export interface PushPlatform {
  token(prompt: boolean): Promise<string>;
  remove(): Promise<void>;
  dispose(): void;
}

export async function createPushPlatform(received: () => void, opened: () => void): Promise<PushPlatform> {
  if (Capacitor.isNativePlatform()) {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const handles = await Promise.all([
      PushNotifications.addListener('pushNotificationReceived', () => received()),
      PushNotifications.addListener('pushNotificationActionPerformed', () => opened()),
    ]);
    return {
      async token(prompt) {
        let permission = await PushNotifications.checkPermissions();
        if (permission.receive === 'prompt' && prompt) permission = await PushNotifications.requestPermissions();
        if (permission.receive !== 'granted') throw new Error('PUSH_PERMISSION_DENIED');
        await PushNotifications.createChannel({ id: 'hisab_transactions', name: 'Hisab updates', importance: 3, visibility: 0 });
        return new Promise<string>((resolve, reject) => {
          let finished = false;
          const listeners: { remove(): Promise<void> }[] = [];
          const finish = (token?: string) => {
            if (finished) return; finished = true; clearTimeout(timer);
            void Promise.all(listeners.map(listener => listener.remove()));
            token ? resolve(token) : reject(new Error('PUSH_REGISTRATION_FAILED'));
          };
          const timer = setTimeout(() => finish(), 15000);
          void (async () => {
            try {
              const registered = await PushNotifications.addListener('registration', value => finish(value.value)); listeners.push(registered);
              const failed = await PushNotifications.addListener('registrationError', () => finish()); listeners.push(failed);
              if (!finished) await PushNotifications.register();
              else await Promise.all(listeners.map(listener => listener.remove()));
            } catch { finish(); }
          })();
        });
      },
      async remove() { await PushNotifications.unregister(); await PushNotifications.removeAllDeliveredNotifications(); },
      dispose() { void Promise.all(handles.map(handle => handle.remove())); },
    };
  }
  if (!globalThis.isSecureContext || !('Notification' in globalThis) || !('serviceWorker' in navigator)) throw new Error('PUSH_UNSUPPORTED');
  const [{ initializeApp, getApps }, messagingSDK] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  if (!await messagingSDK.isSupported()) throw new Error('PUSH_UNSUPPORTED');
  const config = firebaseWebConfig();
  const app = getApps().find(value => value.name === 'hisab-notifications') || initializeApp(config, 'hisab-notifications');
  const messaging = messagingSDK.getMessaging(app);
  let worker: ServiceWorkerRegistration | undefined;
  const unlisten = messagingSDK.onMessage(messaging, payload => {
    if (!['transaction', 'test'].includes(payload.data?.kind || '')) return;
    received();
    // The server supplies a generic fixed template, never amounts or notes.
    if (Notification.permission === 'granted' && worker && payload.notification?.body) {
      void worker.showNotification('Hisab DekhteChai', { body: payload.notification.body, tag: payload.data?.event || 'hisab-update',
        data: { url: '/' } }).catch(() => {});
    }
  });
  return {
    async token(prompt) {
      let permission = Notification.permission;
      if (permission === 'default' && prompt) permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('PUSH_PERMISSION_DENIED');
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      if (typeof vapidKey !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(vapidKey)) throw new Error('PUSH_NOT_CONFIGURED');
      worker = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
      worker = await navigator.serviceWorker.ready;
      return messagingSDK.getToken(messaging, { vapidKey, serviceWorkerRegistration: worker });
    },
    async remove() {
      await messagingSDK.deleteToken(messaging);
      const registration = worker || await navigator.serviceWorker.getRegistration('/push-sw.js');
      if (registration) { const notifications = await registration.getNotifications(); notifications.forEach(value => value.close()); }
    },
    dispose() { unlisten(); },
  };
}
