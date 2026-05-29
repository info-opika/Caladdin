-- 014_phase_x.sql
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS previous_state JSONB;
ALTER TABLE events ADD COLUMN IF NOT EXISTS proposed_for_session UUID REFERENCES scheduling_sessions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS compensation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempts INTEGER DEFAULT 0,
  next_retry_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent TEXT NOT NULL,
  bucket_5min TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compensation_retry ON compensation_queue(next_retry_at) WHERE attempts < 10;
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);
