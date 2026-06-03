-- 016_waitlist.sql
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  status TEXT CHECK (status IN ('waiting', 'invited', 'joined')) DEFAULT 'waiting',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  invited_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
