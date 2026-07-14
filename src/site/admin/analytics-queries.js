import { getPool } from '../../shared/db.js';
import { config } from '../../shared/config.js';

export const ONBOARDING_FUNNEL_STEPS = [
  { key: 'bot.start', label: '/start', event: 'bot.start' },
  { key: 'await_name', label: 'Имя', event: 'onboarding.step', step: 'await_name' },
  { key: 'await_gender', label: 'Пол', event: 'onboarding.step', step: 'await_gender' },
  { key: 'await_birth_date', label: 'Дата рождения', event: 'onboarding.step', step: 'await_birth_date' },
  { key: 'await_birth_place', label: 'Место рождения', event: 'onboarding.step', step: 'await_birth_place' },
  { key: 'await_birth_time', label: 'Время рождения', event: 'onboarding.step', step: 'await_birth_time' },
  { key: 'await_confirm', label: 'Подтверждение', event: 'onboarding.step', step: 'await_confirm' },
  { key: 'calculating', label: 'Расчёт кода', event: 'onboarding.step', step: 'calculating' },
  {
    key: 'completed',
    label: 'Код получен',
    event: 'personality_code.generated',
  },
  { key: 'question.asked', label: 'Первый вопрос', event: 'question.asked' },
  { key: 'question.answered', label: 'Первый ответ', event: 'question.answered' },
];

export const PAYMENT_FUNNEL_STEPS = [
  { key: 'tariffs.opened', label: 'Открыли тарифы', event: 'tariffs.opened' },
  { key: 'payment.package_selected', label: 'Выбрали пакет', event: 'payment.package_selected' },
  { key: 'payment.created', label: 'Создан платёж', event: 'payment.created' },
  { key: 'payment.completed', label: 'Оплата прошла', event: 'payment.completed' },
];

function adminExcludeClause(alias = 'u', startIdx = 1) {
  const ids = config.adminTelegramIds.filter(Number.isFinite);
  if (!ids.length) {
    return { sql: '', params: [] };
  }
  return {
    sql: ` AND ${alias}.telegram_id NOT IN (${ids.map((_, i) => `$${startIdx + i}`).join(', ')})`,
    params: ids,
  };
}

async function countDistinctUsers({ eventName, step = null, days }) {
  const pool = getPool();
  const params = [eventName];
  const clauses = ['ae.event_name = $1'];

  if (step) {
    params.push(step);
    clauses.push(`ae.step = $${params.length}`);
  }

  if (days > 0) {
    params.push(days);
    clauses.push(`ae.created_at > NOW() - ($${params.length}::int * INTERVAL '1 day')`);
  }

  const admin = adminExcludeClause('u', params.length + 1);
  params.push(...admin.params);

  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT ae.user_id)::int AS count
     FROM analytics_events ae
     JOIN users u ON u.id = ae.user_id
     WHERE ${clauses.join(' AND ')}
       ${admin.sql}`,
    params,
  );

  return rows[0]?.count ?? 0;
}

export async function getOnboardingFunnel(days = 30) {
  const rows = [];

  for (const step of ONBOARDING_FUNNEL_STEPS) {
    const users = await countDistinctUsers({
      eventName: step.event,
      step: step.step ?? null,
      days,
    });
    rows.push({ ...step, users });
  }

  for (let i = 0; i < rows.length; i += 1) {
    const prev = i > 0 ? rows[i - 1].users : rows[i].users;
    rows[i].conversion =
      i === 0 || !prev ? 100 : Math.round((rows[i].users / prev) * 1000) / 10;
  }

  return rows;
}

export async function getPaymentFunnel(days = 30) {
  const rows = [];

  for (const step of PAYMENT_FUNNEL_STEPS) {
    const users = await countDistinctUsers({
      eventName: step.event,
      days,
    });
    rows.push({ ...step, users });
  }

  for (let i = 0; i < rows.length; i += 1) {
    const prev = i > 0 ? rows[i - 1].users : rows[i].users;
    rows[i].conversion =
      i === 0 || !prev ? 100 : Math.round((rows[i].users / prev) * 1000) / 10;
  }

  return rows;
}

export async function getStuckOnboardingUsers({ hours = 24, limit = 25 } = {}) {
  const pool = getPool();
  const params = [hours, limit];
  const admin = adminExcludeClause('u', params.length + 1);
  params.push(...admin.params);

  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.telegram_id,
       u.username,
       u.first_name,
       u.onboarding_step,
       MAX(ae.created_at) AS last_activity
     FROM users u
     JOIN analytics_events ae ON ae.user_id = u.id
     WHERE u.onboarding_completed = FALSE
       AND u.onboarding_step IS NOT NULL
       AND u.onboarding_step NOT IN ('calculating')
       ${admin.sql}
     GROUP BY u.id
     HAVING MAX(ae.created_at) < NOW() - ($1::int * INTERVAL '1 hour')
     ORDER BY last_activity ASC
     LIMIT $2`,
    params,
  );

  return rows;
}

export async function getRecentAnalyticsEvents(limit = 30) {
  const pool = getPool();
  const params = [limit];
  const admin = adminExcludeClause('u', params.length + 1);
  params.push(...admin.params);

  const { rows } = await pool.query(
    `SELECT ae.event_name, ae.step, ae.meta, ae.created_at,
            u.id AS user_id, u.telegram_id, u.username, u.first_name
     FROM analytics_events ae
     JOIN users u ON u.id = ae.user_id
     WHERE TRUE ${admin.sql}
     ORDER BY ae.created_at DESC
     LIMIT $1`,
    params,
  );

  return rows;
}

export async function getAnalyticsSummary(days = 30) {
  const pool = getPool();
  const params = [];
  const clauses = ['TRUE'];

  if (days > 0) {
    params.push(days);
    clauses.push(`ae.created_at > NOW() - ($${params.length}::int * INTERVAL '1 day')`);
  }

  const admin = adminExcludeClause('u', params.length + 1);
  params.push(...admin.params);

  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS events_total,
       COUNT(DISTINCT ae.user_id)::int AS active_users
     FROM analytics_events ae
     JOIN users u ON u.id = ae.user_id
     WHERE ${clauses.join(' AND ')} ${admin.sql}`,
    params,
  );

  return rows[0];
}
