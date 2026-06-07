import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(__dirname, '../../supabase/migrations/019_rls_policies.sql');
const sql = readFileSync(migrationPath, 'utf-8');

const USER_SCOPED_TABLES = [
  'users',
  'user_policies',
  'events',
  'google_tokens',
  'pending_confirmations',
  'scheduling_sessions',
  'failure_logs',
  'audit_log',
  'usage_events',
  'pending_clarification_frames',
  'compensation_queue',
  'idempotency_keys',
  'platform_invites',
  'feedback_logs',
  'waitlist',
];

describe('019_rls_policies migration', () => {
  it('defines app.user_id helpers', () => {
    expect(sql).toMatch(/app_current_user_id\(\)/);
    expect(sql).toMatch(/set_app_user_id/);
    expect(sql).toMatch(/current_setting\('app\.user_id'/);
  });

  it.each(USER_SCOPED_TABLES)('enables RLS on %s', (table) => {
    expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 'i'));
  });

  it('creates per-table CRUD policies for events', () => {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toMatch(new RegExp(`events_${op}_own`, 'i'));
    }
  });

  it('documents waitlist as service-role-only (RLS, no policies)', () => {
    expect(sql).toMatch(/waitlist/i);
    expect(sql).not.toMatch(/CREATE POLICY waitlist_/i);
  });
});
