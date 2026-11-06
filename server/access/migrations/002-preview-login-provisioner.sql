-- Management-only provisioning without a plaintext password in migration history.
-- Invoker privileges: no privilege escalation, no public/runtime execute grant.
CREATE FUNCTION hisab_access.provision_preview_login() RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
 role_record record;
 new_password text;
BEGIN
 SELECT * INTO role_record FROM pg_roles WHERE rolname='hisab_access_preview';
 IF NOT FOUND OR role_record.rolsuper OR role_record.rolbypassrls OR role_record.rolcreatedb OR role_record.rolcreaterole OR role_record.rolinherit
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=role_record.oid) THEN
   RAISE EXCEPTION 'ACCESS_DATABASE_ROLE_UNSAFE';
 END IF;
 new_password:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 EXECUTE format('ALTER ROLE hisab_access_preview LOGIN PASSWORD %L',new_password);
 RETURN new_password;
END;
$$;
REVOKE ALL ON FUNCTION hisab_access.provision_preview_login() FROM PUBLIC;
