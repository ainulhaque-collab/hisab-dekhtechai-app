-- Provisioning and encrypted recovery are verified. Retire the one-time
-- management helper; runtime table access/provider-key rotation is unaffected.
DROP FUNCTION IF EXISTS hisab_access.provision_encrypted_preview(text);
