import { getPool } from '../../shared/db.js';

const USERS_PER_PAGE = 25;
const TX_PER_PAGE = 30;

export { USERS_PER_PAGE };

export async function getDashboardStats() {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users_count,
      (SELECT COALESCE(SUM(credits), 0)::bigint FROM balances) AS total_credits,
      (SELECT COUNT(*)::int FROM pending_payments
        WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours') AS purchases_24h,
      (SELECT COALESCE(SUM(rub_amount), 0)::int FROM pending_payments
        WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours') AS revenue_rub_24h,
      (SELECT COUNT(*)::int FROM messages WHERE created_at > NOW() - INTERVAL '24 hours') AS messages_24h,
      (SELECT COUNT(*)::int FROM usage_events WHERE created_at > NOW() - INTERVAL '24 hours') AS requests_24h,
      (SELECT COUNT(*)::int FROM token_transactions WHERE created_at > NOW() - INTERVAL '24 hours') AS transactions_24h
  `);
  return rows[0];
}

export async function listUsers({ page = 1, search = '' }) {
  const pool = getPool();
  const offset = (page - 1) * USERS_PER_PAGE;
  const params = [];
  let where = '';

  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    where = `WHERE (
      u.telegram_id::text ILIKE $1
      OR u.username ILIKE $1
      OR u.first_name ILIKE $1
      OR u.id::text ILIKE $1
    )`;
  }

  const countSql = `SELECT COUNT(*)::int AS total FROM users u ${where}`;
  const { rows: countRows } = await pool.query(countSql, params);
  const total = countRows[0].total;

  const listParams = [...params, USERS_PER_PAGE, offset];
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.telegram_id,
       u.username,
       u.first_name,
       u.welcome_bonus_granted,
       u.onboarding_completed,
       u.onboarding_data->>'personality_code' AS personality_code,
       u.created_at,
       COALESCE(b.credits, 0)::bigint AS credits,
       (SELECT COUNT(*)::int FROM messages m WHERE m.user_id = u.id) AS messages_count
     FROM users u
     LEFT JOIN balances b ON b.user_id = u.id
     ${where}
     ORDER BY u.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    listParams,
  );

  return { users: rows, total, page, pages: Math.max(1, Math.ceil(total / USERS_PER_PAGE)) };
}

export async function getUserById(userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.telegram_id,
       u.username,
       u.first_name,
       u.welcome_bonus_granted,
       u.onboarding_completed,
       u.onboarding_data,
       u.onboarding_data->>'personality_code' AS personality_code,
       u.created_at,
       COALESCE(b.credits, 0)::bigint AS credits,
       (SELECT COUNT(*)::int FROM messages m WHERE m.user_id = u.id) AS messages_count
     FROM users u
     LEFT JOIN balances b ON b.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function getUserTransactions(userId, limit = TX_PER_PAGE) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, amount, type, meta, created_at
     FROM token_transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

export async function getUserUsage(userId, limit = 15) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, prompt_tokens, completion_tokens, credits_charged, model, created_at
     FROM usage_events
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

export async function listRecentCompletedPayments(limit = 20) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.*, u.telegram_id, u.username, u.first_name
     FROM pending_payments p
     JOIN users u ON u.id = p.user_id
     WHERE p.status = 'completed'
     ORDER BY p.completed_at DESC NULLS LAST, p.created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function listIncompletePayments(limit = 20) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.*, u.telegram_id, u.username, u.first_name
     FROM pending_payments p
     JOIN users u ON u.id = p.user_id
     WHERE p.status = 'pending'
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function listPaymentsByStatus(status, limit = 40) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.*, u.telegram_id, u.username, u.first_name
     FROM pending_payments p
     JOIN users u ON u.id = p.user_id
     WHERE p.status = $1
     ORDER BY p.created_at DESC
     LIMIT $2`,
    [status, limit],
  );
  return rows;
}

export async function deleteUserById(userId) {
  const pool = getPool();
  const { rowCount } = await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  return rowCount > 0;
}
