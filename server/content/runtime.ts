import { Pool,type PoolConfig } from 'pg';
import { contentIdentityVerifier } from './identity.js';
import { PostgresContentStore } from './store.js';
import type { ContentOptions } from './http.js';

export function contentDatabaseConfig(value:string):PoolConfig {
  const url=new URL(value);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.password||!url.pathname.slice(1))throw new Error('CONTENT_NOT_CONFIGURED');
  for(const key of ['sslcert','sslkey','sslrootcert','ssl'])if(url.searchParams.has(key))throw new Error('CONTENT_NOT_CONFIGURED');
  const mode=url.searchParams.get('sslmode');if(mode&&!['require','verify-full'].includes(mode))throw new Error('CONTENT_NOT_CONFIGURED');
  url.searchParams.delete('sslmode');
  return {connectionString:url.toString(),ssl:{rejectUnauthorized:true},max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:10_000,allowExitOnIdle:true,statement_timeout:5000,query_timeout:8000};
}
export function contentOptionsFromEnvironment(env:Record<string,string|undefined>):ContentOptions {
  const options:ContentOptions={enabled:false,allowedOrigins:new Set((env.AI_ALLOWED_ORIGINS||'').split(',').filter(Boolean)),verifyToken:contentIdentityVerifier((env.GOOGLE_OAUTH_CLIENT_IDS||'').split(',').map(value=>value.trim()))};
  if(env.VERCEL_ENV!=='preview'||env.CONTENT_ENABLED!=='true'||!env.CONTENT_DATABASE_URL)return options;
  try{const pool=new Pool(contentDatabaseConfig(env.CONTENT_DATABASE_URL));pool.on('error',()=>{/* Request handlers report a fixed unavailable code only. */});options.store=new PostgresContentStore(pool);options.enabled=true;}catch{}
  return options;
}
