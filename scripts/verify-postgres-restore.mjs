// Native CI-only roundtrip. Refuses remote/non-test URLs and never drops a database.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
const url = new URL(process.env.HISAB_TEST_PG_URL || 'http://invalid');
const container = process.env.HISAB_TEST_PG_CONTAINER || '';
if (process.env.HISAB_SQL_TEST_MODE !== 'isolated' || !['127.0.0.1','localhost'].includes(url.hostname) ||
    url.pathname !== '/hisab_contract_test' || !/^[0-9a-f]{12,64}$/.test(container)) throw Error('ISOLATED_NATIVE_TEST_REQUIRED');
const source = new Client({connectionString:url.href}); await source.connect();
const targetUrl = new URL(url); targetUrl.pathname='/hisab_contract_restored_test';
let target;
const docker = (args, input) => {
  const result = spawnSync('docker',['exec',...(input ? ['-i'] : []),container,...args],{input,maxBuffer:16*1024*1024});
  if (result.status !== 0) throw Error(`ISOLATED_POSTGRES_TOOL_FAILED: ${result.stderr?.toString().slice(0,500)}`);
  return result.stdout;
};
const snapshot = async client => {
  const tables=(await client.query("select tablename from pg_tables where schemaname='hisab_cloud' order by tablename")).rows;
  const result={};
  for (const {tablename} of tables) {
    if (!/^[a-z_]+$/.test(tablename)) throw Error('BAD_TEST_TABLE');
    result[tablename]=(await client.query(`select count(*)::text as rows,md5(coalesce(string_agg((to_jsonb(t)-'creation_tx')::text,'|' order by id),'')) as fingerprint from hisab_cloud.${tablename} t`)).rows[0];
  }
  return result;
};
try {
  const before=await snapshot(source);
  const principals=(await source.query('select id from auth.users where id in(select id from hisab_cloud.profiles union select owner_id from hisab_cloud.workspaces)')).rows;
  const archive=docker(['pg_dump','-U','postgres','-d','hisab_contract_test','--format=custom','--schema=hisab_cloud','--schema=hisab_internal','--no-owner']);
  await source.query('create database hisab_contract_restored_test');
  target=new Client({connectionString:targetUrl.href}); await target.connect();
  await target.query("set hisab.bootstrap_mode='isolated-stock'");
  await target.query(await readFile(new URL('../db/adapters/stock-postgres.sql',import.meta.url),'utf8'));
  for(const principal of principals) await target.query('insert into auth.users(id) values($1)',[principal.id]);
  const restore = section => docker(['pg_restore','-U','postgres','-d','hisab_contract_restored_test','--no-owner','--exit-on-error',`--section=${section}`],archive);
  restore('pre-data'); restore('data');
  // Source-cluster transaction IDs must never authorize late inserts on a restored cluster.
  // Run before restoring immutable triggers; money/journal payloads stay byte-for-byte equivalent.
  await target.query('update hisab_cloud.journal_transactions set creation_tx=-1');
  restore('post-data');
  assert.deepEqual(await snapshot(target),before);
  assert.equal((await target.query("select to_regclass('public.deshpath_preservation_fixture') as foreign_table")).rows[0].foreign_table,null);
  const old=(await target.query('select t.id,t.owner_id,t.workspace_id,l.account_id from hisab_cloud.journal_transactions t join hisab_cloud.journal_lines l on l.transaction_id=t.id limit 1')).rows[0];
  await target.query('begin');
  try {
    await target.query('set local role authenticated');
    await target.query("select set_config('hisab.actor_id',$1,true)",[old.owner_id]);
    await assert.rejects(target.query('insert into hisab_cloud.journal_lines(id,owner_id,workspace_id,transaction_id,account_id,debit_minor,credit_minor) values(gen_random_uuid(),$1,$2,$3,$4,1,0)',[old.owner_id,old.workspace_id,old.id,old.account_id]),/HISAB_JOURNAL_IMMUTABLE/);
  } finally { await target.query('rollback'); }
  for(const principal of principals) {
    await target.query('begin');
    try {
      await target.query('set local role authenticated');
      await target.query("select set_config('hisab.actor_id',$1,true)",[principal.id]);
      const rows=(await target.query('select id,owner_id from hisab_cloud.workspaces')).rows;
      assert.ok(rows.length>0 && rows.every(row=>row.owner_id===principal.id));
      await target.query('select hisab_internal.validate_journal(id) from hisab_cloud.journal_transactions');
    } finally { await target.query('rollback'); }
  }
  const accounts=(await target.query('select id,classification,system_code from hisab_cloud.accounts where owner_id=$1 and workspace_id=$2',[old.owner_id,old.workspace_id])).rows;
  const cash=accounts.find(row=>row.classification==='asset'), revenue=accounts.find(row=>row.system_code==='revenue_clearing');
  const category=(await target.query("select id from hisab_cloud.categories where workspace_id=$1 and kind='income' limit 1",[old.workspace_id])).rows[0];
  const operation=randomUUID(), transaction=randomUUID(), device=randomUUID();
  const lines=JSON.stringify([{id:randomUUID(),accountId:cash.id,debitMinor:'100',creditMinor:'0'},
    {id:randomUUID(),accountId:revenue.id,categoryId:category.id,debitMinor:'0',creditMinor:'100'}]);
  await target.query('begin');
  try {
    await target.query('set local role authenticated');
    await target.query("select set_config('hisab.actor_id',$1,true)",[old.owner_id]);
    const args=[old.workspace_id,operation,transaction,device,lines];
    const sql="select hisab_cloud.post_journal($1,$2,$3,$4,'income','2026-11-04','2026-11-04T08:00:00Z',$5::jsonb) as result";
    assert.equal((await target.query(sql,args)).rows[0].result.replayed,false);
    assert.equal((await target.query(sql,args)).rows[0].result.replayed,true);
    await target.query('commit');
  } catch(error) { await target.query('rollback'); throw error; }
  await mkdir(new URL('../build/pr2/',import.meta.url),{recursive:true});
  await writeFile(new URL('../build/pr2/native-restore-evidence.json',import.meta.url),JSON.stringify({result:'PASS',engine:'native PostgreSQL 17',tables:Object.keys(before).length,financeFingerprintsMatched:true,oldTransactionMarkersSealed:true,twoOwnerRlsAfterRestore:true,newPostAndReplayAfterRestore:true,unrelatedTablesExcluded:true},null,2));
  console.log('NATIVE_PG_DUMP_RESTORE_PASS: finance fingerprints, sealed history, RLS and scoped export');
} finally { if(target) await target.end(); await source.end(); }
