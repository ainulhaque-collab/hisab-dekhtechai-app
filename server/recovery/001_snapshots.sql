-- Portable recovery snapshots. Does not activate the incomplete ledger sync engine.
create schema hisab_recovery;
revoke all on schema hisab_recovery from public, anon;
grant usage on schema hisab_recovery to authenticated;
create table hisab_recovery.snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  dataset_id uuid not null,
  device_id uuid not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  backup_text text not null check (octet_length(backup_text) between 1 and 41943040),
  created_at timestamptz not null default clock_timestamp(),
  unique(owner_id,dataset_id,device_id,sha256)
);
create index snapshots_owner_created on hisab_recovery.snapshots(owner_id,created_at desc,id);
alter table hisab_recovery.snapshots enable row level security;
alter table hisab_recovery.snapshots force row level security;
create policy snapshots_read on hisab_recovery.snapshots for select to authenticated using(owner_id=(select auth.uid()));
create policy snapshots_insert on hisab_recovery.snapshots for insert to authenticated with check(owner_id=(select auth.uid()));
create policy snapshots_retention on hisab_recovery.snapshots for delete to authenticated using(owner_id=(select auth.uid()));
revoke all on hisab_recovery.snapshots from public,anon,authenticated;
grant select,insert,delete on hisab_recovery.snapshots to authenticated;

create function public.hisab_recovery_list() returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id),'[]'::jsonb) from
    (select id,dataset_id,device_id,sha256,created_at from hisab_recovery.snapshots
     where owner_id=auth.uid() order by created_at desc,id limit 30) s;
$$;
create function public.hisab_recovery_get(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select to_jsonb(s)-'owner_id' from hisab_recovery.snapshots s where s.id=p_id and s.owner_id=auth.uid();
$$;
create function public.hisab_recovery_put(p_dataset uuid,p_device uuid,p_text text,p_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); result hisab_recovery.snapshots; document jsonb;
begin
  if actor is null then raise exception 'RECOVERY_AUTH_REQUIRED'; end if;
  if p_dataset is null or p_device is null or p_text is null or octet_length(p_text) not between 1 and 41943040 or
     p_sha256 is null or p_sha256<>encode(sha256(convert_to(p_text,'UTF8')),'hex') then
    raise exception 'RECOVERY_CHECKSUM';
  end if;
  document:=p_text::jsonb;
  if document->>'format' is distinct from 'hisab-backup' or document->>'version' is distinct from '1' or
     jsonb_typeof(document->'dataJson') is distinct from 'string' or document->>'sha256' is null or
     document->>'sha256' is distinct from encode(sha256(convert_to(document->>'dataJson','UTF8')),'hex') then
    raise exception 'RECOVERY_FORMAT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,712922));
  select * into result from hisab_recovery.snapshots where owner_id=actor and dataset_id=p_dataset and device_id=p_device and sha256=p_sha256;
  if found then return to_jsonb(result)-'owner_id'-'backup_text'; end if;
  insert into hisab_recovery.snapshots(owner_id,dataset_id,device_id,sha256,backup_text)
    values(actor,p_dataset,p_device,p_sha256,p_text) returning * into result;
  -- Keep three complete generations per dataset/device. Never remove another device's copy.
  delete from hisab_recovery.snapshots where id in
    (select id from hisab_recovery.snapshots where owner_id=actor and dataset_id=p_dataset and device_id=p_device
     order by created_at desc,id offset 3);
  if (select count(*)>30 or coalesce(sum(octet_length(backup_text)),0)>134217728 from hisab_recovery.snapshots where owner_id=actor) then
    raise exception 'RECOVERY_LIMIT'; -- Whole call rolls back, retaining previous copies.
  end if;
  return to_jsonb(result)-'owner_id'-'backup_text';
end;
$$;
revoke all on function public.hisab_recovery_list(),public.hisab_recovery_get(uuid),public.hisab_recovery_put(uuid,uuid,text,text) from public,anon;
grant execute on function public.hisab_recovery_list(),public.hisab_recovery_get(uuid),public.hisab_recovery_put(uuid,uuid,text,text) to authenticated;
