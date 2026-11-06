-- Additive, private and portable. Never reads the shared auth or finance schemas.
CREATE TABLE hisab_access.customer_emails (
 email text PRIMARY KEY CHECK(length(email) BETWEEN 3 AND 254 AND email=lower(email)),
 customer_id uuid NOT NULL REFERENCES hisab_access.customers(customer_id),
 verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_emails_customer ON hisab_access.customer_emails(customer_id);
CREATE TABLE hisab_access.email_grants (
 request_id uuid NOT NULL REFERENCES hisab_access.commands(request_id),
 email text NOT NULL CHECK(length(email) BETWEEN 3 AND 254 AND email=lower(email)),
 days integer NOT NULL CHECK(days BETWEEN 1 AND 3660),
 customer_id uuid REFERENCES hisab_access.customers(customer_id),
 created_at timestamptz NOT NULL DEFAULT now(),applied_at timestamptz,cancelled_at timestamptz,
 PRIMARY KEY(request_id,email),
 CHECK((customer_id IS NULL)=(applied_at IS NULL)),
 CHECK(cancelled_at IS NULL OR applied_at IS NULL)
);
CREATE INDEX email_grants_pending ON hisab_access.email_grants(email) WHERE applied_at IS NULL AND cancelled_at IS NULL;
CREATE TABLE hisab_access.email_grant_claims (
 request_id uuid NOT NULL REFERENCES hisab_access.commands(request_id),
 customer_id uuid NOT NULL REFERENCES hisab_access.customers(customer_id),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(request_id,customer_id)
);
REVOKE ALL ON hisab_access.customer_emails,hisab_access.email_grants,hisab_access.email_grant_claims FROM PUBLIC;
ALTER TABLE hisab_access.customer_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE hisab_access.email_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE hisab_access.email_grant_claims ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON hisab_access.customer_emails TO hisab_access_preview;
GRANT SELECT,INSERT,UPDATE ON hisab_access.email_grants TO hisab_access_preview;
GRANT SELECT,INSERT ON hisab_access.email_grant_claims TO hisab_access_preview;
CREATE POLICY access_server ON hisab_access.customer_emails TO hisab_access_preview USING(true) WITH CHECK(true);
CREATE POLICY access_server ON hisab_access.email_grants TO hisab_access_preview USING(true) WITH CHECK(true);
CREATE POLICY access_server ON hisab_access.email_grant_claims TO hisab_access_preview USING(true) WITH CHECK(true);
CREATE TABLE hisab_access.directory_events (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor uuid NOT NULL,subject uuid,created_at timestamptz NOT NULL DEFAULT now(),
 kind text NOT NULL CHECK(kind IN ('email_batch_created','email_access_granted','email_grant_cancelled','blocked','unblocked'))
);
REVOKE ALL ON hisab_access.directory_events FROM PUBLIC;
ALTER TABLE hisab_access.directory_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON hisab_access.directory_events TO hisab_access_preview;
GRANT USAGE ON SEQUENCE hisab_access.directory_events_sequence_seq TO hisab_access_preview;
CREATE POLICY access_server ON hisab_access.directory_events TO hisab_access_preview USING(true) WITH CHECK(true);
GRANT SELECT ON hisab_access.audit TO hisab_access_preview;
CREATE POLICY access_server_read ON hisab_access.audit FOR SELECT TO hisab_access_preview USING(true);
