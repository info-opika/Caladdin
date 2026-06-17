/**
 * One-off: remove duplicate events rows (repeated GCal import on sign-in).
 * Usage: node scripts/cleanup-duplicate-events.mjs
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const projectRef = process.env.SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
const password = process.env.SUPABASE_DB_PASSWORD;

if (!projectRef || !password) {
  console.error('Missing SUPABASE_URL or SUPABASE_DB_PASSWORD in .env');
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_URL ??
  `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log(`Connected to ${projectRef}\n`);

  const before = await client.query('SELECT COUNT(*)::int AS n FROM events');
  const dupes = await client.query(`
    SELECT COUNT(*)::int AS n FROM (
      SELECT user_id, gcal_event_id FROM events
      WHERE gcal_event_id IS NOT NULL AND status != 'cancelled'
      GROUP BY user_id, gcal_event_id HAVING COUNT(*) > 1
    ) d
  `);
  console.log('Events before:', before.rows[0].n);
  console.log('Duplicate gcal groups:', dupes.rows[0].n);

  const r1 = await client.query(`
    DELETE FROM events e
    USING events e2
    WHERE e.user_id = e2.user_id
      AND e.gcal_event_id IS NOT NULL
      AND e.gcal_event_id = e2.gcal_event_id
      AND e.created_at > e2.created_at
  `);
  console.log('Deleted gcal duplicates:', r1.rowCount);

  const r2 = await client.query(`
    DELETE FROM events e
    USING events e2
    WHERE e.user_id = e2.user_id
      AND e.gcal_event_id IS NULL
      AND e2.gcal_event_id IS NULL
      AND e.start_at = e2.start_at
      AND e.end_at = e2.end_at
      AND e.title = e2.title
      AND e.status != 'cancelled'
      AND e2.status != 'cancelled'
      AND e.created_at > e2.created_at
  `);
  console.log('Deleted slot duplicates (no gcal id):', r2.rowCount);

  const after = await client.query('SELECT COUNT(*)::int AS n FROM events');
  const dupesAfter = await client.query(`
    SELECT COUNT(*)::int AS n FROM (
      SELECT user_id, gcal_event_id FROM events
      WHERE gcal_event_id IS NOT NULL AND status != 'cancelled'
      GROUP BY user_id, gcal_event_id HAVING COUNT(*) > 1
    ) d
  `);
  console.log('\nEvents after:', after.rows[0].n);
  console.log('Duplicate gcal groups after:', dupesAfter.rows[0].n);
} finally {
  await client.end();
}
