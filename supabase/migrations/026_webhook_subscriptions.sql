-- 026_webhook_subscriptions.sql — Outbound webhooks on booking lifecycle (P1-15)

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL CHECK (char_length(url) >= 8),
  secret TEXT NOT NULL CHECK (char_length(secret) >= 16),
  events TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_user_active
  ON webhook_subscriptions (user_id, active);

ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhook_subscriptions_select_own ON webhook_subscriptions
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY webhook_subscriptions_insert_own ON webhook_subscriptions
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY webhook_subscriptions_update_own ON webhook_subscriptions
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY webhook_subscriptions_delete_own ON webhook_subscriptions
  FOR DELETE USING (user_id = app_current_user_id());
