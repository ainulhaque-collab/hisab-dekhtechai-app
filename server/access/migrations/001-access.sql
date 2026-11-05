-- Portable PostgreSQL. Apply explicitly with a migration owner, never at runtime.
-- No auth.users FK: identity provider migration must not cascade-delete access.
CREATE SCHEMA IF NOT EXISTS hisab_access;
REVOKE ALL ON SCHEMA hisab_access FROM PUBLIC;
CREATE TABLE hisab_access.customers (
 customer_id uuid PRIMARY KEY, blocked boolean NOT NULL DEFAULT false,
 expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hisab_access.codes (
 digest text PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
 days integer NOT NULL CHECK(days BETWEEN 1 AND 3660),
 claim_before timestamptz NOT NULL, issued_by uuid NOT NULL,
 issue_request uuid UNIQUE NOT NULL, claimed_by uuid, claimed_at timestamptz,
 CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))
);
CREATE TABLE hisab_access.providers (
 provider text PRIMARY KEY CHECK(provider IN ('gemini')),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 120),
 revision integer NOT NULL CHECK(revision > 0), enabled boolean NOT NULL,
 sealed jsonb NOT NULL, updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hisab_access.audit (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor uuid NOT NULL, subject uuid, kind text NOT NULL
 CHECK(kind IN ('code_issued','code_redeemed','access_granted','blocked','unblocked','provider_rotated','provider_disabled')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hisab_access.commands (
 request_id uuid PRIMARY KEY, actor uuid NOT NULL, digest text NOT NULL
);
CREATE TABLE hisab_access.throttles (
 bucket text PRIMARY KEY, minute timestamptz NOT NULL, hits integer NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA hisab_access FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA hisab_access FROM PUBLIC;
ALTER TABLE hisab_access.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hisab_access.codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hisab_access.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hisab_access.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE hisab_access.commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE hisab_access.throttles ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies or grants. A dedicated NOLOGIN role is created
-- here; activation credentials are a separate deployment-only operation.
-- Abort rather than silently reuse/alter a pre-existing role with unknown grants.
CREATE ROLE hisab_access_preview NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8;
GRANT USAGE ON SCHEMA hisab_access TO hisab_access_preview;
GRANT SELECT,INSERT,UPDATE ON hisab_access.customers,hisab_access.codes,hisab_access.providers,hisab_access.throttles TO hisab_access_preview;
GRANT SELECT,INSERT ON hisab_access.commands TO hisab_access_preview;
GRANT INSERT ON hisab_access.audit TO hisab_access_preview;
GRANT USAGE ON SEQUENCE hisab_access.audit_sequence_seq TO hisab_access_preview;
CREATE POLICY access_server ON hisab_access.customers TO hisab_access_preview USING(true) WITH CHECK(true);
CREATE POLICY access_server ON hisab_access.codes TO hisab_access_preview USING(true) WITH CHECK(true);
CREATE POLICY access_server ON hisab_access.providers TO hisab_access_preview USING(true) WITH CHECK(true);
CREATE POLICY access_server ON hisab_access.commands TO hisab_access_preview USING(true) WITH CHECK(true);
CREATE POLICY access_server ON hisab_access.audit FOR INSERT TO hisab_access_preview WITH CHECK(true);
CREATE POLICY access_server ON hisab_access.throttles TO hisab_access_preview USING(true) WITH CHECK(true);
