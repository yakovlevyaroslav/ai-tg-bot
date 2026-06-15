import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getDatabaseUrl } from './env.js';
import { trackOnboardingStep } from './analytics.js';
import { sanitizeVisitCardContent } from './visit-card.js';

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
            onboarding_step, onboarding_data, onboarding_completed,
            personality_code, visit_card_published, visit_card_published_at
     FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function isVisitCardPublished(userId) {
  const profile = await getUserProfile(userId);
  return Boolean(profile?.visit_card_published);
}

export class PersonalityCodeConflictError extends Error {
  constructor(personalityCode) {
    super(`Personality code already registered: ${personalityCode}`);
    this.code = 'PERSONALITY_CODE_CONFLICT';
    this.personalityCode = personalityCode;
  }
}

export async function assignPersonalityCode(userId, personalityCode, dataPatch = null) {
  const code = String(personalityCode ?? '').trim();
  if (!code) {
    throw new Error('Personality code is required');
  }

  try {
    if (dataPatch) {
      await pool.query(
        `UPDATE users
         SET personality_code = $2,
             onboarding_data = onboarding_data || $3::jsonb
         WHERE id = $1`,
        [userId, code, JSON.stringify(dataPatch)],
      );
      return;
    }

    await pool.query(`UPDATE users SET personality_code = $2 WHERE id = $1`, [userId, code]);
  } catch (err) {
    if (err.code === '23505') {
      throw new PersonalityCodeConflictError(code);
    }
    throw err;
  }
}

export async function publishVisitCard(userId) {
  const profile = await getUserProfile(userId);
  const code = profile?.personality_code || profile?.onboarding_data?.personality_code;
  if (!code) {
    throw new Error('No personality code');
  }

  const content = sanitizeVisitCardContent(
    profile.onboarding_data?.personality_code_result,
    profile.onboarding_data,
  );

  await pool.query(
    `UPDATE users
     SET visit_card_published = TRUE,
         visit_card_published_at = NOW(),
         visit_card_content = $2
     WHERE id = $1`,
    [userId, content],
  );

  return { personalityCode: code };
}

/** Бесплатная публикация визитки после онбординга (идемпотентно) */
export async function ensureVisitCardPublished(userId) {
  const profile = await getUserProfile(userId);

  if (!profile?.onboarding_completed) {
    return null;
  }

  const code = profile.personality_code || profile.onboarding_data?.personality_code;
  if (!code) {
    return null;
  }

  if (profile.visit_card_published) {
    return { personalityCode: code };
  }

  return publishVisitCard(userId);
}

export class VisitCardAdminError extends Error {
  constructor(message, code = 'VISIT_CARD_ADMIN_ERROR') {
    super(message);
    this.code = code;
  }
}

export async function getUserByPersonalityCode(personalityCode) {
  const code = String(personalityCode ?? '').trim();
  if (!/^\d{10}$/.test(code)) {
    return null;
  }

  const { rows } = await pool.query(
    `SELECT id, telegram_id, username, first_name,
            personality_code, visit_card_published, visit_card_published_at,
            onboarding_data, onboarding_completed
     FROM users
     WHERE personality_code = $1
        OR onboarding_data->>'personality_code' = $1
     ORDER BY CASE WHEN personality_code = $1 THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [code],
  );
  return rows[0] ?? null;
}

export async function publishVisitCardByCode(personalityCode) {
  const user = await getUserByPersonalityCode(personalityCode);
  if (!user) {
    throw new VisitCardAdminError('Пользователь с таким кодом личности не найден');
  }

  const code = user.personality_code || user.onboarding_data?.personality_code;
  if (!code) {
    throw new VisitCardAdminError('У пользователя не задан код личности');
  }

  if (!user.onboarding_data?.personality_code_result?.trim()) {
    throw new VisitCardAdminError('У пользователя нет разбора кода личности для публикации');
  }

  if (!user.personality_code) {
    await assignPersonalityCode(user.id, code, { personality_code: code });
  }

  return publishVisitCard(user.id);
}

export async function unpublishVisitCard(userId) {
  const { rowCount } = await pool.query(
    `UPDATE users
     SET visit_card_published = FALSE,
         visit_card_published_at = NULL,
         visit_card_content = NULL
     WHERE id = $1 AND visit_card_published = TRUE`,
    [userId],
  );
  return rowCount > 0;
}

export async function getPublishedVisitCard(personalityCode) {
  const code = String(personalityCode ?? '').trim();
  if (!/^\d{10}$/.test(code)) {
    return null;
  }

  const { rows } = await pool.query(
    `SELECT personality_code, visit_card_content, onboarding_data
     FROM users
     WHERE personality_code = $1 AND visit_card_published = TRUE`,
    [code],
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
         onboarding_completed = FALSE,
         personality_code = NULL,
         visit_card_published = FALSE,
         visit_card_published_at = NULL,
         visit_card_content = NULL
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
    trackOnboardingStep(userId, step);
    return;
  }

  await pool.query(
    `UPDATE users SET onboarding_step = $2 WHERE id = $1`,
    [userId, step],
  );

  trackOnboardingStep(userId, step);
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
