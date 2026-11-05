import {readFile} from 'node:fs/promises';
import {loadEnv} from 'vite';
const plan=JSON.parse(await readFile(new URL('../config/native-ai-preview.plan.json',import.meta.url),'utf8'));
const requested=process.argv[process.argv.indexOf('--ai-origin')+1];
if(requested!==plan.apiOrigin)throw Error('MANAGED_AI_REQUIRES_REVIEWED_PREVIEW_ORIGIN');
const env=loadEnv('production',process.cwd(),'VITE_');
const origin=process.env.VITE_SUPABASE_URL??env.VITE_SUPABASE_URL;
const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY??env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(origin!==plan.authOrigin||!key?.startsWith('sb_publishable_')||key.length<25)throw Error('MANAGED_AI_PUBLIC_AUTH_CONFIGURATION_REQUIRED');
// Only validated public Auth configuration. Never emit process.env or a secret.
process.stdout.write(JSON.stringify({VITE_SUPABASE_AUTH_ENABLED:'true',VITE_CUSTOMER_ACCESS_ENABLED:'true',VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:key}));
