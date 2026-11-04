-- Private protocol foundation. No Data API exposure or client migration is enabled.
begin;
create table hisab_cloud.sync_heads (
  owner_id uuid not null,workspace_id uuid not null,head bigint not null default 0 check(head>=0),
  primary key(owner_id,workspace_id),foreign key(workspace_id,owner_id) references hisab_cloud.workspaces(id,owner_id)
);
create table hisab_cloud.sync_log (
  owner_id uuid not null,workspace_id uuid not null,server_seq bigint not null check(server_seq>0),
  operation_id uuid not null,device_id uuid not null,device_seq bigint not null check(device_seq>0),
  content_sha256 text not null check(content_sha256~'^[0-9a-f]{64}$'),envelope jsonb not null,
  primary key(owner_id,operation_id),unique(owner_id,workspace_id,server_seq),unique(owner_id,workspace_id,device_id,device_seq),
  foreign key(workspace_id,owner_id) references hisab_cloud.workspaces(id,owner_id),
  check(envelope->>'operationId'=operation_id::text and envelope->>'workspaceId'=workspace_id::text and
    envelope->>'deviceId'=device_id::text and envelope->>'sequence'=device_seq::text and envelope->>'contentSha256'=content_sha256)
);
do $$ declare t text;begin
  foreach t in array array['sync_heads','sync_log'] loop
    execute format('alter table hisab_cloud.%I enable row level security',t);
    execute format('alter table hisab_cloud.%I force row level security',t);
    execute format('revoke all on hisab_cloud.%I from public,anon,authenticated',t);
    execute format('grant select,insert on hisab_cloud.%I to authenticated',t);
    execute format('create policy hisab_sync_read on hisab_cloud.%I for select to authenticated using(owner_id=(select auth.uid()))',t);
    execute format('create policy hisab_sync_insert on hisab_cloud.%I for insert to authenticated with check(owner_id=(select auth.uid()))',t);
  end loop;
end $$;
grant update(head) on hisab_cloud.sync_heads to authenticated;
create policy hisab_sync_head_update on hisab_cloud.sync_heads for update to authenticated
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create trigger hisab_sync_log_immutable before update or delete on hisab_cloud.sync_log
  for each row execute function hisab_internal.immutable_journal();

create function hisab_internal.wire_json(p jsonb) returns text language plpgsql immutable security invoker set search_path='' as $$
declare result text;begin
  case jsonb_typeof(p)
    when 'object' then
      if exists(select 1 from jsonb_object_keys(p) k where k!~'^[A-Za-z0-9_]+$') then raise exception 'SYNC_PAYLOAD_INVALID' using errcode='23514';end if;
      select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||hisab_internal.wire_json(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(p);
    when 'array' then select '['||coalesce(string_agg(hisab_internal.wire_json(value),',' order by ordinal),'')||']' into result from jsonb_array_elements(p) with ordinality x(value,ordinal);
    when 'number' then
      if (p::text)::numeric<>trunc((p::text)::numeric) or abs((p::text)::numeric)>9007199254740991 then raise exception 'SYNC_NUMBER_INVALID' using errcode='23514';end if;
      result:=trunc((p::text)::numeric)::text;
    else result:=p::text;
  end case;return result;
end $$;

create function hisab_internal.sync_uuid(s text) returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(s~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
$$;
create function hisab_internal.sync_text(v jsonb,lo integer,hi integer,optional boolean default false) returns boolean language sql immutable security invoker set search_path='' as $$
  select case when v is null or v='null'::jsonb then optional else jsonb_typeof(v)='string' and length(v#>>'{}') between lo and hi
    and (lo=0 or length(btrim(v#>>'{}',U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>0) end
$$;
create function hisab_internal.sync_instant(s text) returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  return coalesce(s~'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$' and to_char(s::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=s,false);
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;

create function hisab_internal.sync_command(op jsonb,actor uuid,ws uuid) returns void
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

create function hisab_cloud.sync_push(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();ws uuid;device uuid;op jsonb;previous hisab_cloud.sync_log;seq bigint;outcome text;outcomes jsonb:='[]';digest text;
begin
  if actor is null or p_request->'scope'->>'ownerId' is distinct from actor::text then raise exception 'SYNC_AUTH_REQUIRED' using errcode='42501';end if;
  ws:=(p_request->'scope'->>'workspaceId')::uuid;device:=(p_request->'scope'->>'deviceId')::uuid;
  if not hisab_internal.sync_uuid(ws::text) or not hisab_internal.sync_uuid(device::text) or not hisab_internal.sync_uuid(p_request->>'requestId') or jsonb_typeof(p_request->'operations') is distinct from 'array' or
    jsonb_array_length(p_request->'operations')>100 or octet_length(p_request::text)>1048576 then raise exception 'SYNC_REQUEST_INVALID' using errcode='23514';end if;
  -- Unlike an identity sequence, this lock keeps workspace cursor order aligned with commit order.
  perform pg_advisory_xact_lock(hashtextextended('hisab-sync-v1:'||actor::text||ws::text,0));
  for op in select value from jsonb_array_elements(p_request->'operations') loop
    begin
      if jsonb_typeof(op) is distinct from 'object' or op->'protocolVersion' is distinct from '1'::jsonb or
        op->>'workspaceId' is distinct from ws::text or op->>'deviceId' is distinct from device::text or
        jsonb_typeof(op->'sequence') is distinct from 'string' or (op->>'sequence')!~'^[1-9][0-9]{0,18}$' or (op->>'sequence')::numeric>9223372036854775807 or
        not hisab_internal.sync_uuid(op->>'operationId') or not hisab_internal.sync_uuid(op->>'entityId') or
        not hisab_internal.sync_instant(op->>'createdAtUtc') or
        op->>'createdAtUtc' is null or (op->>'createdAtUtc')!~'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$' or jsonb_typeof(op->'payload') is distinct from 'object' or
        octet_length(op::text)>65536 or exists(select 1 from jsonb_object_keys(op) k where k not in
        ('protocolVersion','operationId','workspaceId','deviceId','sequence','entityId','type','createdAtUtc','payload','contentSha256'))
      then raise exception 'SYNC_ENVELOPE_INVALID' using errcode='23514';end if;
      digest:=encode(sha256(convert_to(hisab_internal.wire_json(op-'contentSha256'),'UTF8')),'hex');
      if op->>'contentSha256' is distinct from digest then raise exception 'SYNC_HASH_INVALID' using errcode='23514';end if;
      select * into previous from hisab_cloud.sync_log where owner_id=actor and operation_id=(op->>'operationId')::uuid;
      if found then outcome:=case when previous.envelope=op then 'duplicate' else 'conflict' end;
      else
        perform hisab_internal.sync_command(op,actor,ws);
        insert into hisab_cloud.sync_heads(owner_id,workspace_id,head) values(actor,ws,0) on conflict do nothing;
        update hisab_cloud.sync_heads set head=head+1 where owner_id=actor and workspace_id=ws returning head into seq;
        insert into hisab_cloud.sync_log(owner_id,workspace_id,server_seq,operation_id,device_id,device_seq,content_sha256,envelope)
          values(actor,ws,seq,(op->>'operationId')::uuid,device,(op->>'sequence')::bigint,digest,op);
        outcome:='accepted';
      end if;
    exception when unique_violation then outcome:='conflict';
      when foreign_key_violation or insufficient_privilege then outcome:='retry';
      when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation or datetime_field_overflow or invalid_datetime_format then outcome:='rejected';
    end;
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('operationId',op->>'operationId','contentSha256',op->>'contentSha256','outcome',outcome));
  end loop;
  return jsonb_build_object('kind','remote','requestId',p_request->>'requestId','ownerId',actor,'workspaceId',ws,'outcomes',outcomes);
end $$;

create function hisab_cloud.sync_pull(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();ws uuid;head bigint;position bigint:=0;last_seq bigint;cap integer;parts text[];changes jsonb;
begin
  if actor is null or p_request->'scope'->>'ownerId' is distinct from actor::text then raise exception 'SYNC_AUTH_REQUIRED' using errcode='42501';end if;
  ws:=(p_request->'scope'->>'workspaceId')::uuid;cap:=(p_request->>'limit')::integer;
  if cap is null or cap not between 1 and 100 or p_request->>'requestId' is null or (p_request->>'requestId')::uuid is null or
    not exists(select 1 from hisab_cloud.workspaces where id=ws and owner_id=actor) then raise exception 'SYNC_SCOPE_INVALID' using errcode='42501';end if;
  if p_request->>'cursor' is not null then
    parts:=string_to_array(p_request->>'cursor',':');
    if array_length(parts,1)<>4 or parts[1]<>'h1' or parts[2]<>actor::text or parts[3]<>ws::text or parts[4]!~'^(0|[1-9][0-9]{0,18})$'
    then raise exception 'SYNC_CURSOR_INVALID' using errcode='23514';end if;position:=parts[4]::bigint;
  end if;
  select coalesce((select h.head from hisab_cloud.sync_heads h where h.owner_id=actor and h.workspace_id=ws),0) into head;
  if position>head then raise exception 'SYNC_CURSOR_AHEAD' using errcode='23514';end if;
  select coalesce(jsonb_agg(jsonb_build_object('changeId',server_seq::text,'operation',envelope) order by server_seq),'[]'),coalesce(max(server_seq),position)
    into changes,last_seq from(select server_seq,envelope from hisab_cloud.sync_log where owner_id=actor and workspace_id=ws and server_seq>position order by server_seq limit cap) page;
  if last_seq<head and jsonb_array_length(changes)=0 then raise exception 'SYNC_STREAM_GAP' using errcode='23514';end if;
  return jsonb_build_object('kind','remote','requestId',p_request->>'requestId','ownerId',actor,'workspaceId',ws,'previousCursor',p_request->'cursor',
    'nextCursor','h1:'||actor::text||':'||ws::text||':'||last_seq::text,'hasMore',last_seq<head,'changes',changes);
end $$;
revoke all on function hisab_internal.wire_json(jsonb),hisab_internal.sync_uuid(text),hisab_internal.sync_text(jsonb,integer,integer,boolean),hisab_internal.sync_instant(text),hisab_internal.sync_command(jsonb,uuid,uuid),hisab_cloud.sync_push(jsonb),hisab_cloud.sync_pull(jsonb) from public,anon,authenticated;
grant execute on function hisab_internal.wire_json(jsonb),hisab_internal.sync_uuid(text),hisab_internal.sync_text(jsonb,integer,integer,boolean),hisab_internal.sync_instant(text),hisab_internal.sync_command(jsonb,uuid,uuid),hisab_cloud.sync_push(jsonb),hisab_cloud.sync_pull(jsonb) to authenticated;
comment on table hisab_cloud.sync_log is 'Private append-only replay log; raw SQL/Data API exposure prohibited. Only bounded authenticated gateway calls sync_push/sync_pull.';
commit;
