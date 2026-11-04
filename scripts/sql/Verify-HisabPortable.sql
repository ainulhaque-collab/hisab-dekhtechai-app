-- Hosted development verification only: synthetic fixtures, always ROLLBACK.
begin;
do $$ begin
  if exists(select 1 from auth.users where id in ('f1140000-0000-4000-8000-000000000001','f1140000-0000-4000-8000-000000000002'))
  then raise exception 'HISAB_QA_FIXTURE_COLLISION'; end if;
end $$;
insert into auth.users(id) values('f1140000-0000-4000-8000-000000000001'),('f1140000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1140000-0000-4000-8000-000000000001',true);
select set_config('hisab.actor_id','f1140000-0000-4000-8000-000000000001',true);
insert into hisab_cloud.workspaces(id,owner_id,name,kind) values('f1140000-0000-4000-8000-000000000011','f1140000-0000-4000-8000-000000000001','Synthetic portability QA','personal');
insert into hisab_cloud.accounts(id,owner_id,workspace_id,name,kind,classification,system_code) values
 ('f1140000-0000-4000-8000-000000000021','f1140000-0000-4000-8000-000000000001','f1140000-0000-4000-8000-000000000011','QA cash','cash','asset',null),
 ('f1140000-0000-4000-8000-000000000022','f1140000-0000-4000-8000-000000000001','f1140000-0000-4000-8000-000000000011','QA revenue','other','revenue','revenue_clearing'),
 ('f1140000-0000-4000-8000-000000000023','f1140000-0000-4000-8000-000000000001','f1140000-0000-4000-8000-000000000011','QA equity','other','equity','opening_equity');
insert into hisab_cloud.categories(id,owner_id,workspace_id,kind,name) values('f1140000-0000-4000-8000-000000000031','f1140000-0000-4000-8000-000000000001','f1140000-0000-4000-8000-000000000011','income','Synthetic income');
do $$ declare lines jsonb; result jsonb; begin
  lines:='[{"id":"f1140000-0000-4000-8000-000000000051","accountId":"f1140000-0000-4000-8000-000000000021","debitMinor":"9007199254740993","creditMinor":"0"},{"id":"f1140000-0000-4000-8000-000000000052","accountId":"f1140000-0000-4000-8000-000000000022","categoryId":"f1140000-0000-4000-8000-000000000031","debitMinor":"0","creditMinor":"9007199254740993"}]';
  result:=hisab_cloud.post_journal('f1140000-0000-4000-8000-000000000011','f1140000-0000-4000-8000-000000000041','f1140000-0000-4000-8000-000000000042','f1140000-0000-4000-8000-000000000043','income','2026-11-04','2026-11-04T08:00:00Z',lines);
  if (result->>'replayed')::boolean then raise exception 'HISAB_QA_INITIAL_REPLAY'; end if;
  result:=hisab_cloud.post_journal('f1140000-0000-4000-8000-000000000011','f1140000-0000-4000-8000-000000000041','f1140000-0000-4000-8000-000000000042','f1140000-0000-4000-8000-000000000043','income','2026-11-04','2026-11-04T08:00:00Z',lines);
  if not (result->>'replayed')::boolean then raise exception 'HISAB_QA_REPLAY_FAILED'; end if;
  if (select debit_minor from hisab_cloud.journal_lines where id='f1140000-0000-4000-8000-000000000051')<>9007199254740993::numeric
  then raise exception 'HISAB_QA_PRECISION'; end if;
  begin
    perform hisab_cloud.post_journal('f1140000-0000-4000-8000-000000000011','f1140000-0000-4000-8000-000000000061','f1140000-0000-4000-8000-000000000062','f1140000-0000-4000-8000-000000000043','income','2026-11-04','2026-11-04T08:00:00Z',replace(lines::text,'9007199254740993','9223372036854775808')::jsonb);
    raise exception 'HISAB_QA_OVERFLOW_ACCEPTED';
  exception when check_violation then null; end;
  begin
    perform hisab_cloud.post_journal('f1140000-0000-4000-8000-000000000011','f1140000-0000-4000-8000-000000000071','f1140000-0000-4000-8000-000000000072','f1140000-0000-4000-8000-000000000043','opening','2026-11-04','2026-11-04T08:00:00Z',
      '[{"id":"f1140000-0000-4000-8000-000000000073","accountId":"f1140000-0000-4000-8000-000000000021","debitMinor":"0","creditMinor":"1"},{"id":"f1140000-0000-4000-8000-000000000074","accountId":"f1140000-0000-4000-8000-000000000023","debitMinor":"1","creditMinor":"0"}]');
    execute 'set constraints all immediate'; raise exception 'HISAB_QA_OPENING_DIRECTION_ACCEPTED';
  exception when check_violation then null; end;
end $$;
set constraints all immediate;
set constraints all deferred;
insert into hisab_cloud.media_objects(id,owner_id,workspace_id,kind,object_key,content_sha256,content_type,byte_length) values
 ('f1140000-0000-4000-8000-000000000081','f1140000-0000-4000-8000-000000000001','f1140000-0000-4000-8000-000000000011','receipt',
 'f1140000-0000-4000-8000-000000000001/f1140000-0000-4000-8000-000000000011/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg',repeat('a',64),'image/jpeg',100);
select set_config('request.jwt.claim.sub','f1140000-0000-4000-8000-000000000002',true);
select set_config('hisab.actor_id','f1140000-0000-4000-8000-000000000002',true);
do $$ begin
  if exists(select 1 from hisab_cloud.workspaces) or exists(select 1 from hisab_cloud.media_objects) or exists(select 1 from hisab_cloud.journal_lines)
  then raise exception 'HISAB_QA_FOREIGN_DATA_VISIBLE'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform * from hisab_cloud.media_objects; raise exception 'HISAB_QA_ANON_VISIBLE';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'HISAB_PORTABLE_ROLLBACK_PASS' as result;
