import { Capacitor, registerPlugin } from '@capacitor/core';

interface MediaPermissions {
  checkPermissions(): Promise<{ camera: string; microphone: string }>;
  requestPermissions(options: { permissions: string[] }): Promise<{ camera: string; microphone: string }>;
}
const media = registerPlugin<MediaPermissions>('AIMediaAccess');

/** Permission checks never start the camera or microphone. Gallery uses the system picker. */
export async function requestAIMediaPermissions(permissions = ['camera', 'microphone']) {
  if (!Capacitor.isNativePlatform()) return;
  const current = await media.checkPermissions();
  const missing = permissions.filter(key => current[key as keyof typeof current] !== 'granted');
  const result = missing.length ? await media.requestPermissions({ permissions: missing }) : current;
  if (permissions.some(key => result[key as keyof typeof result] !== 'granted')) throw new Error('AI_MEDIA_PERMISSION_DENIED');
}
