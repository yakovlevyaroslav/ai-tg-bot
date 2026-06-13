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
     RETURNING id, welcome_bonus_granted`,
    [telegramId, username ?? null, firstName ?? null],
  );
  return rows[0];
}

export async function getUserProfile(userId) {
  const { rows } = await pool.query(
    `SELECT id, telegram_id, username, first_name, welcome_bonus_granted,
            onboarding_step, onboarding_data, onboarding_completed
     FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function getUserIdByTelegramId(telegramId) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE telegram_id = $1`,
    [telegramId],
  );
  return rows[0]?.id ?? null;
}

export async function getUserAccessByTelegramId(telegramId) {
  const { rows } = await pool.query(
    `SELECT id, access_granted FROM users WHERE telegram_id = $1`,
    [telegramId],
  );
  return rows[0] ?? null;
}

export async function grantBotAccess({ telegramId, username, firstName }) {
  const { rows } = await pool.query(
    `INSERT INTO users (telegram_id, username, first_name, access_granted)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (telegram_id)
     DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       access_granted = TRUE
     RETURNING id, access_granted, welcome_bonus_granted`,
    [telegramId, username ?? null, firstName ?? null],
  );
  return rows[0];
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

export async function countUserQuestionsAsked(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM usage_events WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.count ?? 0;
}

export async function clearHistory(userId) {
  await pool.query(`DELETE FROM messages WHERE user_id = $1`, [userId]);
}

export async function resetOnboarding(userId) {
  await pool.query(
    `UPDATE users
     SET onboarding_step = NULL,
         onboarding_data = '{}',
         onboarding_completed = FALSE
     WHERE id = $1`,
    [userId],
  );
}

export async function setOnboardingStep(userId, step, dataPatch = null) {
  if (dataPatch) {
    await pool.query(
      `UPDATE users
       SET onboarding_step = $2,
           onboarding_data = onboarding_data || $3::jsonb
       WHERE id = $1`,
      [userId, step, JSON.stringify(dataPatch)],
    );
    return;
  }

  await pool.query(
    `UPDATE users SET onboarding_step = $2 WHERE id = $1`,
    [userId, step],
  );
}

export async function setOnboardingCompleted(userId, completed = true) {
  await pool.query(
    `UPDATE users SET onboarding_completed = $2 WHERE id = $1`,
    [userId, completed],
  );
}

export function getPool() {
  return pool;
}

export async function closeDb() {
  await pool.end();
}
