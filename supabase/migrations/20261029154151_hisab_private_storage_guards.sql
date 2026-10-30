-- Additive protection for NEW Hisab buckets in the shared development project.
-- Existing permissive policies are left intact. Restrictive policies are needed
-- because permissive policies combine with OR, including unrelated-app policies.
begin;
create function hisab_internal.storage_permitted(p_bucket text,p_name text,p_object_owner text,p_write boolean)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); parts text[];
begin
  if p_bucket not in ('hisab-receipts-v1','hisab-workspace-images-v1') then return true; end if;
  if actor is null or p_object_owner is distinct from actor::text then return false; end if;
  if p_name is null or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.(jpg|png|webp)$' then return false; end if;
  parts:=string_to_array(p_name,'/');
  if parts[1]<>actor::text then return false; end if;
  return exists(select 1 from hisab_cloud.workspaces w where w.id=parts[2]::uuid
    and w.owner_id=actor and (not p_write or w.archived_at is null));
exception when invalid_text_representation then return false;
end $$;
revoke all on function hisab_internal.storage_permitted(text,text,text,boolean) from public,anon,authenticated;
-- Anonymous execution returns false for Hisab before touching its private tables.
-- For every other bucket it returns true, preserving that bucket's prior rules.
grant usage on schema hisab_internal to anon;
grant execute on function hisab_internal.storage_permitted(text,text,text,boolean) to anon,authenticated;

create policy hisab_storage_read_guard on storage.objects as restrictive for select to anon,authenticated
  using(hisab_internal.storage_permitted(bucket_id,name,owner_id,false));
create policy hisab_storage_insert_guard on storage.objects as restrictive for insert to anon,authenticated
  with check(hisab_internal.storage_permitted(bucket_id,name,owner_id,true));
create policy hisab_storage_update_guard on storage.objects as restrictive for update to anon,authenticated
  using(bucket_id not in ('hisab-receipts-v1','hisab-workspace-images-v1'))
  with check(bucket_id not in ('hisab-receipts-v1','hisab-workspace-images-v1'));
create policy hisab_storage_delete_guard on storage.objects as restrictive for delete to anon,authenticated
  using(bucket_id not in ('hisab-receipts-v1','hisab-workspace-images-v1'));

create policy hisab_storage_owner_read on storage.objects for select to authenticated
  using(bucket_id in ('hisab-receipts-v1','hisab-workspace-images-v1') and hisab_internal.storage_permitted(bucket_id,name,owner_id,false));
create policy hisab_storage_owner_insert on storage.objects for insert to authenticated
  with check(bucket_id in ('hisab-receipts-v1','hisab-workspace-images-v1') and hisab_internal.storage_permitted(bucket_id,name,owner_id,true));

-- Metadata only; bytes are uploaded through the Storage service, never SQL.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('hisab-receipts-v1','hisab-receipts-v1',false,2097152,array['image/jpeg','image/png','image/webp']),
  ('hisab-workspace-images-v1','hisab-workspace-images-v1',false,2097152,array['image/jpeg','image/png','image/webp']);
commit;
