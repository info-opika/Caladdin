-- 008_feedback_logs.sql
CREATE TABLE IF NOT EXISTS feedback_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  rating TEXT CHECK (rating IN ('up', 'down')),
  stars INTEGER CHECK (stars >= 1 AND stars <= 5),
  intent TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
