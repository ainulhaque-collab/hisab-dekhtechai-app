-- Phase 1 only. No app cutover, public-schema/Auth changes or legacy data import.
-- Run on the owner's identified DEVELOPMENT project only after isolated tests.
begin;
create schema hisab_cloud;
create schema hisab_internal;
revoke all on schema hisab_cloud, hisab_internal from public, anon;
grant usage on schema hisab_cloud, hisab_internal to authenticated;

create table hisab_cloud.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null check (length(display_name) between 1 and 120),
  language text not null default 'bn' check (language in ('bn','en')),
  created_at timestamptz not null default now()
);
create table hisab_cloud.workspaces (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  legacy_id text check (length(legacy_id) between 1 and 200),
  name text not null check (length(name) between 1 and 120),
  description text check (length(description) <= 1000),
  kind text not null check (kind in ('personal','business')),
  currency text not null default 'BDT' check (currency='BDT'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id,owner_id), unique(owner_id,legacy_id)
);
create table hisab_cloud.account_groups (
  id uuid primary key,
  owner_id uuid not null,
  workspace_id uuid not null,
  name text not null check (length(name) between 1 and 120),
  archived_at timestamptz,
  unique(id,workspace_id,owner_id),
  foreign key(workspace_id,owner_id) references hisab_cloud.workspaces(id,owner_id)
);
create table hisab_cloud.accounts (
  id uuid primary key,
  owner_id uuid not null,
  workspace_id uuid not null,
  group_id uuid,
  legacy_id text check (length(legacy_id) between 1 and 200),
  name text not null check (length(name) between 1 and 120),
  kind text not null check (kind in ('cash','bank','bkash','nagad','rocket','savings','other')),
  classification text not null check (classification in ('asset','liability','equity','revenue','expense')),
  system_code text check (system_code in ('opening_equity','revenue_clearing','expense_clearing')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id,workspace_id,owner_id), unique(workspace_id,legacy_id),
  foreign key(workspace_id,owner_id) references hisab_cloud.workspaces(id,owner_id),
  foreign key(group_id,workspace_id,owner_id) references hisab_cloud.account_groups(id,workspace_id,owner_id),
  check (system_code is null or
    (system_code='opening_equity' and classification='equity') or
    (system_code='revenue_clearing' and classification='revenue') or
    (system_code='expense_clearing' and classification='expense'))
);
create unique index hisab_accounts_system_code on hisab_cloud.accounts(workspace_id,system_code) where system_code is not null;
create index hisab_accounts_group on hisab_cloud.accounts(group_id) where group_id is not null;
create table hisab_cloud.categories (
  id uuid primary key,
  owner_id uuid not null,
  workspace_id uuid not null,
  parent_id uuid,
  legacy_id text check (length(legacy_id) between 1 and 200),
  kind text not null check (kind in ('income','expense')),
  name text not null check (length(name) between 1 and 120),
  archived_at timestamptz,
  unique(id,workspace_id,owner_id), unique(id,workspace_id,owner_id,kind), unique(workspace_id,legacy_id),
  foreign key(workspace_id,owner_id) references hisab_cloud.workspaces(id,owner_id),
  foreign key(parent_id,workspace_id,owner_id,kind) references hisab_cloud.categories(id,workspace_id,owner_id,kind),
  check(parent_id is null or parent_id<>id)
);
create index hisab_categories_parent on hisab_cloud.categories(parent_id) where parent_id is not null;

create function hisab_internal.validate_category_parent() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from hisab_cloud.categories p where p.id=new.parent_id and p.workspace_id=new.workspace_id
      and p.owner_id=new.owner_id and p.kind=new.kind and p.parent_id is null
  ) then raise exception 'HISAB_CATEGORY_PARENT_INVALID' using errcode='23514'; end if;
  return new;
end $$;
create trigger hisab_category_parent before insert on hisab_cloud.categories
for each row execute function hisab_internal.validate_category_parent();

create table hisab_cloud.journal_transactions (
  id uuid primary key,
  owner_id uuid not null,
  workspace_id uuid not null,
  operation_id uuid not null,
  device_id uuid not null,
  transaction_type text not null check (transaction_type in ('opening','income','expense','transfer')),
  effective_date date not null check(effective_date between date '0001-01-01' and date '9999-12-31'),
  occurred_at timestamptz not null check(isfinite(occurred_at)),
  created_at timestamptz not null default now(),
  note text check(length(note)<=1000),
  request_payload jsonb not null check(jsonb_typeof(request_payload)='object'),
  creation_tx bigint not null default txid_current(),
  unique(id,workspace_id,owner_id), unique(owner_id,operation_id),
  foreign key(workspace_id,owner_id) references hisab_cloud.workspaces(id,owner_id)
);
create index hisab_journal_workspace_date on hisab_cloud.journal_transactions(workspace_id,effective_date,id);
create table hisab_cloud.journal_lines (
  id uuid primary key,
  owner_id uuid not null,
  workspace_id uuid not null,
  transaction_id uuid not null,
  account_id uuid not null,
  category_id uuid,
  -- No numeric scale typmod: numeric(40,0) would silently round a fractional INSERT.
  debit_minor numeric not null check(debit_minor=trunc(debit_minor) and debit_minor<power(10::numeric,40)),
  credit_minor numeric not null check(credit_minor=trunc(credit_minor) and credit_minor<power(10::numeric,40)),
  check(debit_minor>=0 and credit_minor>=0 and ((debit_minor>0 and credit_minor=0) or (credit_minor>0 and debit_minor=0))),
  foreign key(transaction_id,workspace_id,owner_id) references hisab_cloud.journal_transactions(id,workspace_id,owner_id),
  foreign key(account_id,workspace_id,owner_id) references hisab_cloud.accounts(id,workspace_id,owner_id),
  foreign key(category_id,workspace_id,owner_id) references hisab_cloud.categories(id,workspace_id,owner_id)
);
create index hisab_lines_transaction on hisab_cloud.journal_lines(transaction_id);
create index hisab_lines_account on hisab_cloud.journal_lines(account_id,transaction_id);
create index hisab_lines_category on hisab_cloud.journal_lines(category_id,transaction_id) where category_id is not null;

-- owner_id is checked against auth.uid(), never accepted as authorization proof.
alter table hisab_cloud.profiles enable row level security;
alter table hisab_cloud.profiles force row level security;
revoke all on hisab_cloud.profiles from public,anon,authenticated;
grant select on hisab_cloud.profiles to authenticated;
grant insert(id,display_name,language) on hisab_cloud.profiles to authenticated;
grant update(display_name,language) on hisab_cloud.profiles to authenticated;
create policy hisab_profiles_read on hisab_cloud.profiles for select to authenticated using(id=(select auth.uid()));
create policy hisab_profiles_insert on hisab_cloud.profiles for insert to authenticated with check(id=(select auth.uid()));
create policy hisab_profiles_update on hisab_cloud.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));

do $$ declare t text; begin
  foreach t in array array['workspaces','account_groups','accounts','categories','journal_transactions','journal_lines'] loop
    execute format('alter table hisab_cloud.%I enable row level security',t);
    execute format('alter table hisab_cloud.%I force row level security',t);
    execute format('revoke all on hisab_cloud.%I from public,anon,authenticated',t);
    execute format('grant select on hisab_cloud.%I to authenticated',t);
    execute format('create index %I on hisab_cloud.%I(owner_id)', 'hisab_'||t||'_owner',t);
    execute format('create policy hisab_owner_read on hisab_cloud.%I for select to authenticated using(owner_id=(select auth.uid()))',t);
    execute format('create policy hisab_owner_insert on hisab_cloud.%I for insert to authenticated with check(owner_id=(select auth.uid()))',t);
  end loop;
end $$;
grant insert(id,owner_id,legacy_id,name,description,kind) on hisab_cloud.workspaces to authenticated;
grant insert(id,owner_id,workspace_id,name) on hisab_cloud.account_groups to authenticated;
grant insert(id,owner_id,workspace_id,group_id,legacy_id,name,kind,classification,system_code) on hisab_cloud.accounts to authenticated;
grant insert(id,owner_id,workspace_id,parent_id,legacy_id,kind,name) on hisab_cloud.categories to authenticated;
grant insert(id,owner_id,workspace_id,operation_id,device_id,transaction_type,effective_date,occurred_at,note,request_payload) on hisab_cloud.journal_transactions to authenticated;
grant insert(id,owner_id,workspace_id,transaction_id,account_id,category_id,debit_minor,credit_minor) on hisab_cloud.journal_lines to authenticated;
grant update(name,description,archived_at) on hisab_cloud.workspaces to authenticated;
grant update(name,archived_at) on hisab_cloud.account_groups to authenticated;
grant update(name,kind,group_id,archived_at) on hisab_cloud.accounts to authenticated;
grant update(name,archived_at) on hisab_cloud.categories to authenticated;
do $$ declare t text; begin
  foreach t in array array['workspaces','account_groups','accounts','categories'] loop
    execute format('create policy hisab_owner_update on hisab_cloud.%I for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()))',t);
  end loop;
end $$;
-- No client DELETE, journal UPDATE or journal DELETE grants/policies.

create function hisab_internal.immutable_journal() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'HISAB_JOURNAL_IMMUTABLE' using errcode='23514'; end $$;
create trigger hisab_journal_immutable before update or delete on hisab_cloud.journal_transactions
for each row execute function hisab_internal.immutable_journal();
create trigger hisab_line_immutable before update or delete on hisab_cloud.journal_lines
for each row execute function hisab_internal.immutable_journal();

create function hisab_internal.prevent_late_line() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from hisab_cloud.journal_transactions t where t.id=new.transaction_id
    and t.owner_id=new.owner_id and t.workspace_id=new.workspace_id and t.creation_tx=txid_current())
  then raise exception 'HISAB_JOURNAL_IMMUTABLE' using errcode='23514'; end if;
  return new;
end $$;
create trigger hisab_no_late_lines before insert on hisab_cloud.journal_lines
for each row execute function hisab_internal.prevent_late_line();

create function hisab_internal.validate_journal(p_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare tx hisab_cloud.journal_transactions; n integer; d numeric; c numeric; valid boolean;
begin
  select * into tx from hisab_cloud.journal_transactions where id=p_id;
  if not found then raise exception 'HISAB_JOURNAL_INVALID' using errcode='23514'; end if;
  select count(*),coalesce(sum(debit_minor),0),coalesce(sum(credit_minor),0) into n,d,c
    from hisab_cloud.journal_lines where transaction_id=p_id;
  if n<2 or n>100 or d=0 or d<>c then raise exception 'HISAB_JOURNAL_UNBALANCED' using errcode='23514'; end if;
  select bool_and(case tx.transaction_type
    when 'income' then (a.classification='asset' and l.debit_minor>0 and l.category_id is null)
      or (a.system_code='revenue_clearing' and l.credit_minor>0 and cat.kind='income')
    when 'expense' then (a.classification='asset' and l.credit_minor>0 and l.category_id is null)
      or (a.system_code='expense_clearing' and l.debit_minor>0 and cat.kind='expense')
    when 'opening' then (a.classification='asset' or a.system_code='opening_equity') and l.category_id is null
    when 'transfer' then (a.classification='asset' and l.category_id is null)
      or (a.system_code='expense_clearing' and l.debit_minor>0 and cat.kind='expense')
    else false end is true) into valid
    from hisab_cloud.journal_lines l join hisab_cloud.accounts a on a.id=l.account_id
    left join hisab_cloud.categories cat on cat.id=l.category_id where l.transaction_id=p_id;
  if not valid then raise exception 'HISAB_JOURNAL_KIND_INVALID' using errcode='23514'; end if;
  if tx.transaction_type in ('income','expense','opening') and n<>2 then
    raise exception 'HISAB_JOURNAL_KIND_INVALID' using errcode='23514'; end if;
  if tx.transaction_type='opening' and (select count(*) from hisab_cloud.journal_lines l
    join hisab_cloud.accounts a on a.id=l.account_id where l.transaction_id=p_id and a.classification='asset')<>1
  then raise exception 'HISAB_JOURNAL_KIND_INVALID' using errcode='23514'; end if;
  if tx.transaction_type='transfer' then
    if n>4 or (select count(*) from hisab_cloud.journal_lines l join hisab_cloud.accounts a on a.id=l.account_id
      where l.transaction_id=p_id and a.classification='asset' and l.debit_minor>0)<>1
      or (select count(distinct l.account_id) from hisab_cloud.journal_lines l join hisab_cloud.accounts a on a.id=l.account_id
      where l.transaction_id=p_id and a.classification='asset' and l.credit_minor>0)<>1
      or exists(select 1 from hisab_cloud.journal_lines x join hisab_cloud.journal_lines y on y.transaction_id=x.transaction_id and y.account_id=x.account_id
        where x.transaction_id=p_id and x.debit_minor>0 and y.credit_minor>0)
    then raise exception 'HISAB_JOURNAL_KIND_INVALID' using errcode='23514'; end if;
  end if;
end $$;
create function hisab_internal.check_journal_constraint() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='journal_transactions' then perform hisab_internal.validate_journal(new.id);
  else perform hisab_internal.validate_journal(new.transaction_id); end if;
  return new;
end $$;
create constraint trigger hisab_transaction_balanced after insert on hisab_cloud.journal_transactions
deferrable initially deferred for each row execute function hisab_internal.check_journal_constraint();
create constraint trigger hisab_lines_balanced after insert on hisab_cloud.journal_lines
deferrable initially deferred for each row execute function hisab_internal.check_journal_constraint();

create function hisab_cloud.post_journal(p_workspace_id uuid,p_operation_id uuid,p_transaction_id uuid,p_device_id uuid,
  p_kind text,p_effective_date date,p_occurred_at timestamptz,p_lines jsonb,p_note text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); request jsonb; previous hisab_cloud.journal_transactions; item jsonb;
begin
  if actor is null then raise exception 'HISAB_AUTH_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from hisab_cloud.workspaces where id=p_workspace_id and owner_id=actor and archived_at is null)
  then raise exception 'HISAB_WORKSPACE_DENIED' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('income','expense','opening','transfer') or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 2 and 100 or pg_column_size(p_lines)>65536
  then raise exception 'HISAB_JOURNAL_INVALID' using errcode='23514'; end if;
  request:=jsonb_build_object('workspaceId',p_workspace_id,'transactionId',p_transaction_id,'deviceId',p_device_id,
    'kind',p_kind,'effectiveDate',p_effective_date,'occurredAt',p_occurred_at,'lines',p_lines,'note',p_note);
  perform pg_advisory_xact_lock(hashtextextended(actor::text||p_operation_id::text,0));
  select * into previous from hisab_cloud.journal_transactions where owner_id=actor and operation_id=p_operation_id;
  if found then
    if previous.request_payload<>request then raise exception 'HISAB_OPERATION_CONFLICT' using errcode='23505'; end if;
    return jsonb_build_object('transactionId',previous.id,'operationId',p_operation_id,'replayed',true);
  end if;
  insert into hisab_cloud.journal_transactions(id,owner_id,workspace_id,operation_id,device_id,transaction_type,effective_date,occurred_at,note,request_payload)
    values(p_transaction_id,actor,p_workspace_id,p_operation_id,p_device_id,p_kind,p_effective_date,p_occurred_at,p_note,request);
  for item in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','accountId','categoryId','debitMinor','creditMinor'))
      or jsonb_typeof(item->'debitMinor') is distinct from 'string' or jsonb_typeof(item->'creditMinor') is distinct from 'string'
      or (item->>'debitMinor')!~'^(0|[1-9][0-9]{0,39})$' or (item->>'creditMinor')!~'^(0|[1-9][0-9]{0,39})$'
    then raise exception 'HISAB_JOURNAL_INVALID' using errcode='23514'; end if;
    if not exists(select 1 from hisab_cloud.accounts where id=(item->>'accountId')::uuid and workspace_id=p_workspace_id and owner_id=actor and archived_at is null)
      or (item->>'categoryId' is not null and not exists(select 1 from hisab_cloud.categories where id=(item->>'categoryId')::uuid and workspace_id=p_workspace_id and owner_id=actor and archived_at is null))
    then raise exception 'HISAB_REFERENCE_DENIED' using errcode='42501'; end if;
    insert into hisab_cloud.journal_lines(id,owner_id,workspace_id,transaction_id,account_id,category_id,debit_minor,credit_minor)
      values((item->>'id')::uuid,actor,p_workspace_id,p_transaction_id,(item->>'accountId')::uuid,(item->>'categoryId')::uuid,(item->>'debitMinor')::numeric,(item->>'creditMinor')::numeric);
  end loop;
  perform hisab_internal.validate_journal(p_transaction_id);
  return jsonb_build_object('transactionId',p_transaction_id,'operationId',p_operation_id,'replayed',false);
end $$;

revoke all on all functions in schema hisab_internal,hisab_cloud from public,anon,authenticated;
grant execute on function hisab_cloud.post_journal(uuid,uuid,uuid,uuid,text,date,timestamptz,jsonb,text) to authenticated;
grant execute on function hisab_internal.validate_journal(uuid) to authenticated;
comment on schema hisab_cloud is 'Hisab Development foundation; owner-only, not added to exposed Data API schemas. Existing Drive authority unchanged.';
commit;
