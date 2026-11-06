// Values travel only through local memory and private CLI stdin to the approved
// Vercel project/Preview branch. Never forward CLI output or decrypted records.
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {recoverPreviewRecord} from './previewRecovery.mjs';
const project='prj_3zLhTBZiE6SUBr05SjmxA57sq4bC',name='hisab-dekhtechai-app';
const scope='ainulhaque-collab',team='team_GtyIJ90B2vhl4tLHJkuyyamQ',branch='codex/verified-service-identity';
let phase='path_validation';
try{
  const [root,shell,cli]=process.argv.slice(2);
  if(!isAbsolute(cli)||!cli.endsWith('vercel/dist/vc.js')&&!cli.endsWith('vercel\\dist\\vc.js'))throw Error();
  const run=(args,input)=>spawnSync(process.execPath,[cli,...args],{cwd:process.cwd(),input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],maxBuffer:2*1024*1024,timeout:60_000});
  phase='cli_identity';const who=run(['whoami','--format','json','--non-interactive']);
  if(who.status!==0)throw Error();const actor=JSON.parse(who.stdout);if(actor.username!==scope||actor.team?.id!==team)throw Error();
  phase='project_identity';const inspected=run(['project','inspect',name,'--scope',scope,'--json','--non-interactive']);
  if(inspected.status!==0)throw Error();const target=JSON.parse(inspected.stdout);if(target.id!==project||target.name!==name||target.owner?.slug!==scope)throw Error();
  phase='recovery';const record=await recoverPreviewRecord(root,shell);
  const databaseUrl=`postgresql://hisab_access_preview.${record.project}:${record.databasePassword}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full`;
  phase='restricted_database_connection';const require=createRequire(join(process.cwd(),'package.json'));const {Pool}=require('pg');
  const checkUrl=new URL(databaseUrl);checkUrl.searchParams.delete('sslmode');
  const ca=await readFile(join(process.cwd(),'config/certificates/supabase-prod-ca-2021.crt'),'utf8');
  const pool=new Pool({connectionString:checkUrl.href,ssl:{rejectUnauthorized:true,ca,servername:checkUrl.hostname},max:1,connectionTimeoutMillis:8000,query_timeout:8000});pool.on('error',()=>{});
  try{const role=(await pool.query('SELECT current_user AS name,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=current_user')).rows[0];
    if(role?.name!=='hisab_access_preview'||role.rolsuper||role.rolbypassrls||role.rolcreatedb||role.rolcreaterole||role.rolinherit)throw Error();
    await pool.query('SELECT provider FROM hisab_access.providers LIMIT 1');
  }finally{await pool.end();}
  const saved=[];
  for(const [key,value] of [['ACCESS_DATABASE_URL',databaseUrl],['AI_VAULT_WRAPPING_KEY',record.wrappingKey]]){
    phase='upload_'+key;
    const args=['env','add',key,'--environment','preview','--git-branch',branch,'--project',project,'--scope',scope,'--sensitive','--force','--yes','--non-interactive','--json'];
    if(args.some(arg=>arg.includes(record.databasePassword)||arg.includes(record.wrappingKey)))throw Error();
    const response=run(args,value);if(response.status!==0)throw Error();saved.push({key,sensitive:true,uploaded:true});
  }
  await writeFile(join(root,'.local-access-preview/secret-upload-receipt.json'),JSON.stringify({project,branch,recoveryVerified:true,databaseTlsVerified:true,databaseRoleVerified:true,saved,createdAt:new Date().toISOString()})+'\n','utf8');
  console.log('PREVIEW_SENSITIVE_SECRETS_UPLOADED_WITHOUT_PLAINTEXT_TOOL_HISTORY');
}catch(error){
  const code=typeof error?.code==='string'&&/^[A-Z0-9_]{2,64}$/.test(error.code)?error.code:'UNSPECIFIED';
  console.error('PREVIEW_SECRET_SETUP_FAILED_AT_'+phase+'_CODE_'+code);process.exitCode=1;
}
