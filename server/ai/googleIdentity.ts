import { createHash } from 'node:crypto';

export class AIServiceError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
export const ownerHashForSubject = (subject: string) => createHash('sha256').update(`hisab-owner:${subject}`).digest('hex');

/** Google access tokens are opaque. Never trust profile/localStorage claims.
 * Introspection is online on every extraction: availability failure denies AI,
 * without affecting the local ledger or requiring a new native login flow. */
export function googleIdentityVerifier(clientIds: string[], fetchFn: typeof fetch = fetch) {
  const allowed = new Set(clientIds.filter(id => /^[\w-]+\.apps\.googleusercontent\.com$/.test(id)));
  return async (token: string): Promise<string> => {
    if (!allowed.size) throw new AIServiceError('AI_NOT_CONFIGURED', 503);
    if (!token || token.length > 4096 || /\s/.test(token)) throw new AIServiceError('AI_AUTH_REQUIRED', 401);
    let response: Response;
    try {
      // Same POST + bearer transport as Google's OAuth2Client.getTokenInfo.
      response = await fetchFn('https://oauth2.googleapis.com/tokeninfo', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        signal: AbortSignal.timeout(8000), redirect: 'error',
      });
    } catch { throw new AIServiceError('AI_AUTH_UNAVAILABLE', 503); }
    if (!response.ok) throw new AIServiceError(response.status === 400 || response.status === 401 ? 'AI_AUTH_REQUIRED' : 'AI_AUTH_UNAVAILABLE', response.status === 400 || response.status === 401 ? 401 : 503);
    let info: Record<string, unknown>;
    try { info = await response.json(); } catch { throw new AIServiceError('AI_AUTH_UNAVAILABLE', 503); }
    if (!info || typeof info !== 'object' || typeof info.sub !== 'string' || !/^\d{1,255}$/.test(info.sub) ||
        typeof info.aud !== 'string' || !allowed.has(info.aud) || typeof info.azp !== 'string' || !allowed.has(info.azp) ||
        !Number.isFinite(Number(info.expires_in)) || Number(info.expires_in) < 30 ||
        !Number.isFinite(Number(info.exp)) || Number(info.exp) * 1000 < Date.now() + 30_000 ||
        typeof info.scope !== 'string' || !info.scope.split(/\s+/).includes('openid'))
      throw new AIServiceError('AI_AUTH_REQUIRED', 401);
    return ownerHashForSubject(info.sub);
  };
}
