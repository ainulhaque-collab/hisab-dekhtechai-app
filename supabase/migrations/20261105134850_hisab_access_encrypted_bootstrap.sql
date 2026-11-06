-- Management-only, invoker-privilege provisioning. Public key is not secret.
-- pgcrypto is already installed in Supabase's extensions schema; no host change
-- is made here. Core access/ledger use does not depend on this operator helper.
CREATE FUNCTION hisab_access.provision_encrypted_preview(public_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
 role_record record;
 password_value text;
 wrapping_value text;
 record_value jsonb;
BEGIN
 IF length(public_key)>10000 OR public_key NOT LIKE '-----BEGIN PGP PUBLIC KEY BLOCK-----%' THEN
   RAISE EXCEPTION 'ACCESS_RECOVERY_PUBLIC_KEY_INVALID';
 END IF;
 SELECT * INTO role_record FROM pg_roles WHERE rolname='hisab_access_preview';
 IF NOT FOUND OR role_record.rolsuper OR role_record.rolbypassrls OR role_record.rolcreatedb OR role_record.rolcreaterole OR role_record.rolinherit
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=role_record.oid) THEN
   RAISE EXCEPTION 'ACCESS_DATABASE_ROLE_UNSAFE';
 END IF;
 password_value:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
 wrapping_value:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
 record_value:=jsonb_build_object('project','sfzitbasxrpmtmldujbm','branch','codex/verified-service-identity','databasePassword',password_value,'wrappingKey',wrapping_value,'createdAt',clock_timestamp());
 EXECUTE format('ALTER ROLE hisab_access_preview LOGIN PASSWORD %L',password_value);
 RETURN jsonb_build_object('databasePassword',password_value,'wrappingKey',wrapping_value,
   'encryptedBackup',encode(extensions.pgp_pub_encrypt(record_value::text,extensions.dearmor(public_key),'cipher-algo=aes256,compress-algo=0'),'hex'),
   'recordSha256',encode(sha256(convert_to(record_value::text,'UTF8')),'hex'));
END;
$$;
REVOKE ALL ON FUNCTION hisab_access.provision_encrypted_preview(text) FROM PUBLIC;
-- Retire the management-only plaintext-only bootstrap path; no user data exists
-- in this function, and no customer/runtime has EXECUTE privileges on either.
DROP FUNCTION hisab_access.provision_preview_login();
