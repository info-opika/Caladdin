-- 019_rls_policies.sql
-- Row Level Security for user-scoped tables.
-- Policies use current_setting('app.user_id') set via set_app_user_id() per request.
--
-- Service role (Supabase service_role key) bypasses RLS by platform design.
-- Keep service role for:
--   - waitlist (no per-user ownership; admin insert/select)
--   - compensation_queue / idempotency_keys (background worker retries)
--   - session expiry job (bulk status updates across hosts)
--   - OAuth signup (creates users before app.user_id context exists)
--   - public booking routes (token lookup on scheduling_sessions by unauthenticated guests)

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION set_app_user_id(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.user_id', p_user_id::text, true);
END;
$$;

GRANT EXECUTE ON FUNCTION app_current_user_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_app_user_id(UUID) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- users (PK is id, not user_id)
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own ON users
  FOR SELECT USING (id = app_current_user_id());

CREATE POLICY users_insert_own ON users
  FOR INSERT WITH CHECK (id = app_current_user_id());

CREATE POLICY users_update_own ON users
  FOR UPDATE USING (id = app_current_user_id()) WITH CHECK (id = app_current_user_id());

CREATE POLICY users_delete_own ON users
  FOR DELETE USING (id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- user_policies
-- ---------------------------------------------------------------------------
ALTER TABLE user_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_policies_select_own ON user_policies
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY user_policies_insert_own ON user_policies
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY user_policies_update_own ON user_policies
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY user_policies_delete_own ON user_policies
  FOR DELETE USING (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_select_own ON events
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY events_insert_own ON events
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY events_update_own ON events
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY events_delete_own ON events
  FOR DELETE USING (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- google_tokens
-- ---------------------------------------------------------------------------
ALTER TABLE google_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY google_tokens_select_own ON google_tokens
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY google_tokens_insert_own ON google_tokens
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY google_tokens_update_own ON google_tokens
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY google_tokens_delete_own ON google_tokens
  FOR DELETE USING (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- pending_confirmations
-- ---------------------------------------------------------------------------
ALTER TABLE pending_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_confirmations_select_own ON pending_confirmations
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY pending_confirmations_insert_own ON pending_confirmations
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY pending_confirmations_update_own ON pending_confirmations
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY pending_confirmations_delete_own ON pending_confirmations
  FOR DELETE USING (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- scheduling_sessions (host_user_id)
-- ---------------------------------------------------------------------------
ALTER TABLE scheduling_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduling_sessions_select_own ON scheduling_sessions
  FOR SELECT USING (host_user_id = app_current_user_id());

CREATE POLICY scheduling_sessions_insert_own ON scheduling_sessions
  FOR INSERT WITH CHECK (host_user_id = app_current_user_id());

CREATE POLICY scheduling_sessions_update_own ON scheduling_sessions
  FOR UPDATE USING (host_user_id = app_current_user_id()) WITH CHECK (host_user_id = app_current_user_id());

CREATE POLICY scheduling_sessions_delete_own ON scheduling_sessions
  FOR DELETE USING (host_user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- failure_logs (nullable user_id; scoped rows only)
-- ---------------------------------------------------------------------------
ALTER TABLE failure_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY failure_logs_select_own ON failure_logs
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY failure_logs_insert_own ON failure_logs
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY failure_logs_update_own ON failure_logs
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY failure_logs_delete_own ON failure_logs
  FOR DELETE USING (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select_own ON audit_log
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY audit_log_insert_own ON audit_log
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY audit_log_update_own ON audit_log
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY audit_log_delete_own ON audit_log
  FOR DELETE USING (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- usage_events
-- ---------------------------------------------------------------------------
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_events_select_own ON usage_events
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY usage_events_insert_own ON usage_events
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY usage_events_update_own ON usage_events
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY usage_events_delete_own ON usage_events
  FOR DELETE USING (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- pending_clarification_frames
-- ---------------------------------------------------------------------------
ALTER TABLE pending_clarification_frames ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_clarification_frames_select_own ON pending_clarification_frames
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY pending_clarification_frames_insert_own ON pending_clarification_frames
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY pending_clarification_frames_update_own ON pending_clarification_frames
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY pending_clarification_frames_delete_own ON pending_clarification_frames
  FOR DELETE USING (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- compensation_queue (worker; service role only in practice)
-- ---------------------------------------------------------------------------
ALTER TABLE compensation_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY compensation_queue_select_own ON compensation_queue
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY compensation_queue_insert_own ON compensation_queue
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY compensation_queue_update_own ON compensation_queue
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY compensation_queue_delete_own ON compensation_queue
  FOR DELETE USING (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- idempotency_keys (worker; service role only in practice)
-- ---------------------------------------------------------------------------
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY idempotency_keys_select_own ON idempotency_keys
  FOR SELECT USING (user_id = app_current_user_id());

CREATE POLICY idempotency_keys_insert_own ON idempotency_keys
  FOR INSERT WITH CHECK (user_id = app_current_user_id());

CREATE POLICY idempotency_keys_update_own ON idempotency_keys
  FOR UPDATE USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

CREATE POLICY idempotency_keys_delete_own ON idempotency_keys
  FOR DELETE USING (user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- platform_invites (inviter_user_id)
-- ---------------------------------------------------------------------------
ALTER TABLE platform_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_invites_select_own ON platform_invites
  FOR SELECT USING (inviter_user_id = app_current_user_id());

CREATE POLICY platform_invites_insert_own ON platform_invites
  FOR INSERT WITH CHECK (inviter_user_id = app_current_user_id());

CREATE POLICY platform_invites_update_own ON platform_invites
  FOR UPDATE USING (inviter_user_id = app_current_user_id()) WITH CHECK (inviter_user_id = app_current_user_id());

CREATE POLICY platform_invites_delete_own ON platform_invites
  FOR DELETE USING (inviter_user_id = app_current_user_id());

-- ---------------------------------------------------------------------------
-- feedback_logs (user_id stored as TEXT)
-- ---------------------------------------------------------------------------
ALTER TABLE feedback_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY feedback_logs_select_own ON feedback_logs
  FOR SELECT USING (user_id::uuid = app_current_user_id());

CREATE POLICY feedback_logs_insert_own ON feedback_logs
  FOR INSERT WITH CHECK (user_id::uuid = app_current_user_id());

CREATE POLICY feedback_logs_update_own ON feedback_logs
  FOR UPDATE USING (user_id::uuid = app_current_user_id()) WITH CHECK (user_id::uuid = app_current_user_id());

CREATE POLICY feedback_logs_delete_own ON feedback_logs
  FOR DELETE USING (user_id::uuid = app_current_user_id());

-- ---------------------------------------------------------------------------
-- waitlist (no user_id — service role / admin only; RLS denies direct API access)
-- ---------------------------------------------------------------------------
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- No policies: anon/authenticated cannot access; service_role bypasses RLS.
