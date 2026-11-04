import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const nativeUrl = process.env.HISAB_TEST_PG_URL;
if (nativeUrl) {
  const url = new URL(nativeUrl);
  if (process.env.HISAB_SQL_TEST_MODE !== 'isolated' || !['localhost','127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/hisab_contract_test') throw Error('Only an explicitly isolated loopback test database is allowed');
}
const load = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const files = await readdir(new URL('../supabase/migrations/', import.meta.url));
const forward = files.find(file => file.endsWith('_hisab_portable_money_media.sql'));
if (!forward) throw Error('Forward migration missing');

test(`Portable SQL/RLS on ${nativeUrl ? 'native PostgreSQL' : 'PGlite PostgreSQL WASM'}`, async t => {
  const db = nativeUrl ? new (await import('pg')).Client({ connectionString: nativeUrl }) :
    new (await import('@electric-sql/pglite')).PGlite();
  if (nativeUrl) await db.connect();
  const q = (sql, args = []) => db.query(sql, args);
  const exec = sql => nativeUrl ? db.query(sql) : db.exec(sql);
  t.after(async () => nativeUrl ? db.end() : db.close());
  const actor = async (id, work, role = 'authenticated', client = db) => {
    await client.query('begin');
    try {
      await client.query(`set local role ${role === 'anon' ? 'anon' : 'authenticated'}`);
      await client.query("select set_config('hisab.actor_id',$1,true),set_config('request.jwt.claim.sub',$1,true)", [id || '']);
      const result = await work(client); await client.query('commit'); return result;
    } catch (error) { await client.query('rollback'); throw error; }
  };
  const a = randomUUID(), b = randomUUID(), wa = randomUUID(), wb = randomUUID();
  const cash = randomUUID(), revenue = randomUUID(), expense = randomUUID(), equity = randomUUID();
  const foreignCash = randomUUID(), savings = randomUUID(), income = randomUUID(), food = randomUUID();
  const line = (accountId, debitMinor, creditMinor, categoryId = null) => ({ id: randomUUID(), accountId, debitMinor, creditMinor, categoryId });
  const command = (amount = '12080') => ({ operation: randomUUID(), transaction: randomUUID(), device: randomUUID(),
    lines: [line(cash, amount, '0'), line(revenue, '0', amount, income)] });
  const post = (client, c, workspace = wa, kind = 'income') => client.query(
    "select hisab_cloud.post_journal($1,$2,$3,$4,$5,'2026-11-04','2026-11-04T08:00:00Z',$6::jsonb,null) as result",
    [workspace,c.operation,c.transaction,c.device,kind,JSON.stringify(c.lines)]);
  const counts = async () => (await q('select count(*)::text as n from hisab_cloud.journal_transactions')).rows[0].n;

  await t.test('replays deployed baseline on stock PostgreSQL with only the explicit Auth context adapter', async () => {
    const fresh = (await q("select to_regnamespace('auth') as auth,to_regnamespace('hisab_cloud') as hisab")).rows[0];
    assert.equal(fresh.auth, null); assert.equal(fresh.hisab, null);
    await exec("set hisab.bootstrap_mode='isolated-stock'"); await exec(await load('db/adapters/stock-postgres.sql'));
    await exec('create table public.deshpath_preservation_fixture(id integer primary key,value text); insert into public.deshpath_preservation_fixture values(1,\'unchanged\')');
    await exec(await load('supabase/migrations/20261029152851_hisab_cloud_foundation.sql'));
    await q('insert into auth.users(id) values($1),($2)', [a,b]);
    for (const [owner,ws] of [[a,wa],[b,wb]]) await actor(owner, async client => {
      await client.query("insert into hisab_cloud.profiles(id,display_name) values($1,'Synthetic test')", [owner]);
      await client.query("insert into hisab_cloud.workspaces(id,owner_id,name,kind) values($1,$2,'Synthetic workspace','personal')", [ws,owner]);
    });
    await actor(a, async client => {
      for (const [id,classification,code] of [[cash,'asset',null],[savings,'asset',null],[revenue,'revenue','revenue_clearing'],[expense,'expense','expense_clearing'],[equity,'equity','opening_equity']]) {
        await client.query("insert into hisab_cloud.accounts(id,owner_id,workspace_id,name,kind,classification,system_code) values($1,$2,$3,'Synthetic account','cash',$4,$5)", [id,a,wa,classification,code]);
      }
      await client.query("insert into hisab_cloud.categories(id,owner_id,workspace_id,kind,name) values($1,$2,$3,'income','Synthetic income'),($4,$2,$3,'expense','Synthetic expense')", [income,a,wa,food]);
    });
    await actor(b, client => client.query("insert into hisab_cloud.accounts(id,owner_id,workspace_id,name,kind,classification) values($1,$2,$3,'Foreign synthetic account','cash','asset')", [foreignCash,b,wb]));
    await actor(a, client => post(client, command()));
  });

  await t.test('forward migration preserves posted rows and unrelated table while adding FORCE RLS media', async () => {
    const before = JSON.stringify((await q('select * from hisab_cloud.journal_transactions order by id')).rows);
    await exec(await load(`supabase/migrations/${forward}`));
    assert.equal(JSON.stringify((await q('select * from hisab_cloud.journal_transactions order by id')).rows), before);
    assert.equal((await q('select value from public.deshpath_preservation_fixture')).rows[0].value, 'unchanged');
    const tables = await q("select relname,relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='hisab_cloud' and relkind='r'");
    assert.equal(tables.rows.length, 8);
    assert.ok(tables.rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
  });

  await t.test('two owners and anonymous role cannot read/write foreign finance or self-escalate ownership', async () => {
    await actor(a, async client => {
      assert.deepEqual((await client.query('select id from hisab_cloud.workspaces')).rows.map(row => row.id), [wa]);
      assert.equal((await client.query('select id from hisab_cloud.accounts where id=$1', [foreignCash])).rows.length, 0);
    });
    await actor(b, async client => {
      assert.equal((await client.query('select id from hisab_cloud.journal_transactions')).rows.length, 0);
      await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ user_metadata: { sub:a }, email:'forged@example.invalid' })]);
      assert.deepEqual((await client.query('select id from hisab_cloud.profiles')).rows.map(row => row.id), [b]);
    });
    await assert.rejects(actor(a, client => client.query("insert into hisab_cloud.workspaces(id,owner_id,name,kind) values($1,$2,'forged','personal')", [randomUUID(),b])), /row-level security/);
    await assert.rejects(actor(a, client => client.query('update hisab_cloud.workspaces set owner_id=$1 where id=$2', [b,wa])), /permission denied/);
    await assert.rejects(actor(null, client => client.query('select * from hisab_cloud.workspaces'), 'anon'), /permission denied/);
    await assert.rejects(actor(a, client => post(client, command(), wb)), /HISAB_WORKSPACE_DENIED/);
    const c = command(); c.lines[0].accountId = foreignCash;
    await assert.rejects(actor(a, client => post(client, c)), /HISAB_REFERENCE_DENIED/);
  });

  await t.test('exact money beyond JS safe integers survives; fractions, overflow and imbalance roll back fully', async () => {
    const c = command('9007199254740993'); await actor(a, client => post(client, c));
    assert.equal((await q('select debit_minor::text as amount from hisab_cloud.journal_lines where transaction_id=$1 and account_id=$2',[c.transaction,cash])).rows[0].amount, '9007199254740993');
    await actor(a, client => post(client, command('9223372036854775807')));
    for (const invalid of [command('1.5'),command('9223372036854775808'),command('NaN'),command('1e3')]) {
      const before = await counts(); await assert.rejects(actor(a, client => post(client, invalid)), /HISAB_|check constraint/); assert.equal(await counts(), before);
    }
    const numeric = command(); numeric.lines[0].debitMinor = 12080;
    await assert.rejects(actor(a, client => post(client, numeric)), /HISAB_JOURNAL_INVALID/);
    const unbalanced = command(); unbalanced.lines[1].creditMinor = '12079';
    const before = await counts(); await assert.rejects(actor(a, client => post(client, unbalanced)), /HISAB_JOURNAL_UNBALANCED/); assert.equal(await counts(), before);
    assert.equal((await q('select 1.5::bigint::text as rounded')).rows[0].rounded,'2', 'Proof that an unchecked bigint cast would silently round');
  });

  await t.test('opening, expense and savings transfer preserve classification; fees alone reduce assets', async () => {
    const balance = async () => BigInt((await q("select coalesce(sum(l.debit_minor-l.credit_minor),0)::text as amount from hisab_cloud.journal_lines l join hisab_cloud.accounts a on a.id=l.account_id where a.classification='asset'")).rows[0].amount);
    const before = await balance();
    const opening = command(); opening.lines=[line(cash,'100000','0'),line(equity,'0','100000')];
    await actor(a,client=>post(client,opening,wa,'opening'));
    const spending=command(); spending.lines=[line(expense,'80','0',food),line(cash,'0','80')];
    await actor(a,client=>post(client,spending,wa,'expense'));
    const transfer=command(); transfer.lines=[line(savings,'5000','0'),line(cash,'0','5000'),line(expense,'20','0',food),line(cash,'0','20')];
    await actor(a,client=>post(client,transfer,wa,'transfer'));
    assert.equal((await balance())-before,99900n);
    const reversedOpening=command(); reversedOpening.lines=[line(cash,'0','1'),line(equity,'1','0')];
    const n=await counts();
    await assert.rejects(actor(a,client=>post(client,reversedOpening,wa,'opening')),/HISAB_OPENING_DIRECTION_INVALID/);
    assert.equal(await counts(),n);
  });

  await t.test('operation retries deduplicate and changed immutable requests conflict', async () => {
    const c = command(); await actor(a, client => post(client,c)); const before = await counts();
    const replay = await actor(a, client => post(client,c)); assert.equal(replay.rows[0].result.replayed,true);
    assert.equal(await counts(),before);
    const changed = { ...c, lines: [line(cash,'12081','0'),line(revenue,'0','12081',income)] };
    await assert.rejects(actor(a, client => post(client,changed)), /HISAB_OPERATION_CONFLICT/); assert.equal(await counts(),before);
  });

  await t.test('raw fractional insertion, journal mutation and late appends cannot bypass invariants', async () => {
    const c = command(); await actor(a, client => post(client,c));
    await assert.rejects(actor(a, client => client.query('update hisab_cloud.journal_transactions set note=$1 where id=$2',['changed',c.transaction])), /permission denied/);
    await assert.rejects(q('update hisab_cloud.journal_transactions set note=$1 where id=$2',['changed',c.transaction]), /HISAB_JOURNAL_IMMUTABLE/);
    await assert.rejects(actor(a, client => client.query('delete from hisab_cloud.journal_lines where transaction_id=$1',[c.transaction])), /permission denied/);
    await assert.rejects(actor(a, client => client.query('insert into hisab_cloud.journal_lines(id,owner_id,workspace_id,transaction_id,account_id,debit_minor,credit_minor) values($1,$2,$3,$4,$5,1,0)',[randomUUID(),a,wa,c.transaction,cash])), /HISAB_JOURNAL_IMMUTABLE/);
    const before = await counts();
    await assert.rejects(actor(a, async client => {
      const tx = randomUUID(); await client.query("insert into hisab_cloud.journal_transactions(id,owner_id,workspace_id,operation_id,device_id,transaction_type,effective_date,occurred_at,request_payload) values($1,$2,$3,$4,$5,'income','2026-11-04',now(),'{}')",[tx,a,wa,randomUUID(),randomUUID()]);
      await client.query('insert into hisab_cloud.journal_lines(id,owner_id,workspace_id,transaction_id,account_id,debit_minor,credit_minor) values($1,$2,$3,$4,$5,1.5,0)',[randomUUID(),a,wa,tx,cash]);
    }), /check constraint/);
    assert.equal(await counts(),before);
  });

  await t.test('media keys are private, workspace-bound, immutable to clients and size-limited', async () => {
    const id = randomUUID(), digest = 'a'.repeat(64), key = `${a}/${wa}/${digest}.jpg`;
    const insert = (client, owner=a, ws=wa, object=key, bytes=100, contentHash=digest) => client.query("insert into hisab_cloud.media_objects(id,owner_id,workspace_id,kind,object_key,content_sha256,content_type,byte_length) values($1,$2,$3,'receipt',$4,$5,'image/jpeg',$6)",[randomUUID(),owner,ws,object,contentHash,bytes]);
    await actor(a, client => client.query("insert into hisab_cloud.media_objects(id,owner_id,workspace_id,kind,object_key,content_sha256,content_type,byte_length) values($1,$2,$3,'receipt',$4,$5,'image/jpeg',100)",[id,a,wa,key,digest]));
    await actor(b, async client => assert.equal((await client.query('select id from hisab_cloud.media_objects')).rows.length,0));
    await assert.rejects(actor(null, client => client.query('select id from hisab_cloud.media_objects'),'anon'), /permission denied/);
    await assert.rejects(actor(b, client => insert(client)), /row-level security/);
    await assert.rejects(actor(a, client => insert(client,a,wb,`${a}/${wb}/${digest}.jpg`)), /row-level security|foreign key/);
    await assert.rejects(actor(a, client => insert(client,a,wa,'../unsafe.jpg')), /check constraint/);
    await assert.rejects(actor(a, client => insert(client,a,wa,key,2097153)), /check constraint/);
    await assert.rejects(actor(a, client => client.query('update hisab_cloud.media_objects set byte_length=1 where id=$1',[id])), /permission denied/);
    await assert.rejects(actor(a, client => client.query('delete from hisab_cloud.media_objects where id=$1',[id])), /permission denied/);
    await actor(a, client => client.query('update hisab_cloud.workspaces set archived_at=now() where id=$1',[wa]));
    await assert.rejects(actor(a, client => insert(client,a,wa,`${a}/${wa}/${'b'.repeat(64)}.jpg`,100,'b'.repeat(64))), /row-level security/);
    await actor(a, client => client.query('update hisab_cloud.workspaces set archived_at=null where id=$1',[wa]));
  });

  if (nativeUrl) await t.test('native concurrent retries serialize to one journal through transaction advisory locks', async () => {
    const { Client } = await import('pg'), clients = [new Client({connectionString:nativeUrl}),new Client({connectionString:nativeUrl})];
    await Promise.all(clients.map(client => client.connect()));
    try {
      const c = command(), before = BigInt(await counts());
      const replies = await Promise.all(clients.map(client => actor(a, connection => post(connection,c),'authenticated',client)));
      assert.deepEqual(replies.map(result=>result.rows[0].result.replayed).sort(),[false,true]);
      assert.equal(BigInt(await counts()),before+1n);
    } finally { await Promise.all(clients.map(client => client.end())); }
  });

  await t.test('no bootstrap replay or default PUBLIC execution privilege widens access', async () => {
    await assert.rejects(exec(await load('db/adapters/stock-postgres.sql')), /HISAB_STOCK_BOOTSTRAP_REQUIRES_EMPTY_ISOLATED_DATABASE/);
    await exec('rollback');
    const rows = (await q("select p.proname,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('hisab_cloud','hisab_internal')")).rows;
    assert.ok(rows.every(row => !row.prosecdef));
    assert.equal((await q('select value from public.deshpath_preservation_fixture')).rows[0].value,'unchanged');
  });

  await t.test('the hosted verification SQL passes and rolls back every synthetic fixture', async () => {
    const before=await counts();
    await exec(await load('scripts/sql/Verify-HisabPortable.sql'));
    assert.equal(await counts(),before);
    assert.equal((await q("select count(*)::text as n from auth.users where id='f1140000-0000-4000-8000-000000000001'")).rows[0].n,'0');
    assert.equal((await q('select auth.uid() as actor')).rows[0].actor,null,'Transaction-local identity cannot leak into the next request');
  });
});
