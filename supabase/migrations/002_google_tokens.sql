-- 002_google_tokens.sql
CREATE TABLE IF NOT EXISTS google_tokens (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expiry TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
