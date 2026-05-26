import 'dotenv/config';
import { ensureDatabase } from '../src/ensure-database.js';
import { initDb, closeDb } from '../src/db.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL in .env');
}

await ensureDatabase(databaseUrl);
await initDb();
console.log('Database schema applied');
await closeDb();
