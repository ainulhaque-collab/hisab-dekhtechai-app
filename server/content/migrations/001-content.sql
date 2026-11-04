-- REVIEWED SOURCE ONLY. Run on a separately approved Preview PostgreSQL database.
-- No financial ledger, owner Drive authority, automatic migration or broadcasts.
BEGIN;
CREATE TABLE IF NOT EXISTS hisab_content_documents (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('article','announcement')),
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 1000000),
  data jsonb NOT NULL CHECK (jsonb_typeof(data)='object' AND data ? 'kind' AND data->>'kind'=kind
    AND data ? 'status' AND data->>'status' IN ('draft','published')
    AND (kind<>'announcement' OR data->>'status'='draft')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hisab_content_published ON hisab_content_documents(updated_at DESC,id)
  WHERE kind='article' AND data->>'status'='published';
CREATE TABLE IF NOT EXISTS hisab_content_commands (
  request_id uuid PRIMARY KEY,
  actor_hash text NOT NULL CHECK (actor_hash ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  document_id uuid NOT NULL REFERENCES hisab_content_documents(id),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
