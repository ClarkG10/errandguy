-- Additive migration for the NestJS DB-backed queue.
-- Apply ONCE against the shared Supabase Postgres (does NOT touch any existing
-- table). Safe to run with `psql "$DIRECT_URL" -f prisma/sql/000_queued_jobs.sql`.

CREATE TABLE IF NOT EXISTS queued_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         varchar(100) NOT NULL,
  payload      jsonb NOT NULL,
  available_at timestamptz NOT NULL,
  reserved_at  timestamptz NULL,
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  status       varchar(12) NOT NULL DEFAULT 'pending',
  last_error   text NULL,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queued_jobs_status_available
  ON queued_jobs (status, available_at);
