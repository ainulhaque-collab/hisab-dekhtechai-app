import { AIServiceError } from './googleIdentity.js';

export interface AIBudget {
  reserve(ownerHash: string, requestId: string): Promise<void>;
}
export interface AILimits { perMinute: number; perDay: number; globalPerDay: number }
export const DEFAULT_AI_LIMITS: AILimits = { perMinute: 3, perDay: 10, globalPerDay: 100 };

function keysFor(owner: string, request: string, now: number) {
  return [`hisab:ai:v1:owner:${owner}:${Math.floor(now / 60_000)}`,
    `hisab:ai:v1:owner:${owner}:${Math.floor(now / 86_400_000)}`,
    `hisab:ai:v1:global:${Math.floor(now / 86_400_000)}`,
    `hisab:ai:v1:request:${owner}:${request}`];
}

/** Local loopback development only. Runtime configuration forbids it in production. */
export class DevelopmentAIBudget implements AIBudget {
  private values = new Map<string, { value: number; expires: number }>();
  constructor(private limits = DEFAULT_AI_LIMITS, private now = () => Date.now()) {}
  async reserve(owner: string, request: string) {
    const now = this.now();
    for (const [key, value] of this.values) if (value.expires <= now) this.values.delete(key);
    const keys = keysFor(owner, request, now);
    if (this.values.has(keys[3])) throw new AIServiceError('AI_REQUEST_ALREADY_USED', 409);
    const caps = [this.limits.perMinute, this.limits.perDay, this.limits.globalPerDay];
    if (keys.slice(0, 3).some((key, i) => (this.values.get(key)?.value || 0) >= caps[i])) throw new AIServiceError('AI_LIMIT_REACHED', 429);
    if (this.values.size > 10_000) throw new AIServiceError('AI_LIMIT_UNAVAILABLE', 503);
    keys.forEach((key, i) => this.values.set(key, { value: (this.values.get(key)?.value || 0) + 1, expires: now + (i === 0 ? 120_000 : 172_800_000) }));
  }
}

// All quotas + request deduplication are reserved atomically across instances.
// Only hashes, request IDs and counters are stored; never media, drafts or tokens.
const RESERVE_SCRIPT = `
if redis.call('EXISTS', KEYS[4]) == 1 then return 2 end
for i = 1, 3 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then return 1 end
end
for i = 1, 3 do
  redis.call('INCR', KEYS[i])
  redis.call('EXPIRE', KEYS[i], i == 1 and 120 or 172800)
end
redis.call('SET', KEYS[4], '1', 'EX', 172800)
return 0`;

/** Redis REST EVAL transport (e.g. an existing Upstash REST database).
 * Fail closed on storage outage; never silently fall back to per-instance memory. */
export class RedisAIBudget implements AIBudget {
  constructor(private endpoint: string, private token: string, private limits = DEFAULT_AI_LIMITS,
    private fetchFn: typeof fetch = fetch, private now = () => Date.now()) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !token) throw new Error('AI_NOT_CONFIGURED');
  }
  async reserve(owner: string, request: string) {
    try {
      const response = await this.fetchFn(this.endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['EVAL', RESERVE_SCRIPT, 4, ...keysFor(owner, request, this.now()),
          this.limits.perMinute, this.limits.perDay, this.limits.globalPerDay]),
        signal: AbortSignal.timeout(5000), redirect: 'error',
      });
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (body.error || ![0, 1, 2].includes(body.result)) throw new Error();
      if (body.result === 1) throw new AIServiceError('AI_LIMIT_REACHED', 429);
      if (body.result === 2) throw new AIServiceError('AI_REQUEST_ALREADY_USED', 409);
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('AI_LIMIT_UNAVAILABLE', 503);
    }
  }
}
