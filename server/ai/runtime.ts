import { DEFAULT_AI_LIMITS, DevelopmentAIBudget, RedisAIBudget } from './budget.js';
import { createEntryProvider } from './modelSelection.js';
import { googleIdentityVerifier } from './googleIdentity.js';
import type { AIHttpOptions } from './http.js';
import { accessOptionsFromEnvironment,managedEntryProvider } from '../access/runtime.js';
import { AccessError } from '../access/identity.js';
import { AIServiceError } from './googleIdentity.js';

/** Server-only config, shared by local Express and the serverless adapter. */
export function aiOptionsFromEnvironment(environment: Record<string, string | undefined>, allowLocalDevelopment = false): AIHttpOptions {
  const origins = (environment.AI_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const clientIds = (environment.GOOGLE_OAUTH_CLIENT_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  const options: AIHttpOptions = { enabled: false, allowedOrigins: new Set(origins), verifyToken: googleIdentityVerifier(clientIds) };
  if (environment.AI_ENABLED !== 'true') return options;
  try {
    const customerMode=environment.AI_AUTH_MODE==='supabase';
    if (environment.AI_AUTH_MODE&&!['google','supabase'].includes(environment.AI_AUTH_MODE))return options;
    if (!customerMode&&!clientIds.length || !origins.length || origins.some(origin => {
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
    if(customerMode){
      const access=accessOptionsFromEnvironment(environment,allowLocalDevelopment);
      if(!access.enabled||!access.store||!access.verify)return options;
      options.provider=managedEntryProvider(access.store);
      options.verifyCustomer=async token=>{
        const convert=(error:unknown):never=>{if(error instanceof AccessError)throw new AIServiceError(error.code.startsWith('AI_')?error.code:error.status===401?'AI_AUTH_REQUIRED':'AI_AUTH_UNAVAILABLE',error.status);throw new AIServiceError('AI_AUTH_UNAVAILABLE',503);};
        let customer;try{customer=await access.verify!(token);}catch(error){return convert(error);}
        return {owner:customer.ownerHash,assertAccess:async()=>{try{await access.store!.requireActive(customer);}catch(error){convert(error);}}};
      };
    }else{
      // Never permit the new access backend to be bypassed through legacy auth.
      if(environment.ACCESS_ENABLED==='true')return options;
      options.provider=createEntryProvider(environment);
    }
    // Marketplace names are accepted as complete pairs; never mix URL/token sources.
    const redis = [
      [environment.AI_REDIS_REST_URL, environment.AI_REDIS_REST_TOKEN],
      [environment.UPSTASH_REDIS_REST_URL, environment.UPSTASH_REDIS_REST_TOKEN],
      [environment.KV_REST_API_URL, environment.KV_REST_API_TOKEN],
    ].find(pair => pair[0] && pair[1]);
    if (redis)
      options.budget = new RedisAIBudget(redis[0]!, redis[1]!, limits);
    else if (allowLocalDevelopment && environment.NODE_ENV !== 'production' && environment.AI_LOCAL_DEVELOPMENT === 'true')
      options.budget = new DevelopmentAIBudget(limits);
    else return options;
    options.enabled = true;
  } catch { options.enabled = false; }
  return options;
}
