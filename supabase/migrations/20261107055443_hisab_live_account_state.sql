-- One canonical dataset per verified customer; private document + small Realtime head.
create table hisab_recovery.live_heads (
 owner_id uuid primary key references auth.users(id), dataset_id uuid not null,
 revision bigint not null check(revision>0), sha256 text not null check(sha256~'^[0-9a-f]{64}$'),
 updated_at timestamptz not null default clock_timestamp(), unique(owner_id,dataset_id)
);
create table hisab_recovery.live_documents (
 owner_id uuid primary key references auth.users(id), dataset_id uuid not null,
 core_text text not null check(octet_length(core_text) between 1 and 41943040),
 foreign key(owner_id,dataset_id) references hisab_recovery.live_heads(owner_id,dataset_id)
);
alter table hisab_recovery.live_heads enable row level security;
alter table hisab_recovery.live_heads force row level security;
alter table hisab_recovery.live_documents enable row level security;
alter table hisab_recovery.live_documents force row level security;
create policy live_head_owner on hisab_recovery.live_heads to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy live_document_owner on hisab_recovery.live_documents to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on hisab_recovery.live_heads,hisab_recovery.live_documents from public,anon,authenticated;
grant select,insert,update on hisab_recovery.live_heads,hisab_recovery.live_documents to authenticated;

create function public.hisab_live_head() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('dataset_id',dataset_id,'revision',revision::text,'sha256',sha256,'updated_at',updated_at)
 from hisab_recovery.live_heads where owner_id=auth.uid();
$$;
create function public.hisab_live_get() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('head',public.hisab_live_head(),'core_text',core_text)
 from hisab_recovery.live_documents where owner_id=auth.uid();
$$;
create function public.hisab_live_put(p_dataset uuid,p_expected text,p_core_text text,p_sha256 text) returns jsonb
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
revoke all on function public.hisab_live_head(),public.hisab_live_get(),public.hisab_live_put(uuid,text,text,text) from public,anon;
grant execute on function public.hisab_live_head(),public.hisab_live_get(),public.hisab_live_put(uuid,text,text,text) to authenticated;
-- Hosted notification adapter only: no financial document is published.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
   alter publication supabase_realtime add table hisab_recovery.live_heads;
 end if;
end $$;
