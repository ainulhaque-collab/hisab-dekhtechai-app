-- Synthetic SQL policy/RPC test, NOT Google/Auth HTTP or multi-device acceptance.
-- Fixture inserts are inside a subtransaction deliberately rolled back on success.
-- Only for the owner-selected DEVELOPMENT project; never a production smoke test.
do $test$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); wa uuid:=gen_random_uuid(); wb uuid:=gen_random_uuid();
  cash uuid:=gen_random_uuid(); reserve uuid:=gen_random_uuid(); revenue uuid:=gen_random_uuid();
  expense uuid:=gen_random_uuid(); foreign_cash uuid:=gen_random_uuid();
  income_cat uuid:=gen_random_uuid(); food uuid:=gen_random_uuid();
  op uuid:=gen_random_uuid(); tx uuid:=gen_random_uuid(); device uuid:=gen_random_uuid();
  object_id uuid:=gen_random_uuid(); object_name text;
  entries jsonb; bad_entries jsonb; response jsonb; count_rows bigint; changed bigint; balance numeric; statement text;
  auth_before bigint; journals_before bigint; workspaces_before bigint; profiles_before bigint; storage_before bigint;
begin
  select count(*) into auth_before from auth.users;
  select count(*) into journals_before from hisab_cloud.journal_transactions;
  select count(*) into workspaces_before from hisab_cloud.workspaces;
  select count(*) into profiles_before from hisab_cloud.profiles;
  select count(*) into storage_before from storage.objects;
  begin
    -- No password, real address or login session is created. The rows roll back.
    insert into auth.users(id,email,aud,role) values
      (a,'hisab-qa-'||a::text||'@example.invalid','authenticated','authenticated'),
      (b,'hisab-qa-'||b::text||'@example.invalid','authenticated','authenticated');
    perform set_config('request.jwt.claim.sub',a::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
    set local role authenticated;
    insert into hisab_cloud.profiles(id,display_name) values(a,'Synthetic A');
    insert into hisab_cloud.workspaces(id,owner_id,name,kind) values(wa,a,'Synthetic A','personal');
    insert into hisab_cloud.accounts(id,owner_id,workspace_id,name,kind,classification,system_code) values
      (cash,a,wa,'Synthetic cash','cash','asset',null),(reserve,a,wa,'Synthetic savings','savings','asset',null),
      (revenue,a,wa,'Synthetic revenue','other','revenue','revenue_clearing'),
      (expense,a,wa,'Synthetic expense','other','expense','expense_clearing');
    insert into hisab_cloud.categories(id,owner_id,workspace_id,name,kind) values
      (income_cat,a,wa,'Synthetic income','income'),(food,a,wa,'Synthetic food','expense');
    reset role;
    perform set_config('request.jwt.claim.sub',b::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated','user_metadata',jsonb_build_object('owner_id',a,'role','owner'))::text,true);
    set local role authenticated;
    insert into hisab_cloud.profiles(id,display_name) values(b,'Synthetic B');
    insert into hisab_cloud.workspaces(id,owner_id,name,kind) values(wb,b,'Synthetic B','business');
    insert into hisab_cloud.accounts(id,owner_id,workspace_id,name,kind,classification) values(foreign_cash,b,wb,'Synthetic B cash','cash','asset');
    select count(*) into count_rows from hisab_cloud.workspaces where id=wa;
    if count_rows<>0 then raise exception 'TEST_CROSS_OWNER_SELECT'; end if;
    select count(*) into count_rows from hisab_cloud.profiles;
    if count_rows<>1 then raise exception 'TEST_PROFILE_ISOLATION'; end if;
    begin
      insert into hisab_cloud.workspaces(id,owner_id,name,kind) values(gen_random_uuid(),a,'Forged','personal');
      raise exception 'TEST_CROSS_OWNER_INSERT';
    exception when insufficient_privilege then null; end;
    update hisab_cloud.workspaces set name='Forbidden' where id=wa;
    get diagnostics changed=row_count;
    if changed<>0 then raise exception 'TEST_CROSS_OWNER_UPDATE'; end if;
    begin delete from hisab_cloud.workspaces where id=wb; raise exception 'TEST_DELETE_PERMISSION';
    exception when insufficient_privilege then null; end;

    reset role;
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','{}',true);
    set local role anon;
    foreach statement in array array[
      'select * from hisab_cloud.workspaces',
      'insert into hisab_cloud.workspaces(id,owner_id,name,kind) values(gen_random_uuid(),gen_random_uuid(),''Forbidden'',''personal'')',
      'update hisab_cloud.workspaces set name=''Forbidden''',
      'delete from hisab_cloud.workspaces'
    ] loop
      begin execute statement; raise exception 'TEST_ANONYMOUS_ACCESS';
      exception when insufficient_privilege then null; end;
    end loop;
    reset role;
    perform set_config('request.jwt.claim.sub',a::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
    set local role authenticated;
    entries:=jsonb_build_array(
      jsonb_build_object('id',gen_random_uuid(),'accountId',cash,'debitMinor','12080','creditMinor','0','categoryId',null),
      jsonb_build_object('id',gen_random_uuid(),'accountId',revenue,'debitMinor','0','creditMinor','12080','categoryId',income_cat));
    response:=hisab_cloud.post_journal(wa,op,tx,device,'income','2026-10-29','2026-10-29T13:00:00Z',entries,null);
    if response->>'replayed'<>'false' then raise exception 'TEST_FIRST_COMMIT'; end if;
    response:=hisab_cloud.post_journal(wa,op,tx,device,'income','2026-10-29','2026-10-29T13:00:00Z',entries,null);
    if response->>'replayed'<>'true' then raise exception 'TEST_IDEMPOTENT_REPLAY'; end if;
    begin
      perform hisab_cloud.post_journal(wa,op,tx,device,'income','2026-10-29','2026-10-29T13:00:00Z',entries,'Changed payload');
      raise exception 'TEST_OPERATION_CONFLICT';
    exception when unique_violation then null; end;
    bad_entries:=jsonb_set(jsonb_set(entries,'{0,id}',to_jsonb(gen_random_uuid())),'{1,id}',to_jsonb(gen_random_uuid()));
    begin
      perform hisab_cloud.post_journal(wa,gen_random_uuid(),gen_random_uuid(),device,'income','2026-10-29','2026-10-29T13:00:00Z',jsonb_set(bad_entries,'{1,creditMinor}','"12079"'::jsonb),null);
      raise exception 'TEST_UNBALANCED_ACCEPTED';
    exception when check_violation then null; end;
    begin
      perform hisab_cloud.post_journal(wa,gen_random_uuid(),gen_random_uuid(),device,'income','2026-10-29','2026-10-29T13:00:00Z',jsonb_set(bad_entries,'{0,accountId}',to_jsonb(foreign_cash)),null);
      raise exception 'TEST_FOREIGN_ACCOUNT_ACCEPTED';
    exception when insufficient_privilege then null; end;
    select count(*) into count_rows from hisab_cloud.journal_transactions;
    if count_rows<>1 then raise exception 'TEST_INVALID_WRITE_NOT_ROLLED_BACK'; end if;
    select sum(debit_minor-credit_minor) into balance from hisab_cloud.journal_lines where account_id=cash;
    if balance<>12080 then raise exception 'TEST_EXACT_BALANCE'; end if;
    begin update hisab_cloud.journal_transactions set note='Forbidden' where id=tx; raise exception 'TEST_HISTORY_MUTATION';
    exception when insufficient_privilege then null; end;
    -- RLS metadata fixture only: no image bytes are uploaded or claimed restored.
    object_name:=a::text||'/'||wa::text||'/'||repeat('f',64)||'.jpg';
    insert into storage.objects(id,bucket_id,name,owner_id) values(object_id,'hisab-receipts-v1',object_name,a::text);
    select count(*) into count_rows from storage.objects where id=object_id;
    if count_rows<>1 then raise exception 'TEST_STORAGE_OWNER_READ'; end if;
    update storage.objects set name='Forbidden' where id=object_id;
    get diagnostics changed=row_count;
    if changed<>0 then raise exception 'TEST_STORAGE_MUTATION'; end if;
    begin
      delete from storage.objects where id=object_id;
      get diagnostics changed=row_count;
      if changed<>0 then raise exception 'TEST_STORAGE_DELETE'; end if;
    -- Hosted Storage may additionally reject SQL DELETE at statement level.
    exception when insufficient_privilege then null; end;
    reset role;
    perform set_config('request.jwt.claim.sub',b::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
    set local role authenticated;
    select count(*) into count_rows from storage.objects where id=object_id;
    if count_rows<>0 then raise exception 'TEST_STORAGE_CROSS_OWNER_READ'; end if;
    begin insert into storage.objects(bucket_id,name,owner_id) values('hisab-receipts-v1',object_name,a::text); raise exception 'TEST_STORAGE_CROSS_OWNER_WRITE';
    exception when insufficient_privilege then null; end;
    reset role;
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','{}',true);
    set local role anon;
    select count(*) into count_rows from storage.objects where id=object_id;
    if count_rows<>0 then raise exception 'TEST_STORAGE_ANONYMOUS_READ'; end if;
    begin insert into storage.objects(bucket_id,name,owner_id) values('hisab-receipts-v1',object_name,a::text); raise exception 'TEST_STORAGE_ANONYMOUS_WRITE';
    exception when insufficient_privilege then null; end;
    -- Force deferred journal validation before the intentional fixture rollback.
    reset role;
    perform set_config('request.jwt.claim.sub',a::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
    set constraints all immediate;
    raise exception using errcode='ZX001',message='HISAB_SYNTHETIC_FIXTURE_ROLLBACK';
  exception when sqlstate 'ZX001' then null;
  end;
  if (select count(*) from auth.users)<>auth_before
    or (select count(*) from hisab_cloud.journal_transactions)<>journals_before
    or (select count(*) from hisab_cloud.workspaces)<>workspaces_before
    or (select count(*) from hisab_cloud.profiles)<>profiles_before
    or (select count(*) from storage.objects)<>storage_before
  then raise exception 'TEST_FIXTURE_CLEANUP_FAILED'; end if;
end $test$;
select 'HISAB_SQL_ROLLBACK_PASS' as result;
