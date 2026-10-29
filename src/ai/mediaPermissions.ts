export type MediaPermission = 'camera' | 'microphone';
export interface MediaPermissionBridge {
  checkPermissions(): Promise<unknown>;
  requestPermissions(options: { permissions: MediaPermission[] }): Promise<unknown>;
}
const states = new Set(['granted', 'denied', 'prompt', 'prompt-with-rationale']);

function snapshot(value: unknown, requested: MediaPermission[]) {
  if (!value || typeof value !== 'object' || requested.some(key => !states.has((value as Record<string, string>)[key])))
    throw new Error('AI_MEDIA_PERMISSION_UNAVAILABLE');
  return value as Record<MediaPermission, string>;
}

/** Never treat a missing bridge response as permission, or as a provider outage. */
export async function ensureMediaPermissions(bridge: MediaPermissionBridge, requested: MediaPermission[]) {
  let current: Record<MediaPermission, string>;
  try { current = snapshot(await bridge.checkPermissions(), requested); }
  catch { throw new Error('AI_MEDIA_PERMISSION_UNAVAILABLE'); }
  const missing = requested.filter(key => current[key] !== 'granted');
  if (!missing.length) return;
  if (missing.some(key => current[key] === 'denied')) throw new Error('AI_MEDIA_PERMISSION_DENIED');
  let result: Record<MediaPermission, string>;
  try { result = snapshot(await bridge.requestPermissions({ permissions: missing }), requested); }
  catch { throw new Error('AI_MEDIA_PERMISSION_UNAVAILABLE'); }
  if (requested.some(key => result[key] !== 'granted')) throw new Error('AI_MEDIA_PERMISSION_DENIED');
}
