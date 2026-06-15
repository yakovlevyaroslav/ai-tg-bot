/**
 * Инициализация БД — только DATABASE_URL, без TELEGRAM_BOT_TOKEN.
 */
import '../src/shared/load-env.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ensureDatabase } from '../src/shared/ensure-database.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL in .env.bot (or the file passed via --env-file)');
}

await ensureDatabase(databaseUrl);

const pool = new pg.Pool({ connectionString: databaseUrl });
const sqlPath = join(dirname(fileURLToPath(import.meta.url)), '../sql/init.sql');
const sql = readFileSync(sqlPath, 'utf8');

try {
  await pool.query(sql);
  console.log('Database schema applied');
} finally {
  await pool.end();
}
