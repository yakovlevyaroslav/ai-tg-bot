import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getDatabaseUrl } from './env.js';

const { Pool } = pg;

const pool = new Pool({ connectionString: getDatabaseUrl() });

export async function initDb() {
  const sqlPath = join(dirname(fileURLToPath(import.meta.url)), '../../sql/init.sql');
  const sql = readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function upsertUser({ telegramId, username, firstName }) {
  const { rows } = await pool.query(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id)
     DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name
     RETURNING id, welcome_bonus_granted, specialist`,
    [telegramId, username ?? null, firstName ?? null],
  );
  return rows[0];
}

export async function getUserProfile(userId) {
  const { rows } = await pool.query(
    `SELECT id, telegram_id, username, first_name, specialist, welcome_bonus_granted
     FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function setUserSpecialist(userId, specialist) {
  const { rows } = await pool.query(
    `UPDATE users SET specialist = $2 WHERE id = $1 RETURNING specialist`,
    [userId, specialist],
  );
  return rows[0]?.specialist ?? null;
}

export async function getUserIdByTelegramId(telegramId) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE telegram_id = $1`,
    [telegramId],
  );
  return rows[0]?.id ?? null;
}

export async function getHistory(userId, limit) {
  const { rows } = await pool.query(
    `SELECT role, content
     FROM messages
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.reverse();
}

export async function saveMessage(userId, role, content) {
  await pool.query(
    `INSERT INTO messages (user_id, role, content) VALUES ($1, $2, $3)`,
    [userId, role, content],
  );
}

export async function clearHistory(userId) {
  await pool.query(`DELETE FROM messages WHERE user_id = $1`, [userId]);
}

export function getPool() {
  return pool;
}

export async function closeDb() {
  await pool.end();
}
