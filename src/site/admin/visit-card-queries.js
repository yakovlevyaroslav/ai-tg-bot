import { getPool } from '../../shared/db.js';

const VISIT_CARDS_PER_PAGE = 25;

export { VISIT_CARDS_PER_PAGE };

export async function countPublishedVisitCards() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM users WHERE visit_card_published = TRUE`,
  );
  return rows[0]?.total ?? 0;
}

export async function listPublishedVisitCards({ page = 1, search = '' }) {
  const pool = getPool();
  const offset = (page - 1) * VISIT_CARDS_PER_PAGE;
  const params = [];
  let where = 'WHERE u.visit_card_published = TRUE';

  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    where += ` AND (
      u.personality_code ILIKE $1
      OR u.telegram_id::text ILIKE $1
      OR u.username ILIKE $1
      OR u.first_name ILIKE $1
      OR u.id::text ILIKE $1
    )`;
  }

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM users u ${where}`,
    params,
  );
  const total = countRows[0].total;

  const listParams = [...params, VISIT_CARDS_PER_PAGE, offset];
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.telegram_id,
       u.username,
       u.first_name,
       u.personality_code,
       u.visit_card_published_at,
       LENGTH(COALESCE(u.visit_card_content, ''))::int AS content_length
     FROM users u
     ${where}
     ORDER BY u.visit_card_published_at DESC NULLS LAST, u.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    listParams,
  );

  return {
    visitCards: rows,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / VISIT_CARDS_PER_PAGE)),
  };
}

export async function getVisitCardByUserId(userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.telegram_id,
       u.username,
       u.first_name,
       u.personality_code,
       u.visit_card_published,
       u.visit_card_published_at,
       LENGTH(COALESCE(u.visit_card_content, ''))::int AS content_length
     FROM users u
     WHERE u.id = $1 AND u.visit_card_published = TRUE`,
    [userId],
  );
  return rows[0] ?? null;
}
