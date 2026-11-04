-- Fresh, isolated stock PostgreSQL ONLY. Never execute on a Supabase project.
-- The gateway must verify Auth externally and set hisab.actor_id transaction-locally.
begin;
do $$ begin
  if current_setting('hisab.bootstrap_mode',true) is distinct from 'isolated-stock'
    or to_regnamespace('auth') is not null or to_regnamespace('hisab_cloud') is not null
  then raise exception 'HISAB_STOCK_BOOTSTRAP_REQUIRES_EMPTY_ISOLATED_DATABASE'; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls or rolcanlogin))
  then raise exception 'HISAB_STOCK_ROLES_MUST_BE_UNPRIVILEGED_NOLOGIN'; end if;
end $$;
create schema auth;
revoke all on schema auth from public,anon,authenticated;
grant usage on schema auth to authenticated;
-- Identity anchor only, not an OAuth/password implementation. Server-managed UUIDs.
create table auth.users(id uuid primary key);
revoke all on auth.users from public,anon,authenticated;
create function auth.uid() returns uuid language sql stable security invoker set search_path=''
as $$ select nullif(current_setting('hisab.actor_id',true),'')::uuid $$;
revoke all on function auth.uid() from public,anon,authenticated;
grant execute on function auth.uid() to authenticated;
commit;
