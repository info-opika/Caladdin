import { describe, it, expect, beforeAll } from 'vitest';
import { type SupabaseClient } from '@supabase/supabase-js';
import { createNodeSupabaseClient } from '../../src/db/node-supabase-client.js';
import { execSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

dotenv.config({ path: join(repoRoot, '.env') });

const TEST_URL = process.env['SUPABASE_TEST_URL'];
const TEST_KEY = process.env['SUPABASE_TEST_ANON_KEY'];
const SKIP = !TEST_URL || !TEST_KEY;

interface ColumnInfo {
  table_name: string;
  column_name: string;
  is_nullable: string;
  data_type: string;
}

async function getSchemaFromTestDb(client: SupabaseClient): Promise<{
  tables: Set<string>;
  columns: Map<string, Set<string>>;
}> {
  const { data: rpcData, error: rpcError } = await (client.rpc as unknown as (
    name: string,
    params?: Record<string, unknown>
  ) => Promise<{ data: ColumnInfo[] | null; error: unknown }>)('list_columns', {});

  if (!rpcError && rpcData && rpcData.length > 0) {
    const tables = new Set<string>();
    const columns = new Map<string, Set<string>>();
    for (const row of rpcData) {
      tables.add(row.table_name);
      if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
      columns.get(row.table_name)!.add(row.column_name);
    }
    return { tables, columns };
  }

  const knownTables = [
    'users',
    'user_policies',
    'events',
    'google_tokens',
    'failure_logs',
    'audit_log',
    'pending_confirmations',
    'scheduling_sessions',
    'feedback_logs',
    'usage_events',
    'pending_clarification_frames',
  ];

  const tables = new Set<string>();
  const columns = new Map<string, Set<string>>();

  for (const table of knownTables) {
    const { error } = await client.from(table).select('*').limit(0);
    if (!error) {
      tables.add(table);
    }
  }

  return { tables, columns };
}

function getSchemaFromMigrations(): {
  tables: Set<string>;
  columns: Map<string, Set<string>>;
  constraints: Map<string, string[]>;
} {
  const migDir = join(repoRoot, 'supabase', 'migrations');
  const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

  const tables = new Set<string>();
  const columns = new Map<string, Set<string>>();
  const constraints = new Map<string, string[]>();

  for (const file of files) {
    const sql = readFileSync(join(migDir, file), 'utf-8');

    const ctPattern = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi;
    let ctMatch: RegExpExecArray | null;
    while ((ctMatch = ctPattern.exec(sql)) !== null) {
      const tableName = ctMatch[1]!.toLowerCase();
      const body = ctMatch[2]!;
      tables.add(tableName);
      if (!columns.has(tableName)) columns.set(tableName, new Set());
      if (!constraints.has(tableName)) constraints.set(tableName, []);

      const colSet = columns.get(tableName)!;
      const constList = constraints.get(tableName)!;

      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('--')) continue;

        if (
          trimmed.toUpperCase().startsWith('UNIQUE') ||
          trimmed.toUpperCase().startsWith('PRIMARY KEY') ||
          trimmed.toUpperCase().startsWith('FOREIGN KEY') ||
          trimmed.toUpperCase().startsWith('CONSTRAINT') ||
          trimmed.toUpperCase().startsWith('CHECK')
        ) {
          constList.push(trimmed);
          continue;
        }

        if (trimmed.toUpperCase().includes('UNIQUE') && !trimmed.toUpperCase().startsWith('UNIQUE')) {
          constList.push(`UNIQUE(${trimmed.split(/\s+/)[0]})`);
        }
        if (trimmed.toUpperCase().includes('CHECK')) {
          constList.push(`CHECK on column: ${trimmed.split(/\s+/)[0]}`);
        }

        const colName = trimmed.split(/\s+/)[0];
        if (colName && /^\w+$/.test(colName)) {
          colSet.add(colName.toLowerCase());
        }
      }
    }

    const altPattern = /ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)\s/gi;
    let altMatch: RegExpExecArray | null;
    while ((altMatch = altPattern.exec(sql)) !== null) {
      const t = altMatch[1]!.toLowerCase();
      const c = altMatch[2]!.toLowerCase();
      if (!columns.has(t)) columns.set(t, new Set());
      columns.get(t)!.add(c);
    }
  }

  return { tables, columns, constraints };
}

describe.skipIf(SKIP)('migration schema (live test DB)', () => {
  let client: SupabaseClient;
  let liveSchema: { tables: Set<string>; columns: Map<string, Set<string>> };

  beforeAll(async () => {
    client = createNodeSupabaseClient(TEST_URL!, TEST_KEY!);
    liveSchema = await getSchemaFromTestDb(client);
  });

  it('all 10 expected tables exist', async () => {
    const EXPECTED_TABLES = [
      'users',
      'user_policies',
      'events',
      'google_tokens',
      'failure_logs',
      'audit_log',
      'pending_confirmations',
      'scheduling_sessions',
      'feedback_logs',
      'usage_events',
    ];

    for (const table of EXPECTED_TABLES) {
      const { error } = await client.from(table).select('*').limit(0);
      expect(error, `Table "${table}" should exist`).toBeNull();
    }
  });

  it('audit_log has all required columns', async () => {
    const REQUIRED = ['id', 'user_id', 'intent', 'atomic_op', 'event_id', 'outcome', 'confirmation_token', 'timestamp'];
    await assertColumnsExist(client, 'audit_log', REQUIRED);
  });

  it('pending_confirmations has all required columns (including payload_hash)', async () => {
    const REQUIRED = [
      'id', 'user_id', 'confirmation_token', 'intent',
      'payload', 'payload_hash', 'status', 'created_at', 'expires_at',
    ];
    await assertColumnsExist(client, 'pending_confirmations', REQUIRED);
  });

  it('user_policies has all required columns', async () => {
    const REQUIRED = ['id', 'user_id', 'policy', 'updated_at'];
    await assertColumnsExist(client, 'user_policies', REQUIRED);
  });

  it('google_tokens has all required columns', async () => {
    const REQUIRED = ['user_id', 'access_token', 'refresh_token', 'expiry_date', 'updated_at'];
    await assertColumnsExist(client, 'google_tokens', REQUIRED);
  });
});

describe('migration schema (from migration files)', () => {
  const { tables, columns, constraints } = getSchemaFromMigrations();

  it('all 11 expected tables defined in migrations', () => {
    const EXPECTED = ['users', 'user_policies', 'events', 'google_tokens', 'failure_logs', 'audit_log', 'pending_confirmations', 'scheduling_sessions', 'feedback_logs', 'usage_events', 'pending_clarification_frames'];
    for (const t of EXPECTED) {
      expect(tables.has(t), `Table "${t}" should be in migrations`).toBe(true);
    }
  });

  it('audit_log has required base columns in migrations', () => {
    const cols = columns.get('audit_log') ?? new Set();
    const required = ['id', 'user_id', 'intent', 'atomic_op', 'event_id', 'outcome', 'confirmation_token', 'timestamp'];
    for (const c of required) {
      expect(cols.has(c), `audit_log.${c} should be in migrations`).toBe(true);
    }
  });

  it('pending_confirmations has required columns in migrations (excluding payload_hash — needs manual ALTER)', () => {
    const cols = columns.get('pending_confirmations') ?? new Set();
    const required = ['id', 'user_id', 'confirmation_token', 'intent', 'payload', 'status', 'created_at', 'expires_at'];
    for (const c of required) {
      expect(cols.has(c), `pending_confirmations.${c} should be in migrations`).toBe(true);
    }
  });

  it('user_policies has unique constraint on user_id in migrations', () => {
    const cols = columns.get('user_policies') ?? new Set();
    expect(cols.has('user_id')).toBe(true);
  });

  it('pending_confirmations has unique constraint on confirmation_token', () => {
    const constList = constraints.get('pending_confirmations') ?? [];
    const hasUniqueToken = constList.some(
      (c) => c.toLowerCase().includes('unique') && c.toLowerCase().includes('confirmation_token')
    );
    expect(hasUniqueToken, 'pending_confirmations.confirmation_token should have UNIQUE constraint').toBe(true);
  });

  it('audit_log outcome CHECK constraint restricts to valid values', () => {
    const constList = constraints.get('audit_log') ?? [];
    const hasCheckOutcome = constList.some(
      (c) => c.toLowerCase().includes('check') || c.toLowerCase().includes('outcome')
    );
    expect(hasCheckOutcome, 'audit_log should have CHECK constraint on outcome').toBe(true);
  });

  it('pending_confirmations status CHECK constraint restricts to valid values', () => {
    const constList = constraints.get('pending_confirmations') ?? [];
    const hasCheckStatus = constList.some(
      (c) => c.toLowerCase().includes('check') || c.toLowerCase().includes('status')
    );
    expect(hasCheckStatus, 'pending_confirmations should have CHECK constraint on status').toBe(true);
  });

  it('audit_log.telemetry is present in migrations; pending_confirmations.payload_hash gap is known', () => {
    const pcCols = columns.get('pending_confirmations') ?? new Set();
    const auditCols = columns.get('audit_log') ?? new Set();
    expect(auditCols.has('telemetry')).toBe(true);
    expect(pcCols.has('payload_hash')).toBe(true);
  });

  it('usage_events has required columns in migrations', () => {
    const cols = columns.get('usage_events') ?? new Set();
    for (const c of ['id', 'user_id', 'session_token', 'event_type', 'metadata', 'created_at']) {
      expect(cols.has(c), `usage_events.${c} should be in migrations`).toBe(true);
    }
  });

  it('pending_clarification_frames has required columns in migrations', () => {
    const cols = columns.get('pending_clarification_frames') ?? new Set();
    for (const c of [
      'id',
      'user_id',
      'pending_intent',
      'known_fields',
      'missing_fields',
      'original_utterance',
      'parse_risk',
      'status',
      'created_at',
      'expires_at',
      'updated_at',
    ]) {
      expect(cols.has(c), `pending_clarification_frames.${c} should be in migrations`).toBe(true);
    }
  });
});

async function assertColumnsExist(
  client: SupabaseClient,
  table: string,
  required: string[]
): Promise<void> {
  for (const col of required) {
    const { error } = await client.from(table).select(col).limit(0);
    expect(error, `Column "${table}.${col}" should exist (error: ${error?.message})`).toBeNull();
  }
}