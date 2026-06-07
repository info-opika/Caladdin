-- 021_rate_limits.sql — Postgres sliding-window rate limit events (multi-instance safe)
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id BIGSERIAL PRIMARY KEY,
  bucket_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_bucket_created
  ON rate_limit_events (bucket_key, created_at DESC);
