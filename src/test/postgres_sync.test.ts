import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdtemp,unlink,rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { LocalDatabase } from '../storage/db';
import { SyncTestSqliteDriver } from './helpers/syncSqliteDriver';
import { DatabaseSyncStore } from '../sync/postgres/localStore';
import { PostgresSyncEngine } from '../sync/postgres/engine';
import { PostgresSyncProvider,jsonSyncTransport } from '../sync/postgres/provider';
import { operationDigest,wireJson } from '../sync/postgres/wire';
import { generateUUID,buildIncomeJournal,buildExpenseJournal } from '../domain/journal';
import { computeSha256,canonicalJson } from '../sync/canonical';
import type { SyncOperation } from '../contracts/types';
import type { FinancialSyncOperation,SyncScope,PushRequest } from '../contracts/financialSync';

const native=process.env.HISAB_TEST_PG_URL;
if(native){const u=new URL(native);if(process.env.HISAB_SQL_TEST_MODE!=='isolated'||!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/hisab_contract_test')throw Error('ISOLATED_DATABASE_REQUIRED');}
const file=(p:string)=>readFile(new URL('../../'+p,import.meta.url),'utf8');
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}

test(`Postgres outbox pipeline over HTTP + real SQLite files (${native?'native PG17':'PostgreSQL WASM'})`,async t=>{
  const sql:any=native?new (await import('pg')).Client({connectionString:native}):new (await import('@electric-sql/pglite')).PGlite();
  if(native)await sql.connect();
  const exec=(s:string)=>native?sql.query(s):sql.exec(s);
  if(!native){await exec("set hisab.bootstrap_mode='isolated-stock'");await exec(await file('db/adapters/stock-postgres.sql'));
    await exec(await file('supabase/migrations/20261029152851_hisab_cloud_foundation.sql'));
    await exec(await file('supabase/migrations/20261104104123_hisab_portable_money_media.sql'));}
  const {readdir}=await import('node:fs/promises');
  const migration=(await readdir(new URL('../../supabase/migrations/',import.meta.url))).find(n=>n.endsWith('_hisab_durable_sync_log.sql'))!;
  await exec(await file('supabase/migrations/'+migration));
  const owner=generateUUID(),foreignOwner=generateUUID();await sql.query('insert into auth.users(id) values($1),($2)',[owner,foreignOwner]);
  let serial:Promise<unknown>=Promise.resolve();
  const asActor=async(actor:string,method:string,request:any,external?:any)=>{
    if(!['sync_push','sync_pull'].includes(method))throw Error('METHOD_DENIED');
    const run=async()=>{const c:any=external??(native?new (await import('pg')).Client({connectionString:native}):sql);
      if(native&&!external)await c.connect();await c.query('begin');
      try{await c.query('set local role authenticated');await c.query("select set_config('hisab.actor_id',$1,true),set_config('request.jwt.claim.sub',$1,true)",[actor]);
        const result=(await c.query(`select hisab_cloud.${method}($1::jsonb) as reply`,[JSON.stringify(request)])).rows[0].reply;
        await c.query('commit');return result;
      }catch(error){await c.query('rollback');throw error;}finally{if(native&&!external)await c.end();}
    };
    if(native||external)return run();const result=serial.catch(()=>{}).then(run);serial=result;return result;
  };
  let loseNextPush=false,offline=false,calls=0,hold:ReturnType<typeof deferred>|null=null,reached=deferred();
  const server=createServer(async(req,res)=>{
    try{
      const actor=req.headers.authorization==='Bearer SYNTHETIC_OWNER_A'?owner:req.headers.authorization==='Bearer SYNTHETIC_OWNER_B'?foreignOwner:null;
      if(!actor){res.writeHead(401,{'Content-Type':'application/json'}).end('{"error":"UNAUTHORIZED"}');return;}
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1048576)throw Error('BODY_TOO_LARGE');}
      const {method,request}=JSON.parse(body);calls++;
      const result=await asActor(actor,method,request);
      if(method==='sync_push'&&loseNextPush){loseNextPush=false;req.socket.destroy();return;}
      if(hold){reached.resolve();await hold.promise;hold=null;}
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
    }catch{res.writeHead(403,{'Content-Type':'application/json'}).end('{"error":"SYNC_DENIED"}');}
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const endpoint=`http://127.0.0.1:${(server.address() as any).port}/`;
  const authenticated:typeof fetch=(url,init)=>{if(offline)return Promise.reject(Error('SYNTHETIC_OFFLINE'));return fetch(url,{...init,headers:{...init?.headers,Authorization:'Bearer SYNTHETIC_OWNER_A'}});};
  const provider=new PostgresSyncProvider(jsonSyncTransport(endpoint,authenticated));
  const folder=await mkdtemp(join(tmpdir(),'hisab-sync-'));
  const clients:{db:LocalDatabase;driver:SyncTestSqliteDriver;store:DatabaseSyncStore;path:string}[]=[];
  const makeClient=async(name:string,device=generateUUID())=>{const path=join(folder,name+'.sqlite'),driver=new SyncTestSqliteDriver(path),db=new LocalDatabase(name,driver);await db.init();db.setIdentity(owner,'Synthetic verified UUID');db.setDeviceIdentity(device,name);const value={db,driver,store:new DatabaseSyncStore(db),path};clients.push(value);return value;};
  const a=await makeClient('a'),b=await makeClient('b');
  const ws=a.db.createWorkspace('সিন্থেটিক পরীক্ষা 😀','personal'),cash=a.db.createAccount(ws.id,'Synthetic cash','cash','0');
  const income=a.db.createCategory(ws.id,'Synthetic income','income'),food=a.db.createCategory(ws.id,'Synthetic food','expense');
  let clock=10000,identity:string|null=owner,issuer='synthetic-test-only';
  const scope=(client:typeof a):SyncScope=>({ownerId:owner,workspaceId:ws.id,deviceId:client.db.getDeviceId()});
  const engine=(client:typeof a)=>new PostgresSyncEngine({store:client.store,provider,authIssuer:'synthetic-test-only',scope:scope(client),online:()=>!offline,now:()=>clock,auth:{getVerifiedIdentity:async()=>identity?{subject:identity,issuer}:null,signOut:async()=>{identity=null;}}});
  let ea=engine(a),eb=engine(b);
  const post=async(client:typeof a,kind:'income'|'expense',amount:string,transactionId?:string)=>{
    const opId=generateUUID();const j=kind==='income'?buildIncomeJournal({workspaceId:ws.id,assetAccountId:cash.id,revenueCategoryId:income.id,amountMinor:amount,effectiveDate:'2026-11-04',opId,transactionId,note:'বাংলা "নোট"\n😀'}):
      buildExpenseJournal({workspaceId:ws.id,assetAccountId:cash.id,expenseCategoryId:food.id,amountMinor:amount,effectiveDate:'2026-11-04',opId,transactionId});
    const payload={balancedJournal:j};const op:SyncOperation={protocolVersion:1,ownerHash:owner,deviceId:client.db.getDeviceId(),seq:client.db.getNextDeviceSeq(),operationId:opId,entityId:j.transaction.id,type:'journal.post',createdAtUtc:new Date().toISOString(),payload,contentSha256:await computeSha256(canonicalJson(payload))};
    await client.db.commitJournalWithOutbox(j,op);return j.transaction.id;
  };
  t.after(async()=>{hold?.resolve();for(const c of clients){try{c.driver.close();}catch{}}
    for(const path of new Set(clients.map(c=>c.path)))await unlink(path).catch(()=>{});await rmdir(folder);
    await new Promise<void>(r=>server.close(()=>r()));if(native)await sql.end();else await sql.close();});

  await t.test('offline save survives SQLite reopen, without a network call or losing pending operations',async()=>{
    offline=true;const tx=await post(a,'income','12080');const before=calls;
    assert.equal((await ea.run()).state,'offline');assert.equal(calls,before);
    const pending=a.db.getPendingOutbox().length;a.driver.close();
    a.driver=new SyncTestSqliteDriver(a.path);a.db=new LocalDatabase('a',a.driver);await a.db.init();a.store=new DatabaseSyncStore(a.db);ea=engine(a);
    assert.equal(a.db.getTransaction(tx)?.lines[0].debitMinor,'12080');assert.equal(a.db.getPendingOutbox().length,pending);
    offline=false;
  });
  await t.test('SHA-256 canonical envelope agrees between Web Crypto and PostgreSQL for Unicode and strings',async()=>{
    const operations=await a.store.readPending(scope(a),100);
    for(const op of operations){const {contentSha256,...body}=op;
      const pg=(await sql.query("select encode(sha256(convert_to(hisab_internal.wire_json($1::jsonb),'UTF8')),'hex') as digest",[JSON.stringify(body)])).rows[0].digest;
      assert.equal(pg,contentSha256);}
  });
  await t.test('queued metadata is an immutable snapshot and unsupported updates remain pending',async()=>{
    const c=await makeClient('metadata'),w=c.db.createWorkspace('Snapshot','personal'),account=c.db.createAccount(w.id,'Original','cash');
    const category=c.db.createCategory(w.id,'Original category','expense');
    c.db.updateAccount(account.id,{name:'Changed'});c.db.editCategory(category.id,'Changed category');
    const ops=await c.store.readPending({ownerId:owner,workspaceId:w.id,deviceId:c.db.getDeviceId()},100);
    assert.equal((ops.find(op=>op.type==='account.create')?.payload.account as any).name,'Original');
    assert.equal((ops.find(op=>op.type==='category.create')?.payload.category as any).name,'Original category');
    assert.ok(ops.some(op=>op.type==='account.update'));
    assert.equal(c.store.pendingCount({ownerId:owner,workspaceId:w.id,deviceId:c.db.getDeviceId()}),4);
    const cs={ownerId:owner,workspaceId:w.id,deviceId:c.db.getDeviceId()};
    const e=new PostgresSyncEngine({store:c.store,provider,authIssuer:'synthetic-test-only',scope:cs,online:()=>true,auth:{getVerifiedIdentity:async()=>({subject:owner,issuer:'synthetic-test-only'}),signOut:async()=>{}}});
    assert.equal((await e.run()).state,'blocked');assert.equal(c.store.pendingCount(cs),1);
    c.db.queueSyncOp('receipt.attach',generateUUID(),{});
    await assert.rejects(c.store.readPending(cs,100),/SYNC_LOCAL_MAPPING_REQUIRED/);
  });
  await t.test('A → PostgreSQL → B and B → PostgreSQL → A preserve exact journals and balance',async()=>{
    assert.equal((await ea.run()).state,'caught_up');assert.equal(a.store.pendingCount(scope(a)),0);
    assert.equal((await eb.run()).state,'caught_up');assert.equal(b.db.getTransactions(ws.id).length,1);
    await post(b,'expense','80');assert.equal((await eb.run()).state,'caught_up');assert.equal((await ea.run()).state,'caught_up');
    assert.equal(a.db.calculateAccountSummaries(ws.id).find(x=>x.accountId===cash.id)?.currentBalanceMinor,'12000');
    assert.deepEqual(a.db.getTransactions(ws.id).map(x=>x.id).sort(),b.db.getTransactions(ws.id).map(x=>x.id).sort());
  });
  await t.test('changed Auth contact values preserve financial rows and cursor; matching contacts never authorize another UUID',async()=>{
    // auth.users is the minimal identity shim in this DISPOSABLE stock-Postgres test only.
    // Never run these fixture alterations on hosted Supabase Auth.
    await exec('alter table auth.users add column if not exists email text, add column if not exists phone text');
    await sql.query('update auth.users set email=$1,phone=$2 where id=$3',['old@example.invalid','8801712345678',owner]);
    const beforeCursor=await a.store.readCursor(scope(a));
    const fingerprint=async()=> (await sql.query("select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) as hash from hisab_cloud.journal_transactions t where owner_id=$1",[owner])).rows[0].hash;
    const before=await fingerprint(),localBefore=await a.driver.getItem('a');
    await sql.query('update auth.users set email=$1,phone=$2 where id=$3',['replacement@example.invalid','8801912345678',owner]);
    await sql.query('update auth.users set email=$1,phone=$2 where id=$3',['replacement@example.invalid','8801912345678',foreignOwner]);
    const page=await asActor(owner,'sync_pull',{requestId:generateUUID(),scope:scope(a),cursor:beforeCursor,limit:100});
    assert.equal(page.changes.length,0);assert.equal(page.nextCursor,beforeCursor);assert.equal(await fingerprint(),before);
    assert.equal(await a.driver.getItem('a'),localBefore);assert.equal(a.db.getIdentity()?.ownerSubjectHash,owner);
    await assert.rejects(sql.query('delete from auth.users where id=$1',[owner]),/foreign key constraint/);
    assert.equal(await fingerprint(),before);
    await assert.rejects(asActor(foreignOwner,'sync_pull',{requestId:generateUUID(),scope:{...scope(a),ownerId:foreignOwner},cursor:null,limit:100}),/SYNC_SCOPE_INVALID/);
  });
  await t.test('lost acknowledgement retries the same operation; no duplicate posting',async()=>{
    const tx=await post(a,'income','100');loseNextPush=true;
    assert.equal((await ea.run()).state,'retry_later');assert.ok(a.store.pendingCount(scope(a))>0);
    const count=(await sql.query('select count(*)::text as n from hisab_cloud.journal_transactions where id=$1',[tx])).rows[0].n;assert.equal(count,'1');
    clock+=100000;assert.equal((await ea.run()).state,'caught_up');assert.equal(a.store.pendingCount(scope(a)),0);
    assert.equal((await sql.query('select count(*)::text as n from hisab_cloud.journal_transactions where id=$1',[tx])).rows[0].n,'1');
  });
  await t.test('failed SQLite cursor commit rolls back the whole page, then replay succeeds',async()=>{
    await post(a,'income','200');await ea.run();
    const oldCursor=await b.store.readCursor(scope(b)),before=b.db.getTransactions(ws.id).length;
    const request={requestId:generateUUID(),scope:scope(b),cursor:oldCursor,limit:100};const page=await provider.pull(request);
    b.driver.failCommit=true;await assert.rejects(b.store.applyPullPageAtomically(scope(b),oldCursor,page),/SYNTHETIC_COMMIT_FAILURE/);
    assert.equal(await b.store.readCursor(scope(b)),oldCursor);assert.equal(b.db.getTransactions(ws.id).length,before);
    b.driver.close();b.driver=new SyncTestSqliteDriver(b.path);b.db=new LocalDatabase('b',b.driver);await b.db.init();b.store=new DatabaseSyncStore(b.db);eb=engine(b);
    assert.equal(await b.store.readCursor(scope(b)),oldCursor);assert.equal((await eb.run()).state,'caught_up');
    assert.equal(b.db.getTransactions(ws.id).length,before+2);
  });
  await t.test('stale acknowledgements, corrupt pages and cursor races preserve pending data',async()=>{
    const pending=await a.store.readPending(scope(a),100),cursor=await a.store.readCursor(scope(a));
    // Create an independently pending operation without sending it yet.
    await post(a,'income','1');const fresh=await a.store.readPending(scope(a),100),op=fresh.at(-1)!;
    await assert.rejects(a.store.acknowledge(scope(a),[{operationId:op.operationId,contentSha256:'0'.repeat(64)}]),/SYNC_ACK_STALE/);
    assert.equal(a.store.pendingCount(scope(a)),pending.length+1);
    const page=await provider.pull({requestId:generateUUID(),scope:scope(a),cursor,limit:100});
    await assert.rejects(a.store.applyPullPageAtomically(scope(a),'stale',page),/SYNC_CONTRACT_INVALID|SYNC_CURSOR_STALE/);
    const poisoned={...page,changes:[{changeId:'999',operation:{...op,contentSha256:'0'.repeat(64)}}],nextCursor:'tampered'};
    await assert.rejects(a.store.applyPullPageAtomically(scope(a),cursor,poisoned),/SYNC_HASH_MISMATCH/);
    assert.equal(await a.store.readCursor(scope(a)),cursor);assert.equal(a.store.pendingCount(scope(a)),pending.length+1);
    const categoryId=generateUUID(),deviceId=generateUUID();
    const body={protocolVersion:1 as const,operationId:generateUUID(),entityId:categoryId,workspaceId:ws.id,deviceId,sequence:'1',
      type:'category.create' as const,createdAtUtc:new Date().toISOString(),payload:{category:{id:categoryId,workspaceId:ws.id,name:'Cursor race',kind:'expense'}}};
    await asActor(owner,'sync_push',{requestId:generateUUID(),scope:{...scope(a),deviceId},operations:[{...body,contentSha256:await operationDigest(body)}]});
    const raced=await provider.pull({requestId:generateUUID(),scope:scope(a),cursor,limit:100});assert.equal(raced.changes.length,1);
    const gap={...raced,changes:[{...raced.changes[0],changeId:'999'}]};
    await assert.rejects(a.store.applyPullPageAtomically(scope(a),cursor,gap),/SYNC_STREAM_GAP/);
    await a.store.applyPullPageAtomically(scope(a),cursor,raced);
    await assert.rejects(a.store.applyPullPageAtomically(scope(a),cursor,raced),/SYNC_CURSOR_STALE/);
    assert.equal((await ea.run()).state,'caught_up');
  });
  await t.test('repeated run calls share one task and logout fences a delayed server response',async()=>{
    await post(a,'income','300');hold=deferred();reached=deferred();const first=ea.run();assert.equal(first,ea.run());
    let timer:ReturnType<typeof setTimeout>;
    try{await Promise.race([reached.promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('FIXTURE_REPLY_NOT_REACHED')),3000);})]);}
    finally{clearTimeout(timer!);}
    identity=null;ea.cancel();hold?.resolve();
    assert.equal((await first).state,'session_changed');assert.ok(a.store.pendingCount(scope(a))>0);
    identity=owner;clock+=100000;assert.equal((await ea.run()).state,'caught_up');
  });
  await t.test('a conflicting offline journal stays local/pending and is quarantined, never overwritten',async()=>{
    await eb.run();const id=generateUUID();await post(a,'income','400',id);await post(b,'income','500',id);
    assert.equal((await ea.run()).state,'caught_up');assert.equal((await eb.run()).state,'blocked');
    assert.equal(b.db.getTransaction(id)?.lines[0].debitMinor,'500');assert.ok(b.store.pendingCount(scope(b))>0);
    assert.ok(b.db.getRawState().conflicts.size>0);
  });
  await t.test('the same UUID from another Auth issuer cannot acknowledge or read this customer scope',async()=>{
    const before=calls;issuer='foreign-issuer';
    assert.equal((await ea.run()).state,'session_changed');assert.equal(calls,before);
    issuer='synthetic-test-only';
  });
  await t.test('concurrent native commits cannot put a change behind an already-read cursor',{skip:!native},async()=>{
    const Pg=(await import('pg')).Client,c1=new Pg({connectionString:native}),c2=new Pg({connectionString:native});
    await c1.connect();await c2.connect();let second:Promise<any>|undefined;
    const start=async(c:any)=>{await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('hisab.actor_id',$1,true)",[owner]);};
    const makeRequest=async(name:string):Promise<PushRequest>=>{const id=generateUUID(),deviceId=generateUUID();
      const body={protocolVersion:1 as const,operationId:generateUUID(),workspaceId:ws.id,deviceId,sequence:'1',entityId:id,type:'category.create' as const,
        createdAtUtc:new Date().toISOString(),payload:{category:{id,workspaceId:ws.id,name,kind:'expense'}}};
      return {requestId:generateUUID(),scope:{...scope(a),deviceId},operations:[{...body,contentSha256:await operationDigest(body)}]};};
    const firstRequest=await makeRequest('Concurrent A'),secondRequest=await makeRequest('Concurrent B');
    const before=(await asActor(owner,'sync_pull',{requestId:generateUUID(),scope:scope(a),cursor:null,limit:100})).nextCursor;
    try{
      await start(c1);await start(c2);const pid=(await c2.query('select pg_backend_pid() as id')).rows[0].id;
      const first=(await c1.query('select hisab_cloud.sync_push($1::jsonb) as reply',[JSON.stringify(firstRequest)])).rows[0].reply;
      assert.equal(first.outcomes[0].outcome,'accepted');
      second=c2.query('select hisab_cloud.sync_push($1::jsonb) as reply',[JSON.stringify(secondRequest)]);
      let waiting=false;
      for(let n=0;n<100;n++){
        waiting=(await sql.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) as waiting",[pid])).rows[0].waiting;
        if(waiting)break;await new Promise(r=>setTimeout(r,10));
      }
      assert.equal(waiting,true,'second writer waits for the workspace transaction, not an identity sequence');
      const during=await asActor(owner,'sync_pull',{requestId:generateUUID(),scope:scope(a),cursor:before,limit:100});
      assert.equal(during.changes.length,0);assert.equal(during.nextCursor,before);
      await c1.query('commit');assert.equal((await second).rows[0].reply.outcomes[0].outcome,'accepted');await c2.query('commit');
      const page1=await asActor(owner,'sync_pull',{requestId:generateUUID(),scope:scope(a),cursor:before,limit:1});
      assert.equal(page1.changes[0].operation.operationId,firstRequest.operations[0].operationId);assert.equal(page1.hasMore,true);
      const page2=await asActor(owner,'sync_pull',{requestId:generateUUID(),scope:scope(a),cursor:page1.nextCursor,limit:1});
      assert.equal(page2.changes[0].operation.operationId,secondRequest.operations[0].operationId);assert.equal(page2.hasMore,false);
    }finally{await c1.query('rollback');await second?.catch(()=>{});await c2.query('rollback');await c1.end();await c2.end();}
  });
  await t.test('another owner, corrupt hash and a foreign cursor cannot read or create accepted events',async()=>{
    await assert.rejects(asActor(foreignOwner,'sync_pull',{requestId:generateUUID(),scope:{...scope(a),ownerId:foreignOwner},cursor:null,limit:10}),/SYNC_SCOPE_INVALID/);
    const pending=await b.store.readPending(scope(b),100);const bad={...pending[0],operationId:generateUUID(),contentSha256:'0'.repeat(64)};
    const reply=await asActor(owner,'sync_push',{requestId:generateUUID(),scope:scope(b),operations:[bad]});assert.equal(reply.outcomes[0].outcome,'rejected');
    const numeric={...bad,sequence:100};numeric.contentSha256=await operationDigest(numeric as any);
    assert.equal((await asActor(owner,'sync_push',{requestId:generateUUID(),scope:scope(b),operations:[numeric]})).outcomes[0].outcome,'rejected');
    const malformed=structuredClone(pending[0]),transactionId=generateUUID(),operationId=generateUUID(),j=(malformed.payload as any).balancedJournal;
    const nominal=(await sql.query("select id from hisab_cloud.accounts where workspace_id=$1 and system_code='revenue_clearing'",[ws.id])).rows[0].id;
    Object.assign(malformed,{operationId,entityId:transactionId,sequence:'999'});Object.assign(j.transaction,{id:transactionId,createdOpId:operationId});
    for(const line of j.lines){line.id=generateUUID();line.transactionId=transactionId;if(line.accountId==='__system__revenue_clearing')line.accountId=nominal;}
    const signed={...malformed,contentSha256:await operationDigest(malformed)};
    assert.equal((await asActor(owner,'sync_push',{requestId:generateUUID(),scope:scope(b),operations:[signed]})).outcomes[0].outcome,'rejected');
    await assert.rejects(asActor(owner,'sync_pull',{requestId:generateUUID(),scope:scope(a),cursor:`h1:${foreignOwner}:${ws.id}:0`,limit:1}),/SYNC_CURSOR_INVALID/);
    assert.equal((await fetch(endpoint,{method:'POST',headers:{Authorization:'wrong'},body:'{}'})).status,401);
  });
});
