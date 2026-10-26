import { DEFAULT_AI_LIMITS, DevelopmentAIBudget, RedisAIBudget } from './budget';
import { createEntryProvider } from './modelSelection';
import { googleIdentityVerifier } from './googleIdentity';
import { AIHttpOptions } from './http';

/** Server-only config, shared by local Express and the serverless adapter. */
export function aiOptionsFromEnvironment(environment: Record<string, string | undefined>, allowLocalDevelopment = false): AIHttpOptions {
  const origins = (environment.AI_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const clientIds = (environment.GOOGLE_OAUTH_CLIENT_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  const options: AIHttpOptions = { enabled: false, allowedOrigins: new Set(origins), verifyToken: googleIdentityVerifier(clientIds) };
  if (environment.AI_ENABLED !== 'true') return options;
  try {
    if (!clientIds.length || !origins.length || origins.some(origin => {
      const url = new URL(origin);
      return url.origin !== origin || (url.protocol !== 'https:' && !(allowLocalDevelopment && environment.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
    })) return options;
    const positive = (value: string | undefined, fallback: number) => {
      const number = value === undefined || value === '' ? fallback : Number(value);
      if (!Number.isSafeInteger(number) || number < 1 || number > 10_000) throw new Error();
      return number;
    };
    const limits = { perMinute: positive(environment.AI_PER_MINUTE, DEFAULT_AI_LIMITS.perMinute),
      perDay: positive(environment.AI_PER_DAY, DEFAULT_AI_LIMITS.perDay),
      globalPerDay: positive(environment.AI_GLOBAL_PER_DAY, DEFAULT_AI_LIMITS.globalPerDay) };
    options.provider = createEntryProvider(environment);
    if (environment.AI_REDIS_REST_URL && environment.AI_REDIS_REST_TOKEN)
      options.budget = new RedisAIBudget(environment.AI_REDIS_REST_URL, environment.AI_REDIS_REST_TOKEN, limits);
    else if (allowLocalDevelopment && environment.NODE_ENV !== 'production' && environment.AI_LOCAL_DEVELOPMENT === 'true')
      options.budget = new DevelopmentAIBudget(limits);
    else return options;
    options.enabled = true;
  } catch { options.enabled = false; }
  return options;
}
