import { Capacitor, registerPlugin } from '@capacitor/core';
import { ensureMediaPermissions, MediaPermission, MediaPermissionBridge } from './mediaPermissions';

const media = registerPlugin<MediaPermissionBridge>('AIMediaAccess');

/** Permission checks never start the camera or microphone. Gallery uses the system picker. */
export async function requestAIMediaPermissions(permissions: MediaPermission[] = ['camera', 'microphone']) {
  if (!Capacitor.isNativePlatform()) return;
  await ensureMediaPermissions(media, permissions);
}
