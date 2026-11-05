import { contentDatabaseConfig } from '../content/runtime.js';
import { SUPABASE_DATABASE_CA } from './supabaseCA.js';

/** Explicit vendor CA only for Supabase database hosts. Hostname verification
 * remains enabled; other portable PostgreSQL hosts use the normal trusted CAs. */
export function accessDatabaseConfig(value:string){
  const config=contentDatabaseConfig(value),url=new URL(value);
  if(/^(?:[a-z0-9-]+\.)+pooler\.supabase\.com$/.test(url.hostname)||/^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname)){
    config.ssl={rejectUnauthorized:true,ca:SUPABASE_DATABASE_CA,servername:url.hostname};
  }
  return config;
}
