import { Pool } from 'pg';
import { accessDatabaseConfig } from './database.js';
import { serviceCustomerVerifier } from './identity.js';
import { PostgresAccessStore,type AccessPool } from './store.js';
import { ProviderKeyVault } from './vault.js';
import type { AccessOptions } from './http.js';
import { createEntryProvider } from '../ai/modelSelection.js';
import type { EntryExtractionProvider } from '../ai/provider.js';

/** Refuse an accidentally supplied shared project-owner/service database login. */
function restrictedPool(pool:Pool):AccessPool{return {connect:async()=>{
  const client=await pool.connect();
  try{const role=(await client.query('SELECT current_user AS name,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=current_user')).rows[0];
    if(role?.name!=='hisab_access_preview'||role.rolsuper||role.rolbypassrls||role.rolcreatedb||role.rolcreaterole||role.rolinherit)throw Error();
    return client;
  }catch{client.release();throw Error('ACCESS_DATABASE_ROLE_REQUIRED');}
}};}

export function accessOptionsFromEnvironment(env:Record<string,string|undefined>,allowLocalDevelopment=false):AccessOptions{
  const allowedOrigins=new Set((env.AI_ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean));
  const options:AccessOptions={enabled:false,allowedOrigins};
  if(env.ACCESS_ENABLED!=='true'||!(env.VERCEL_ENV==='preview'||allowLocalDevelopment&&env.NODE_ENV!=='production'&&env.ACCESS_LOCAL_DEVELOPMENT==='true'))return options;
  try{
    if(!allowedOrigins.size||[...allowedOrigins].some(origin=>{const url=new URL(origin);return url.origin!==origin||url.protocol!=='https:'&&!(allowLocalDevelopment&&env.NODE_ENV!=='production'&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname));}))return options;
    const verify=serviceCustomerVerifier(env.SUPABASE_URL||'',env.SUPABASE_PUBLISHABLE_KEY||'');
    const pool=new Pool(accessDatabaseConfig(env.ACCESS_DATABASE_URL||''));pool.on('error',()=>{});
    options.store=new PostgresAccessStore(restrictedPool(pool),env.ACCESS_ADMIN_CUSTOMER_ID||'',new ProviderKeyVault(env.AI_VAULT_WRAPPING_KEY||''));
    options.verify=verify;options.enabled=true;
  }catch{/* Configuration and database credentials never become diagnostics. */}
  return options;
}

/** Read the current revision on every operation. Rotation/disable takes effect
 * on the next request; there is no fallback to an old environment key. */
export function managedEntryProvider(store:PostgresAccessStore):EntryExtractionProvider{
  let cached:{revision:number;provider:EntryExtractionProvider}|undefined;
  const current=async()=>{const config=await store.providerConfiguration();if(!cached||cached.revision!==config.revision)cached={revision:config.revision,provider:createEntryProvider({AI_PROVIDER:'gemini',GEMINI_API_KEY:config.apiKey,GEMINI_MODEL:config.model})};return cached.provider;};
  return {provider:'gemini',extract:async input=>(await current()).extract(input),guide:async input=>{const provider=await current();if(!provider.guide)throw Error('AI_NOT_CONFIGURED');return provider.guide(input);}};
}
