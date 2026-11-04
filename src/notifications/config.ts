import expected from '../../config/firebase-notifications.json';

export function firebaseWebConfig(raw = import.meta.env?.VITE_FIREBASE_WEB_CONFIG) {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || value.projectId !== expected.projectId || value.appId !== expected.webAppId || value.messagingSenderId !== expected.senderId ||
      typeof value.apiKey !== 'string' || !/^AIza[\w-]{35}$/.test(value.apiKey) ||
      Object.keys(value).some(key => !['apiKey', 'projectId', 'appId', 'messagingSenderId'].includes(key))) throw new Error();
    return value as { apiKey: string; projectId: string; appId: string; messagingSenderId: string };
  } catch { throw new Error('PUSH_NOT_CONFIGURED'); }
}

export function pushEndpoint(base: string, pageOrigin: string, native: boolean) {
  if (native && !base) throw new Error('PUSH_NOT_CONFIGURED');
  const url = new URL(base || pageOrigin);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost' && !native)) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('PUSH_NOT_CONFIGURED');
  return `${url.origin}/api/notifications/push`;
}
