-- Forward-only Hisab change. Existing journals are never rewritten or truncated.
-- Preserve exact NUMERIC integer checks: casting fractional NUMERIC to BIGINT rounds.
begin;
alter table hisab_cloud.journal_lines
  add constraint hisab_debit_int64 check(debit_minor<=9223372036854775807::numeric),
  add constraint hisab_credit_int64 check(credit_minor<=9223372036854775807::numeric);

-- Positive opening capital is an asset debit/equity credit, never a withdrawal.
create function hisab_internal.validate_opening_direction() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from hisab_cloud.journal_transactions t
    join hisab_cloud.journal_lines l on l.transaction_id=t.id
    join hisab_cloud.accounts a on a.id=l.account_id
    where t.id=new.transaction_id and t.transaction_type='opening' and
      ((a.classification='asset' and l.credit_minor>0) or (a.system_code='opening_equity' and l.debit_minor>0)))
  then raise exception 'HISAB_OPENING_DIRECTION_INVALID' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function hisab_internal.validate_opening_direction() from public,anon,authenticated;
create constraint trigger hisab_opening_direction after insert on hisab_cloud.journal_lines
  deferrable initially deferred for each row execute function hisab_internal.validate_opening_direction();

-- Portable references; binary objects stay in Supabase Storage, S3 or disk adapters.
create table hisab_cloud.media_objects (
  id uuid primary key,
  owner_id uuid not null,
  workspace_id uuid not null,
  kind text not null check(kind in ('receipt','workspace_image')),
  object_key text not null,
  content_sha256 text not null check(content_sha256~'^[0-9a-f]{64}$'),
  content_type text not null check(content_type in ('image/jpeg','image/png','image/webp')),
  byte_length integer not null check(byte_length between 1 and 2097152),
  created_at timestamptz not null default now(),
  foreign key(workspace_id,owner_id) references hisab_cloud.workspaces(id,owner_id),
  unique(owner_id,kind,object_key),
  check(object_key=owner_id::text||'/'||workspace_id::text||'/'||content_sha256||
    case content_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end)
);
create index hisab_media_owner_workspace on hisab_cloud.media_objects(owner_id,workspace_id);
alter table hisab_cloud.media_objects enable row level security;
alter table hisab_cloud.media_objects force row level security;
revoke all on hisab_cloud.media_objects from public,anon,authenticated;
grant select on hisab_cloud.media_objects to authenticated;
grant insert(id,owner_id,workspace_id,kind,object_key,content_sha256,content_type,byte_length)
  on hisab_cloud.media_objects to authenticated;
create policy hisab_media_read on hisab_cloud.media_objects for select to authenticated
  using(owner_id=(select auth.uid()));
create policy hisab_media_insert on hisab_cloud.media_objects for insert to authenticated
  with check(owner_id=(select auth.uid()) and exists(select 1 from hisab_cloud.workspaces w
    where w.id=media_objects.workspace_id and w.owner_id=media_objects.owner_id and w.archived_at is null));
comment on table hisab_cloud.media_objects is 'Private portable object references; no binary uploads or financial cutover activated.';
comment on schema hisab_cloud is 'Hisab owner-scoped finance. Private Data API exposure remains unchanged; provider-neutral sync not yet activated.';
commit;
