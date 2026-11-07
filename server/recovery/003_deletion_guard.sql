create or replace function public.hisab_live_put(p_dataset uuid,p_expected text,p_core_text text,p_sha256 text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); h hisab_recovery.live_heads; previous jsonb; incoming jsonb; collection text;
 old_map jsonb;new_map jsonb;item record;body jsonb;line jsonb;debits numeric;credits numeric;line_map jsonb;
begin
 if actor is null then raise exception 'LIVE_AUTH_REQUIRED'; end if;
 if p_dataset is null or p_expected is null or p_expected!~'^(0|[1-9][0-9]{0,18})$' or p_expected::numeric>9223372036854775806 or
    p_core_text is null or octet_length(p_core_text) not between 1 and 41943040 or p_sha256 is null or
    p_sha256<>encode(sha256(convert_to(p_core_text,'UTF8')),'hex') then raise exception 'LIVE_INVALID';end if;
 incoming:=p_core_text::jsonb;
 if incoming->>'schemaVersion' is distinct from '6' then raise exception 'LIVE_VERSION';end if;
 foreach collection in array array['workspaces','accounts','accountGroups','accountPermissions','categories','parties','journalTransactions','journalLines','syncOperations','budgets','recurringRules','recurringOccurrences','receiptBlobs'] loop
   if jsonb_typeof(incoming->collection) is distinct from 'array' then raise exception 'LIVE_INVALID';end if;
 end loop;
 -- Independently reject fractional/unsafe postings and incomplete journal copies.
 select coalesce(jsonb_object_agg(e->>0,e->1),'{}'::jsonb) into line_map from jsonb_array_elements(incoming->'journalLines') e;
 for item in select e->>0 as key,e->1 as value from jsonb_array_elements(incoming->'journalTransactions') e loop
   body:=item.value;debits:=0;credits:=0;
   if body->>'id' is distinct from item.key or jsonb_typeof(body->'lines') is distinct from 'array' or jsonb_array_length(body->'lines')<2 then raise exception 'LIVE_LEDGER';end if;
   for line in select * from jsonb_array_elements(body->'lines') loop
     if jsonb_typeof(line->'debitMinor') is distinct from 'string' or jsonb_typeof(line->'creditMinor') is distinct from 'string' or
        line->>'debitMinor'!~'^(0|[1-9][0-9]*)$' or line->>'creditMinor'!~'^(0|[1-9][0-9]*)$' or
        (line->>'debitMinor')::numeric>9223372036854775807 or (line->>'creditMinor')::numeric>9223372036854775807 or
        line->>'transactionId' is distinct from item.key or line_map->(line->>'id') is distinct from line then raise exception 'LIVE_LEDGER';end if;
     debits:=debits+(line->>'debitMinor')::numeric;credits:=credits+(line->>'creditMinor')::numeric;
   end loop;
   if debits<>credits then raise exception 'LIVE_LEDGER';end if;
 end loop;
 -- A retained permanent account deletion dominates stale rows and old backups.
 for item in select e->1 as value from jsonb_array_elements(incoming->'syncOperations') e where e->1->>'type'='account.delete' loop
   body:=item.value;
   if jsonb_typeof(body#>'{payload,id}') is distinct from 'string' or body#>>'{payload,id}'='' or
      body->>'entityId' is distinct from body#>>'{payload,id}' then raise exception 'LIVE_INVALID';end if;
   if exists(select 1 from jsonb_array_elements(incoming->'accounts') a where a->>0=body#>>'{payload,id}') then
     raise exception 'LIVE_DELETED_ACCOUNT';
   end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,834701));
 select * into h from hisab_recovery.live_heads where owner_id=actor;
 if found then
   if h.dataset_id<>p_dataset then raise exception 'LIVE_OTHER_DATASET';end if;
   if h.revision::text<>p_expected then return jsonb_build_object('kind','stale','head',public.hisab_live_head());end if;
   select core_text::jsonb into previous from hisab_recovery.live_documents where owner_id=actor;
   if previous->'localIdentity' is distinct from incoming->'localIdentity' then raise exception 'LIVE_OWNER_MISMATCH';end if;
   foreach collection in array array['journalTransactions','journalLines','syncOperations'] loop
     select coalesce(jsonb_object_agg(e->>0,e->1),'{}'::jsonb) into old_map from jsonb_array_elements(previous->collection) e;
     select coalesce(jsonb_object_agg(e->>0,e->1),'{}'::jsonb) into new_map from jsonb_array_elements(incoming->collection) e;
     for item in select key,value from jsonb_each(old_map) loop
       body:=new_map->item.key;
       if body is null or (case when collection='journalTransactions' then item.value-'isDeleted'-'isReplacedBy' else item.value end)
          is distinct from (case when collection='journalTransactions' then body-'isDeleted'-'isReplacedBy' else body end) then
         raise exception 'LIVE_IMMUTABLE';
       end if;
     end loop;
   end loop;
   if h.sha256=p_sha256 then return jsonb_build_object('kind','accepted','head',public.hisab_live_head());end if;
   update hisab_recovery.live_documents set core_text=p_core_text where owner_id=actor;
   update hisab_recovery.live_heads set revision=revision+1,sha256=p_sha256,updated_at=clock_timestamp() where owner_id=actor;
 else
   if p_expected<>'0' then raise exception 'LIVE_REVISION';end if;
   if not exists(select 1 from hisab_recovery.snapshots where owner_id=actor and dataset_id=p_dataset) then raise exception 'LIVE_BACKUP_REQUIRED';end if;
   insert into hisab_recovery.live_heads(owner_id,dataset_id,revision,sha256) values(actor,p_dataset,1,p_sha256);
   insert into hisab_recovery.live_documents(owner_id,dataset_id,core_text) values(actor,p_dataset,p_core_text);
 end if;
 return jsonb_build_object('kind','accepted','head',public.hisab_live_head());
end;
$$;
