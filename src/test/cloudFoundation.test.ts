import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Real isolated PostgreSQL execution, with a minimal Auth subject fixture.
// This is not a Google login, hosted Supabase or cross-device acceptance test.
test('cloud foundation executes RLS, exact-money and immutable atomic journal invariants in isolated PostgreSQL',async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key,email text,aud text,role text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;`);
  const sql=await readFile(new URL('../../supabase/migrations/20261029152851_hisab_cloud_foundation.sql',import.meta.url),'utf8');
  await db.exec(sql);
  const a=randomUUID(),b=randomUUID(),wa=randomUUID(),wa2=randomUUID(),wb=randomUUID();
  const cash=randomUUID(),savings=randomUUID(),revenue=randomUUID(),expense=randomUUID(),equity=randomUUID(),foreignCash=randomUUID();
  const incomeCategory=randomUUID(),food=randomUUID(),subfood=randomUUID(),foreignCategory=randomUUID();
  await db.query('insert into auth.users(id) values($1),($2)',[a,b]);
  const actor=async(id:string,role='authenticated')=>{
    await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    await db.exec(role==='anon'?'set role anon':'set role authenticated');
  };
  const seedWorkspace=async(id:string,name:string)=>db.query("insert into hisab_cloud.workspaces(id,owner_id,name,kind) values($1,auth.uid(),$2,'personal')",[id,name]);
  const seedAccount=async(id:string,w:string,name:string,classification:string,system:string|null=null)=>db.query(
    "insert into hisab_cloud.accounts(id,owner_id,workspace_id,name,kind,classification,system_code) values($1,auth.uid(),$2,$3,'other',$4,$5)",[id,w,name,classification,system]);
  await actor(a); await seedWorkspace(wa,'A'); await seedWorkspace(wa2,'A second');
  for(const [id,name,classification,system] of [[cash,'Cash','asset',null],[savings,'Savings','asset',null],[revenue,'Income','revenue','revenue_clearing'],[expense,'Expense','expense','expense_clearing'],[equity,'Opening','equity','opening_equity']] as const)
    await seedAccount(id,wa,name,classification,system);
  await db.query("insert into hisab_cloud.categories(id,owner_id,workspace_id,kind,name) values($1,$2,$3,'income','Income'),($4,$2,$3,'expense','Food')",[incomeCategory,a,wa,food]);
  await db.query("insert into hisab_cloud.categories(id,owner_id,workspace_id,parent_id,kind,name) values($1,$2,$3,$4,'expense','Vegetables')",[subfood,a,wa,food]);
  await actor(b); await seedWorkspace(wb,'B'); await seedAccount(foreignCash,wb,'B cash','asset');
  await db.query("insert into hisab_cloud.categories(id,owner_id,workspace_id,kind,name) values($1,$2,$3,'expense','B food')",[foreignCategory,b,wb]);

  await t.test('separate SELECT/INSERT/UPDATE/DELETE checks deny anonymous and cross-owner access',async()=>{
    for(const [who,owned,other] of [[a,wa,wb],[b,wb,wa]]){
      await actor(who);
      assert.equal((await db.query('select id from hisab_cloud.workspaces where id=$1',[other])).rows.length,0);
      await assert.rejects(db.query("insert into hisab_cloud.workspaces(id,owner_id,name,kind) values($1,$2,'forged','personal')",[randomUUID(),who===a?b:a]),/row-level security/);
      assert.equal((await db.query("update hisab_cloud.workspaces set name='not allowed' where id=$1 returning id",[other])).rows.length,0);
      assert.equal((await db.query("update hisab_cloud.workspaces set name='Allowed' where id=$1 returning id",[owned])).rows.length,1);
      await assert.rejects(db.query('update hisab_cloud.workspaces set owner_id=$1 where id=$2',[who===a?b:a,owned]),/permission denied/);
      await assert.rejects(db.query('delete from hisab_cloud.workspaces where id=$1',[owned]),/permission denied/);
    }
    await actor('', 'anon');
    for(const operation of ['select * from','insert into','update','delete from']){
      const statement=operation==='select * from'?'select * from hisab_cloud.workspaces':operation==='insert into'?"insert into hisab_cloud.workspaces(id,owner_id,name,kind) values(gen_random_uuid(),gen_random_uuid(),'x','personal')":operation==='update'?"update hisab_cloud.workspaces set name='x'":'delete from hisab_cloud.workspaces';
      await assert.rejects(db.query(statement),/permission denied/);
    }
    await actor(a);
  });

  await t.test('category hierarchy and group references cannot escape their owner or workspace',async()=>{
    await assert.rejects(db.query("insert into hisab_cloud.categories(id,owner_id,workspace_id,parent_id,kind,name) values($1,$2,$3,$4,'expense','Cross owner')",[randomUUID(),a,wa,foreignCategory]),/HISAB_CATEGORY_PARENT_INVALID/);
    await assert.rejects(db.query("insert into hisab_cloud.categories(id,owner_id,workspace_id,parent_id,kind,name) values($1,$2,$3,$4,'expense','Too deep')",[randomUUID(),a,wa,subfood]),/HISAB_CATEGORY_PARENT_INVALID/);
    await assert.rejects(db.query("insert into hisab_cloud.categories(id,owner_id,workspace_id,parent_id,kind,name) values($1,$2,$3,$4,'expense','Other workspace')",[randomUUID(),a,wa2,food]),/HISAB_CATEGORY_PARENT_INVALID/);
    const group=randomUUID(); await db.query("insert into hisab_cloud.account_groups(id,owner_id,workspace_id,name) values($1,$2,$3,'Other group')",[group,a,wa2]);
    await assert.rejects(db.query('update hisab_cloud.accounts set group_id=$1 where id=$2',[group,cash]),/foreign key/);
  });

  const line=(accountId:string,debitMinor:string,creditMinor:string,categoryId:string|null=null)=>({id:randomUUID(),accountId,debitMinor,creditMinor,categoryId});
  const command=(kind:string,lines:any[],options:{operationId?:string;transactionId?:string;workspaceId?:string}={})=>({workspaceId:options.workspaceId||wa,operationId:options.operationId||randomUUID(),transactionId:options.transactionId||randomUUID(),deviceId:randomUUID(),kind,lines});
  const post=async(c:ReturnType<typeof command>)=>(await db.query<{result:any}>(
    "select hisab_cloud.post_journal($1,$2,$3,$4,$5,'2026-10-29','2026-10-29T13:00:00Z',$6::jsonb,null) as result",
    [c.workspaceId,c.operationId,c.transactionId,c.deviceId,c.kind,JSON.stringify(c.lines)])).rows[0].result;
  let valid:ReturnType<typeof command>;
  const counts=async()=>JSON.stringify((await db.query('select (select count(*) from hisab_cloud.journal_transactions)::text as transactions,(select count(*) from hisab_cloud.journal_lines)::text as lines')).rows);

  await t.test('opening, income, expense and savings transfer count assets once, with a fee only as expense',async()=>{
    await post(command('opening',[line(cash,'100000','0'),line(equity,'0','100000')]));
    valid=command('income',[line(cash,'12080','0'),line(revenue,'0','12080',incomeCategory)]); await post(valid);
    await post(command('expense',[line(expense,'80','0',subfood),line(cash,'0','80')]));
    await post(command('transfer',[line(savings,'5000','0'),line(cash,'0','5000'),line(expense,'20','0',food),line(cash,'0','20')]));
    const result=await db.query<{id:string;balance:string}>("select a.id,coalesce(sum(l.debit_minor-l.credit_minor),0)::text as balance from hisab_cloud.accounts a left join hisab_cloud.journal_lines l on a.id=l.account_id where a.classification='asset' group by a.id");
    const balances=new Map(result.rows.map(row=>[row.id,BigInt(row.balance)]));
    assert.equal(balances.get(cash),106980n);assert.equal(balances.get(savings),5000n);
    assert.equal([...balances.values()].reduce((x,y)=>x+y,0n),111980n);
    assert.equal((await db.query<{amount:string}>("select sum(l.debit_minor)::text as amount from hisab_cloud.journal_lines l join hisab_cloud.accounts a on a.id=l.account_id where a.system_code='expense_clearing'")).rows[0].amount,'100');
  });

  await t.test('retry acknowledges the same immutable journal; a changed payload with the same operation conflicts',async()=>{
    const before=await counts(); const replay=await post(valid!);assert.equal(replay.replayed,true);assert.equal(replay.transactionId,valid!.transactionId);assert.equal(await counts(),before);
    await assert.rejects(post({...valid!,lines:[line(cash,'12081','0'),line(revenue,'0','12081',incomeCategory)]}),/HISAB_OPERATION_CONFLICT/);
    assert.equal(await counts(),before);
  });

  await t.test('unbalanced, misclassified, fractional, oversized and foreign-reference commands roll back fully',async()=>{
    const invalid=[command('income',[line(cash,'12080','0'),line(revenue,'0','12079',incomeCategory)]),
      command('income',[line(cash,'100','0'),line(savings,'0','100')]),
      command('expense',[line(expense,'1.5','0',food),line(cash,'0','1.5')]),
      command('expense',[line(expense,'1'+'0'.repeat(40),'0',food),line(cash,'0','1'+'0'.repeat(40))]),
      command('income',[line(foreignCash,'1','0'),line(revenue,'0','1',incomeCategory)]),
      command('expense',[line(expense,'1','0',foreignCategory),line(cash,'0','1')]),
      command('income',[{...line(cash,'100','0'),owner_id:b},line(revenue,'0','100',incomeCategory)]),
      command('transfer',[line(cash,'100','0'),line(cash,'0','100')])];
    for(const c of invalid){const before=await counts();await assert.rejects(post(c),/HISAB_|check constraint|foreign key/);assert.equal(await counts(),before);}
    const before=await counts();
    await assert.rejects(post(command('income',[line(cash,'100','0'),line(revenue,'0','100',incomeCategory)],{workspaceId:wb})),/HISAB_WORKSPACE_DENIED/);
    assert.equal(await counts(),before);
    await actor(b);assert.equal((await db.query('select id from hisab_cloud.journal_transactions')).rows.length,0);await actor(a);
  });

  await t.test('large amounts retain all paisa beyond JavaScript safe integers',async()=>{
    const amount='900719925474099312345';const c=command('income',[line(cash,amount,'0'),line(revenue,'0',amount,incomeCategory)]);
    await post(c);const result=await db.query<{amount:string}>('select debit_minor::text as amount from hisab_cloud.journal_lines where transaction_id=$1 and account_id=$2',[c.transactionId,cash]);
    assert.equal(result.rows[0].amount,amount);
  });

  await t.test('posted journals reject update, delete, late appends and forged creation transaction IDs',async()=>{
    await assert.rejects(db.query('update hisab_cloud.journal_transactions set note=$1 where id=$2',['changed',valid!.transactionId]),/permission denied/);
    await assert.rejects(db.query('delete from hisab_cloud.journal_lines where transaction_id=$1',[valid!.transactionId]),/permission denied/);
    await assert.rejects(db.query('insert into hisab_cloud.journal_lines(id,owner_id,workspace_id,transaction_id,account_id,debit_minor,credit_minor) values($1,$2,$3,$4,$5,1,0)',[randomUUID(),a,wa,valid!.transactionId,cash]),/HISAB_JOURNAL_IMMUTABLE/);
    await assert.rejects(db.query("insert into hisab_cloud.journal_transactions(id,owner_id,workspace_id,operation_id,device_id,transaction_type,effective_date,occurred_at,request_payload,creation_tx) values($1,$2,$3,$4,$5,'income','2026-10-29',now(),'{}',1)",[randomUUID(),a,wa,randomUUID(),randomUUID()]),/permission denied/);
    await db.exec('reset role');
    await assert.rejects(db.query("update hisab_cloud.journal_transactions set note='changed' where id=$1",[valid!.transactionId]),/HISAB_JOURNAL_IMMUTABLE/);
    await actor(a);
  });

  await t.test('deferred validation rejects an incomplete raw insert, and archived wallets reject new commands',async()=>{
    const before=await counts();
    await assert.rejects(db.query("insert into hisab_cloud.journal_transactions(id,owner_id,workspace_id,operation_id,device_id,transaction_type,effective_date,occurred_at,request_payload) values($1,$2,$3,$4,$5,'income','2026-10-29',now(),'{}')",[randomUUID(),a,wa,randomUUID(),randomUUID()]),/HISAB_JOURNAL_UNBALANCED/);
    assert.equal(await counts(),before);
    await db.query('update hisab_cloud.accounts set archived_at=now() where id=$1',[cash]);
    await assert.rejects(post(command('income',[line(cash,'1','0'),line(revenue,'0','1',incomeCategory)])),/HISAB_REFERENCE_DENIED/);
    assert.equal(await counts(),before);
  });

  await t.test('private storage resists an existing permissive anonymous policy without changing other buckets',async()=>{
    await db.exec('reset role');
    await db.exec(`create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,owner_id text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon,authenticated;
      grant select,insert,update,delete on storage.objects to anon,authenticated;
      create policy unrelated_existing_allow on storage.objects for all to anon,authenticated using(true) with check(true);
      insert into storage.objects(bucket_id,name) values('unrelated-fixture','public.txt');`);
    const storageSql=await readFile(new URL('../../supabase/migrations/20261029154151_hisab_private_storage_guards.sql',import.meta.url),'utf8');
    await db.exec(storageSql);
    const path=`${a}/${wa}/${'a'.repeat(64)}.jpg`,id=randomUUID();
    await actor(a);
    await db.query('insert into storage.objects(id,bucket_id,name,owner_id) values($1,$2,$3,$4)',[id,'hisab-receipts-v1',path,a]);
    assert.equal((await db.query('select id from storage.objects where id=$1',[id])).rows.length,1);
    assert.equal((await db.query("update storage.objects set name='tampered' where id=$1 returning id",[id])).rows.length,0);
    assert.equal((await db.query('delete from storage.objects where id=$1 returning id',[id])).rows.length,0);
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['hisab-receipts-v1',`${a}/${wb}/${'c'.repeat(64)}.jpg`,a]),/row-level security/);
    await actor(b);
    assert.equal((await db.query('select id from storage.objects where id=$1',[id])).rows.length,0);
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['hisab-receipts-v1',path,a]),/row-level security/);
    await actor('','anon');
    assert.equal((await db.query('select id from storage.objects where id=$1',[id])).rows.length,0);
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['hisab-receipts-v1',path,a]),/row-level security/);
    assert.equal((await db.query("select name from storage.objects where bucket_id='unrelated-fixture'")).rows.length,1);
    assert.equal((await db.query("update storage.objects set name='still-permitted.txt' where bucket_id='unrelated-fixture' returning id")).rows.length,1);
    assert.equal((await db.query("delete from storage.objects where bucket_id='unrelated-fixture' returning id")).rows.length,1);
    await db.exec('reset role');
    assert.deepEqual((await db.query<{public:boolean;file_size_limit:number}>('select public,file_size_limit from storage.buckets')).rows.map(row=>[row.public,Number(row.file_size_limit)]),[[false,2097152],[false,2097152]]);
  });

  await t.test('the hosted verification script rolls back all synthetic Auth, financial and Storage metadata fixtures',async()=>{
    await db.exec('reset role');
    const verification=await readFile(new URL('../../scripts/sql/Verify-HisabCloudFoundation.sql',import.meta.url),'utf8');
    const result=await db.exec(verification);
    assert.equal((result.at(-1)?.rows[0] as any).result,'HISAB_SQL_ROLLBACK_PASS');
  });
});
