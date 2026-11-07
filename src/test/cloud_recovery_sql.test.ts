import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {generateUUID} from '../domain/journal';
import {encodeBackup} from '../storage/backup';
import {computeSha256} from '../sync/canonical';

test('recovery SQL: owner/anonymous isolation, checksum, immutable generations, retention and rollback',async t=>{
  const db=new PGlite();t.after(()=>db.close());await db.exec("set hisab.bootstrap_mode='isolated-stock'");
  await db.exec(await readFile(new URL('../../db/adapters/stock-postgres.sql',import.meta.url),'utf8'));
  const sql=await readFile(new URL('../../server/recovery/001_snapshots.sql',import.meta.url),'utf8');
  assert.equal(sql,await readFile(new URL('../../supabase/migrations/20261107051223_hisab_recovery_snapshots.sql',import.meta.url),'utf8'));await db.exec(sql);
  const owner=generateUUID(),foreign=generateUUID(),dataset=generateUUID(),device=generateUUID();await db.query('insert into auth.users(id) values($1),($2)',[owner,foreign]);
  const actor=async<T>(who:string,work:()=>Promise<T>,role='authenticated')=>{await db.exec('begin');try{await db.exec(`set local role ${role}`);await db.query("select set_config('hisab.actor_id',$1,true)",[who]);const result=await work();await db.exec('commit');return result;}catch(e){await db.exec('rollback');throw e;}};
  const call=async(name:string,args:unknown[]=[])=>{const slots=args.map((_,i)=>'$'+(i+1)).join(',');return (await db.query<{result:any}>(`select public.hisab_recovery_${name}(${slots}) as result`,args)).rows[0].result;};
  const text=await encodeBackup({schemaVersion:6,localIdentity:null,workspaces:[],accounts:[],journalTransactions:[],journalLines:[]}),hash=await computeSha256(text);
  const row=await actor(owner,()=>call('put',[dataset,device,text,hash]));assert.ok(row.id);assert.equal(row.backup_text,undefined);
  assert.equal((await actor(owner,()=>call('put',[dataset,device,text,hash]))).id,row.id);
  assert.equal((await actor(owner,()=>call('get',[row.id]))).backup_text,text);
  assert.deepEqual(await actor(foreign,()=>call('list')),[]);assert.equal(await actor(foreign,()=>call('get',[row.id])),null);
  await assert.rejects(actor('',()=>call('list'), 'anon'),/permission denied/);
  await assert.rejects(actor(owner,()=>call('put',[dataset,device,text,'0'.repeat(64)])),/RECOVERY_CHECKSUM/);
  const malformed=JSON.stringify({format:'hisab-backup',version:1});await assert.rejects(actor(owner,async()=>call('put',[dataset,device,malformed,await computeSha256(malformed)])),/RECOVERY_FORMAT/);
  await assert.rejects(actor(foreign,()=>db.query('insert into hisab_recovery.snapshots(owner_id,dataset_id,device_id,sha256,backup_text) values($1,$2,$3,$4,$5)',[owner,dataset,device,hash,text])),/row-level security/);
  await assert.rejects(actor(owner,()=>db.query('update hisab_recovery.snapshots set backup_text=$1 where id=$2',[text,row.id])),/permission denied/);
  for(let i=0;i<4;i++){const next=await encodeBackup({schemaVersion:6,marker:i});await actor(owner,async()=>call('put',[dataset,device,next,await computeSha256(next)]));}
  assert.equal((await actor(owner,()=>call('list'))).length,3);assert.equal(await actor(owner,()=>call('get',[row.id])),null);
  assert.equal((await db.query<{n:string}>('select count(*)::text as n from hisab_recovery.snapshots')).rows[0].n,'3');
});
