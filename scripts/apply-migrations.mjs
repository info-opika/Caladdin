/**
 * Apply all SQL migrations in supabase/migrations/ to remote Postgres.
 * Requires SUPABASE_DB_PASSWORD in .env (Supabase → Project Settings → Database).
 *
 * Usage: npm run db:apply
 */
import dotenv from 'dotenv';
import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const migrationsDir = join(root, 'supabase', 'migrations');

const projectRef = process.env.SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
const password = process.env.SUPABASE_DB_PASSWORD;

if (!projectRef) {
  console.error('SUPABASE_URL missing or invalid in .env');
  process.exit(1);
}
if (!password) {
  console.error('SUPABASE_DB_PASSWORD missing in .env');
  console.error('Get it from: Supabase Dashboard → Project Settings → Database → Database password');
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_URL ??
  `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`Connected to ${projectRef}. Applying ${files.length} migrations...\n`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz DEFAULT now()
    );
  `).catch(async () => {
    await client.query('CREATE SCHEMA IF NOT EXISTS supabase_migrations');
    await client.query(`
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz DEFAULT now()
      );
    `);
  });

  for (const file of files) {
    const { rows } = await client.query(
      'SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1',
      [file],
    );
    if (rows.length > 0) {
      console.log(`  skip  ${file} (already applied)`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    console.log(`  apply ${file}...`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      console.log(`  done  ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`  FAIL  ${file}:`, e.message);
      process.exit(1);
    }
  }

  await client.end();
  console.log('\nAll migrations applied.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
