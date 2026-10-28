import { googleIdentityVerifier } from '../ai/googleIdentity.js';
import { RedisPushStore } from './store.js';
import { FCMPushSender, PUSH_WEB_ORIGIN } from './sender.js';
import type { PushHttpOptions } from './http.js';

export function pushOptionsFromEnvironment(env: Record<string, string | undefined>): PushHttpOptions {
  const options: PushHttpOptions = { enabled: false, allowedOrigins: new Set([PUSH_WEB_ORIGIN, 'https://localhost', 'http://localhost:3000']),
    verifyToken: googleIdentityVerifier((env.GOOGLE_OAUTH_CLIENT_IDS || '').split(',').map(value => value.trim())) };
  // IAM is approved only for Preview. Production must fail closed.
  if (env.VERCEL_ENV !== 'preview' || env.PUSH_ENABLED !== 'true') return options;
  try {
    const pair = [[env.AI_REDIS_REST_URL, env.AI_REDIS_REST_TOKEN], [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN], [env.KV_REST_API_URL, env.KV_REST_API_TOKEN]].find(value => value[0] && value[1]);
    if (!pair || !env.GOOGLE_OAUTH_CLIENT_IDS) return options;
    options.store = new RedisPushStore(pair[0]!, pair[1]!); options.sender = new FCMPushSender(); options.enabled = true;
  } catch { /* Missing/invalid configuration never enables an unauthenticated fallback. */ }
  return options;
}
