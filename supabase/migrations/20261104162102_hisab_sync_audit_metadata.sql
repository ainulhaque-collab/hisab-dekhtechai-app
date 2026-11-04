-- Preserve v1 finance validation while retaining optional occurrence/audit metadata in the immutable log.
begin;
create function hisab_internal.sync_command_core_v1(op jsonb,actor uuid,ws uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare p jsonb:=op->'payload';r jsonb;j jsonb;tx jsonb;l jsonb;lines jsonb:='[]';aid uuid;code text;
begin
  if op->>'type'='workspace.create' then
    r:=p->'workspace';
    if jsonb_typeof(r) is distinct from 'object' or not hisab_internal.sync_uuid(r->>'id') or (r->>'id')::uuid<>ws or (op->>'entityId')::uuid<>ws or r->>'ownerSubjectHash' is distinct from actor::text or
      not hisab_internal.sync_text(r->'name',1,120) or not hisab_internal.sync_text(r->'description',0,1000,true) or not hisab_internal.sync_instant(r->>'createdAt') or
      r->>'currency' is distinct from 'BDT' or r->>'kind' not in ('personal','business') or length(btrim(r->>'name')) not between 1 and 120 or
      exists(select 1 from jsonb_object_keys(p) k where k<>'workspace') or
      exists(select 1 from jsonb_object_keys(r) k where k not in ('id','ownerSubjectHash','name','description','kind','currency','createdAt','archivedAt','deletedAt')) or
      r->>'archivedAt' is not null or r->>'deletedAt' is not null then raise exception 'SYNC_COMMAND_INVALID' using errcode='23514';end if;
    insert into hisab_cloud.workspaces(id,owner_id,name,description,kind) values(ws,actor,r->>'name',r->>'description',r->>'kind');
  else
    if not exists(select 1 from hisab_cloud.workspaces where id=ws and owner_id=actor and archived_at is null) then raise exception 'SYNC_DEPENDENCY' using errcode='23503';end if;
    if op->>'type'='account.create' then
      r:=p->'account';
      if jsonb_typeof(r) is distinct from 'object' or not hisab_internal.sync_uuid(r->>'id') or r->>'id' is distinct from op->>'entityId' or r->>'workspaceId' is distinct from ws::text or
        not hisab_internal.sync_text(r->'name',1,120) or not hisab_internal.sync_text(r->'accountNumberMasked',0,80,true) or not hisab_internal.sync_instant(r->>'createdAt') or
        r->>'kind' not in ('cash','bank','bkash','nagad','rocket','other') or
        r->>'classification' is distinct from 'asset' or r->'openingBalanceMinor' is distinct from '"0"'::jsonb or r->>'groupId' is not null or r->>'archivedAt' is not null or
        exists(select 1 from jsonb_object_keys(p) k where k<>'account') or exists(select 1 from jsonb_object_keys(r) k where k not in
        ('id','workspaceId','groupId','name','kind','classification','openingBalanceMinor','accountNumberMasked','createdAt','archivedAt')) then raise exception 'SYNC_COMMAND_INVALID' using errcode='23514';end if;
      insert into hisab_cloud.accounts(id,owner_id,workspace_id,name,kind,classification)
        values((r->>'id')::uuid,actor,ws,r->>'name',r->>'kind','asset');
    elsif op->>'type'='category.create' then
      r:=p->'category';
      if jsonb_typeof(r) is distinct from 'object' or not hisab_internal.sync_uuid(r->>'id') or r->>'id' is distinct from op->>'entityId' or r->>'workspaceId' is distinct from ws::text or r->>'archivedAt' is not null or
        (r->>'parentId' is not null and not hisab_internal.sync_uuid(r->>'parentId')) or
        not hisab_internal.sync_text(r->'name',1,120) or not hisab_internal.sync_text(r->'nameEn',0,120,true) or
        not hisab_internal.sync_text(r->'icon',0,120,true) or not hisab_internal.sync_text(r->'color',0,120,true) or
        exists(select 1 from jsonb_object_keys(p) k where k<>'category') or exists(select 1 from jsonb_object_keys(r) k where k not in
        ('id','workspaceId','parentId','kind','name','nameEn','icon','color','archivedAt')) then raise exception 'SYNC_COMMAND_INVALID' using errcode='23514';end if;
      insert into hisab_cloud.categories(id,owner_id,workspace_id,parent_id,kind,name) values((r->>'id')::uuid,actor,ws,(r->>'parentId')::uuid,r->>'kind',r->>'name');
    elsif op->>'type'='journal.post' then
      j:=p->'balancedJournal';tx:=j->'transaction';
      if jsonb_typeof(j) is distinct from 'object' or jsonb_typeof(tx) is distinct from 'object' or jsonb_typeof(j->'lines') is distinct from 'array' or
        not hisab_internal.sync_uuid(tx->>'id') or tx->>'id' is distinct from op->>'entityId' or tx->>'workspaceId' is distinct from ws::text or tx->>'createdOpId' is distinct from op->>'operationId' or
        not hisab_internal.sync_instant(tx->>'occurredAtUtc') or not hisab_internal.sync_text(tx->'note',0,1000,true) or
        jsonb_typeof(tx->'effectiveDate') is distinct from 'string' or (tx->>'effectiveDate')!~'^\d{4}-\d\d-\d\d$' or
        tx->>'partyId' is not null or tx->>'receiptBlobSha256' is not null or tx->>'receiptName' is not null or tx->>'reversalOf' is not null or
        (tx?'isDeleted' and tx->'isDeleted' is distinct from 'false'::jsonb) or tx->>'isReplacedBy' is not null or
        exists(select 1 from jsonb_object_keys(p) k where k<>'balancedJournal') or exists(select 1 from jsonb_object_keys(j) k where k not in ('transaction','lines')) or
        exists(select 1 from jsonb_object_keys(tx) k where k not in ('id','workspaceId','transactionType','effectiveDate','occurredAtUtc','note','createdOpId','partyId','receiptBlobSha256','receiptName','reversalOf','isDeleted','isReplacedBy'))
      then raise exception 'SYNC_COMMAND_INVALID' using errcode='23514';end if;
      -- Internal nominal accounts are derived server-side; the immutable wire retains local system IDs.
      foreach code in array array['opening_equity','revenue_clearing','expense_clearing'] loop
        insert into hisab_cloud.accounts(id,owner_id,workspace_id,name,kind,classification,system_code)
          values(gen_random_uuid(),actor,ws,code,'other',case code when 'opening_equity' then 'equity' when 'revenue_clearing' then 'revenue' else 'expense' end,code)
          on conflict(workspace_id,system_code) where system_code is not null do nothing;
      end loop;
      for l in select value from jsonb_array_elements(j->'lines') loop
        if not hisab_internal.sync_uuid(l->>'id') or l->>'transactionId' is distinct from tx->>'id' or
          (l->>'categoryId' is not null and not hisab_internal.sync_uuid(l->>'categoryId')) or exists(select 1 from jsonb_object_keys(l) k where k not in ('id','transactionId','accountId','debitMinor','creditMinor','categoryId')) then raise exception 'SYNC_LINE_INVALID' using errcode='23514';end if;
        code:=case l->>'accountId' when '__system__opening_equity' then 'opening_equity' when '__system__revenue_clearing' then 'revenue_clearing' when '__system__expense_clearing' then 'expense_clearing' else null end;
        if code is null then
          if not hisab_internal.sync_uuid(l->>'accountId') then raise exception 'SYNC_LINE_INVALID' using errcode='23514';end if;
          aid:=(l->>'accountId')::uuid;
          if not exists(select 1 from hisab_cloud.accounts where id=aid and workspace_id=ws and owner_id=actor and classification='asset' and system_code is null and archived_at is null)
          then raise exception 'SYNC_ASSET_REFERENCE_INVALID' using errcode='23514';end if;
        else select id into aid from hisab_cloud.accounts where workspace_id=ws and owner_id=actor and system_code=code;end if;
        if tx->>'transactionType'='opening' and ((code='opening_equity' and (l->>'debitMinor')::numeric>0) or
          (code is null and (l->>'creditMinor')::numeric>0)) then raise exception 'SYNC_OPENING_INVALID' using errcode='23514';end if;
        lines:=lines||jsonb_build_array(jsonb_build_object('id',l->>'id','accountId',aid,'categoryId',l->>'categoryId','debitMinor',l->'debitMinor','creditMinor',l->'creditMinor'));
      end loop;
      perform hisab_cloud.post_journal(ws,(op->>'operationId')::uuid,(tx->>'id')::uuid,(op->>'deviceId')::uuid,tx->>'transactionType',(tx->>'effectiveDate')::date,(tx->>'occurredAtUtc')::timestamptz,lines,tx->>'note');
    else raise exception 'SYNC_COMMAND_UNSUPPORTED' using errcode='23514';end if;
  end if;
end $$;


create or replace function hisab_internal.sync_command(op jsonb,actor uuid,ws uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare tx jsonb:=op#>'{payload,balancedJournal,transaction}'; normalized jsonb:=op; offset_minutes integer;
begin
  if op->>'type'='journal.post' and jsonb_typeof(tx)='object' then
    if tx?'createdAtUtc' and (jsonb_typeof(tx->'createdAtUtc') is distinct from 'string' or not hisab_internal.sync_instant(tx->>'createdAtUtc'))
      then raise exception 'SYNC_AUDIT_TIME_INVALID' using errcode='23514';end if;
    if tx?'occurredTimezoneOffsetMinutes' then
      if jsonb_typeof(tx->'occurredTimezoneOffsetMinutes') is distinct from 'number' or
        (tx->>'occurredTimezoneOffsetMinutes')::numeric<>trunc((tx->>'occurredTimezoneOffsetMinutes')::numeric) or
        abs((tx->>'occurredTimezoneOffsetMinutes')::numeric)>840 then raise exception 'SYNC_AUDIT_TIME_INVALID' using errcode='23514';end if;
      offset_minutes:=(tx->>'occurredTimezoneOffsetMinutes')::integer;
      if not hisab_internal.sync_instant(tx->>'occurredAtUtc') or
        (((tx->>'occurredAtUtc')::timestamptz at time zone 'UTC')-make_interval(mins=>offset_minutes))::date is distinct from (tx->>'effectiveDate')::date
        then raise exception 'SYNC_AUDIT_TIME_INVALID' using errcode='23514';end if;
    end if;
    normalized:=jsonb_set(op,'{payload,balancedJournal,transaction}',tx-'createdAtUtc'-'occurredTimezoneOffsetMinutes',false);
  end if;
  -- sync_push hashes/logs the ORIGINAL envelope; normalized is only the money-handler argument.
  perform hisab_internal.sync_command_core_v1(normalized,actor,ws);
end $$;
revoke all on function hisab_internal.sync_command_core_v1(jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function hisab_internal.sync_command_core_v1(jsonb,uuid,uuid) to authenticated;
revoke all on function hisab_internal.sync_command(jsonb,uuid,uuid) from public,anon;
comment on function hisab_internal.sync_command(jsonb,uuid,uuid) is 'Private bounded sync handler; audit fields stay immutable in sync_log, never dropped from the replay envelope.';
commit;
