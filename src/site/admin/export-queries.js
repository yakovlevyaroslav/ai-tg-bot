import { getPool } from '../../shared/db.js';
import { config } from '../../shared/config.js';
import { EVENTS } from '../../shared/analytics.js';
import {
  getOnboardingFunnel,
  getPaymentFunnel,
  ONBOARDING_FUNNEL_STEPS,
  PAYMENT_FUNNEL_STEPS,
} from './analytics-queries.js';

export const EXPORT_TYPES = {
  users: {
    label: 'Пользователи',
    description: 'Регистрации, анкета, код личности, баланс, активность',
    dateField: 'created_at',
  },
  payments: {
    label: 'Оплаты',
    description: 'Платежи ЮKassa и ручные, статусы, суммы',
    dateField: 'created_at',
  },
  events: {
    label: 'События аналитики',
    description: 'Сырые события воронки и действий пользователей',
    dateField: 'created_at',
  },
  usage: {
    label: 'Запросы к AI',
    description: 'usage_events: модель, токены, списанные вопросы',
    dateField: 'created_at',
  },
  transactions: {
    label: 'Транзакции баланса',
    description: 'Начисления, списания, покупки, бонусы',
    dateField: 'created_at',
  },
  visit_cards: {
    label: 'Визитки',
    description: 'Опубликованные визитки по коду личности',
    dateField: 'visit_card_published_at',
  },
  funnel_onboarding: {
    label: 'Воронка анкеты',
    description: 'Конверсия по шагам анкеты и первого вопроса',
    aggregated: true,
  },
  funnel_payment: {
    label: 'Воронка оплаты',
    description: 'Конверсия от тарифов до успешной оплаты',
    aggregated: true,
  },
  daily: {
    label: 'Сводка по дням',
    description: 'Регистрации, вопросы, оплаты и выручка по календарным дням',
    aggregated: true,
  },
};

export const EVENT_NAME_OPTIONS = Object.values(EVENTS).sort();

const MAX_ROWS = 50_000;

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

function parseIsoDate(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  return raw;
}

export function parseExportFilters(query = {}) {
  const type = EXPORT_TYPES[query.type] ? query.type : 'users';
  const period = Number(query.period);
  const days = [7, 30, 90, 0].includes(period) ? period : 30;
  const dateFrom = parseIsoDate(query.date_from);
  const dateTo = parseIsoDate(query.date_to);
  const useCustomRange = Boolean(dateFrom || dateTo);

  return {
    type,
    days: useCustomRange ? null : days,
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    useCustomRange,
    excludeAdmins: query.exclude_admins !== '0',
    search: String(query.search ?? '').trim(),
    onboarding: ['yes', 'no'].includes(query.onboarding) ? query.onboarding : '',
    hasCode: ['yes', 'no'].includes(query.has_code) ? query.has_code : '',
    visitCard: ['yes', 'no'].includes(query.visit_card) ? query.visit_card : '',
    paymentStatus: ['completed', 'pending', 'cancelled', ''].includes(query.payment_status)
      ? query.payment_status
      : '',
    productType: ['topup', 'visit_card', ''].includes(query.product_type)
      ? query.product_type
      : '',
    provider: ['yookassa', 'manual', ''].includes(query.provider) ? query.provider : '',
    paymentDateField: query.payment_date === 'completed_at' ? 'completed_at' : 'created_at',
    eventName: String(query.event_name ?? '').trim(),
    eventStep: String(query.event_step ?? '').trim(),
    txType: ['bonus', 'spend', 'refund', 'grant', 'purchase', ''].includes(query.tx_type)
      ? query.tx_type
      : '',
    model: String(query.model ?? '').trim(),
    limit: Math.min(Math.max(Number(query.limit) || MAX_ROWS, 1), MAX_ROWS),
  };
}

function appendDateFilter({ column, filters, params, clauses }) {
  if (filters.useCustomRange) {
    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      clauses.push(`${column} >= $${params.length}::date`);
    }
    if (filters.dateTo) {
      params.push(filters.dateTo);
      clauses.push(`${column} < ($${params.length}::date + INTERVAL '1 day')`);
    }
    return;
  }

  if (filters.days > 0) {
    params.push(filters.days);
    clauses.push(`${column} > NOW() - ($${params.length}::int * INTERVAL '1 day')`);
  }
}

function buildAdminSql(alias, filters, params) {
  if (!filters.excludeAdmins) {
    return '';
  }
  const admin = adminExcludeClause(alias, params.length + 1);
  params.push(...admin.params);
  return admin.sql;
}

export async function exportUsers(filters) {
  const pool = getPool();
  const params = [];
  const clauses = ['TRUE'];

  appendDateFilter({ column: 'u.created_at', filters, params, clauses });

  if (filters.search) {
    params.push(`%${filters.search}%`);
    clauses.push(`(
      u.telegram_id::text ILIKE $${params.length}
      OR u.username ILIKE $${params.length}
      OR u.first_name ILIKE $${params.length}
      OR u.id::text ILIKE $${params.length}
      OR u.personality_code ILIKE $${params.length}
    )`);
  }

  if (filters.onboarding === 'yes') {
    clauses.push('u.onboarding_completed = TRUE');
  } else if (filters.onboarding === 'no') {
    clauses.push('u.onboarding_completed = FALSE');
  }

  if (filters.hasCode === 'yes') {
    clauses.push(`COALESCE(u.personality_code, u.onboarding_data->>'personality_code', '') <> ''`);
  } else if (filters.hasCode === 'no') {
    clauses.push(`COALESCE(u.personality_code, u.onboarding_data->>'personality_code', '') = ''`);
  }

  if (filters.visitCard === 'yes') {
    clauses.push('u.visit_card_published = TRUE');
  } else if (filters.visitCard === 'no') {
    clauses.push('COALESCE(u.visit_card_published, FALSE) = FALSE');
  }

  const adminSql = buildAdminSql('u', filters, params);

  params.push(filters.limit);
  const limitIdx = params.length;

  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.telegram_id,
       u.username,
       u.first_name,
       u.created_at,
       u.onboarding_completed,
       u.onboarding_step,
       COALESCE(u.personality_code, u.onboarding_data->>'personality_code') AS personality_code,
       u.visit_card_published,
       u.visit_card_published_at,
       u.welcome_bonus_granted,
       u.specialist,
       COALESCE(b.credits, 0)::bigint AS credits,
       (SELECT COUNT(*)::int FROM messages m WHERE m.user_id = u.id) AS messages_count,
       (SELECT COUNT(*)::int FROM usage_events ue WHERE ue.user_id = u.id) AS questions_count,
       (SELECT MAX(ae.created_at) FROM analytics_events ae WHERE ae.user_id = u.id) AS last_activity
     FROM users u
     LEFT JOIN balances b ON b.user_id = u.id
     WHERE ${clauses.join(' AND ')}${adminSql}
     ORDER BY u.created_at DESC
     LIMIT $${limitIdx}`,
    params,
  );

  return rows;
}

export async function exportPayments(filters) {
  const pool = getPool();
  const params = [];
  const clauses = ['TRUE'];
  const dateColumn = `p.${filters.paymentDateField}`;

  appendDateFilter({ column: dateColumn, filters, params, clauses });

  if (filters.paymentStatus) {
    params.push(filters.paymentStatus);
    clauses.push(`p.status = $${params.length}`);
  }

  if (filters.productType) {
    params.push(filters.productType);
    clauses.push(`p.product_type = $${params.length}`);
  }

  if (filters.provider) {
    params.push(filters.provider);
    clauses.push(`p.provider = $${params.length}`);
  }

  const adminSql = buildAdminSql('u', filters, params);

  params.push(filters.limit);
  const limitIdx = params.length;

  const { rows } = await pool.query(
    `SELECT
       p.id,
       p.payment_code,
       p.user_id,
       u.telegram_id,
       u.username,
       u.first_name,
       p.rub_amount,
       p.credits_amount,
       p.product_type,
       p.provider,
       p.status,
       p.external_payment_id,
       p.created_at,
       p.completed_at
     FROM pending_payments p
     JOIN users u ON u.id = p.user_id
     WHERE ${clauses.join(' AND ')}${adminSql}
     ORDER BY ${dateColumn} DESC NULLS LAST
     LIMIT $${limitIdx}`,
    params,
  );

  return rows;
}

export async function exportEvents(filters) {
  const pool = getPool();
  const params = [];
  const clauses = ['TRUE'];

  appendDateFilter({ column: 'ae.created_at', filters, params, clauses });

  if (filters.eventName) {
    params.push(filters.eventName);
    clauses.push(`ae.event_name = $${params.length}`);
  }

  if (filters.eventStep) {
    params.push(filters.eventStep);
    clauses.push(`ae.step = $${params.length}`);
  }

  const adminSql = buildAdminSql('u', filters, params);

  params.push(filters.limit);
  const limitIdx = params.length;

  const { rows } = await pool.query(
    `SELECT
       ae.id,
       ae.created_at,
       ae.user_id,
       u.telegram_id,
       u.username,
       u.first_name,
       ae.event_name,
       ae.step,
       ae.meta
     FROM analytics_events ae
     JOIN users u ON u.id = ae.user_id
     WHERE ${clauses.join(' AND ')}${adminSql}
     ORDER BY ae.created_at DESC
     LIMIT $${limitIdx}`,
    params,
  );

  return rows;
}

export async function exportUsage(filters) {
  const pool = getPool();
  const params = [];
  const clauses = ['TRUE'];

  appendDateFilter({ column: 'ue.created_at', filters, params, clauses });

  if (filters.model) {
    params.push(`%${filters.model}%`);
    clauses.push(`ue.model ILIKE $${params.length}`);
  }

  const adminSql = buildAdminSql('u', filters, params);

  params.push(filters.limit);
  const limitIdx = params.length;

  const { rows } = await pool.query(
    `SELECT
       ue.id,
       ue.created_at,
       ue.user_id,
       u.telegram_id,
       u.username,
       u.first_name,
       ue.model,
       ue.prompt_tokens,
       ue.completion_tokens,
       ue.credits_charged,
       ue.transaction_id
     FROM usage_events ue
     JOIN users u ON u.id = ue.user_id
     WHERE ${clauses.join(' AND ')}${adminSql}
     ORDER BY ue.created_at DESC
     LIMIT $${limitIdx}`,
    params,
  );

  return rows;
}

export async function exportTransactions(filters) {
  const pool = getPool();
  const params = [];
  const clauses = ['TRUE'];

  appendDateFilter({ column: 'tt.created_at', filters, params, clauses });

  if (filters.txType) {
    params.push(filters.txType);
    clauses.push(`tt.type = $${params.length}`);
  }

  const adminSql = buildAdminSql('u', filters, params);

  params.push(filters.limit);
  const limitIdx = params.length;

  const { rows } = await pool.query(
    `SELECT
       tt.id,
       tt.created_at,
       tt.user_id,
       u.telegram_id,
       u.username,
       u.first_name,
       tt.type,
       tt.amount,
       tt.meta,
       tt.idempotency_key
     FROM token_transactions tt
     JOIN users u ON u.id = tt.user_id
     WHERE ${clauses.join(' AND ')}${adminSql}
     ORDER BY tt.created_at DESC
     LIMIT $${limitIdx}`,
    params,
  );

  return rows;
}

export async function exportVisitCards(filters) {
  const pool = getPool();
  const params = [];
  const clauses = ['u.visit_card_published = TRUE'];

  appendDateFilter({ column: 'u.visit_card_published_at', filters, params, clauses });

  if (filters.search) {
    params.push(`%${filters.search}%`);
    clauses.push(`(
      u.personality_code ILIKE $${params.length}
      OR u.telegram_id::text ILIKE $${params.length}
      OR u.username ILIKE $${params.length}
      OR u.first_name ILIKE $${params.length}
    )`);
  }

  const adminSql = buildAdminSql('u', filters, params);

  params.push(filters.limit);
  const limitIdx = params.length;

  const { rows } = await pool.query(
    `SELECT
       u.id AS user_id,
       u.telegram_id,
       u.username,
       u.first_name,
       u.personality_code,
       u.visit_card_published_at,
       COALESCE(LENGTH(u.visit_card_content), 0)::int AS content_length
     FROM users u
     WHERE ${clauses.join(' AND ')}${adminSql}
     ORDER BY u.visit_card_published_at DESC NULLS LAST
     LIMIT $${limitIdx}`,
    params,
  );

  return rows;
}

export async function exportFunnelOnboarding(filters) {
  const days = filters.useCustomRange ? 0 : (filters.days ?? 30);
  const rows = await getOnboardingFunnel(days);

  return rows.map((row, index) => ({
    order: index + 1,
    step_label: row.label,
    event_name: row.event,
    step: row.step ?? '',
    users: row.users,
    conversion_pct: index === 0 ? 100 : row.conversion,
    period: filters.useCustomRange
      ? `${filters.dateFrom ?? '…'} — ${filters.dateTo ?? '…'}`
      : days === 0
        ? 'всё время'
        : `${days} дн.`,
  }));
}

export async function exportFunnelPayment(filters) {
  const days = filters.useCustomRange ? 0 : (filters.days ?? 30);
  const rows = await getPaymentFunnel(days);

  return rows.map((row, index) => ({
    order: index + 1,
    step_label: row.label,
    event_name: row.event,
    users: row.users,
    conversion_pct: index === 0 ? 100 : row.conversion,
    period: filters.useCustomRange
      ? `${filters.dateFrom ?? '…'} — ${filters.dateTo ?? '…'}`
      : days === 0
        ? 'всё время'
        : `${days} дн.`,
  }));
}

export async function exportDailySummary(filters) {
  const pool = getPool();
  const params = [];
  let startSql;
  let endSql = 'CURRENT_DATE';

  if (filters.useCustomRange) {
    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      startSql = `$${params.length}::date`;
    } else {
      startSql = `(SELECT COALESCE(MIN(DATE(created_at)), CURRENT_DATE) FROM users)`;
    }
    if (filters.dateTo) {
      params.push(filters.dateTo);
      endSql = `$${params.length}::date`;
    }
  } else if (filters.days > 0) {
    params.push(filters.days);
    startSql = `(CURRENT_DATE - ($${params.length}::int - 1) * INTERVAL '1 day')::date`;
  } else {
    startSql = `(SELECT COALESCE(MIN(DATE(created_at)), CURRENT_DATE) FROM users)`;
  }

  const adminSql = buildAdminSql('u', filters, params);
  const adminSql2 = adminSql.replace(/\bu\./g, 'u2.');
  const adminSql3 = adminSql.replace(/\bu\./g, 'u3.');
  const adminSql4 = adminSql.replace(/\bu\./g, 'u4.');

  const { rows } = await pool.query(
    `WITH days AS (
       SELECT generate_series(${startSql}, ${endSql}, INTERVAL '1 day')::date AS day
     ),
     regs AS (
       SELECT DATE(u.created_at) AS day, COUNT(*)::int AS cnt
       FROM users u
       WHERE TRUE${adminSql}
       GROUP BY 1
     ),
     completed AS (
       SELECT DATE(u.created_at) AS day, COUNT(*)::int AS cnt
       FROM users u
       WHERE u.onboarding_completed = TRUE${adminSql}
       GROUP BY 1
     ),
     ai AS (
       SELECT DATE(ue.created_at) AS day, COUNT(*)::int AS cnt
       FROM usage_events ue
       JOIN users u3 ON u3.id = ue.user_id
       WHERE TRUE${adminSql3}
       GROUP BY 1
     ),
     pays AS (
       SELECT DATE(p.completed_at) AS day,
              COUNT(*)::int AS cnt,
              COALESCE(SUM(p.rub_amount), 0)::int AS revenue
       FROM pending_payments p
       JOIN users u2 ON u2.id = p.user_id
       WHERE p.status = 'completed'${adminSql2}
       GROUP BY 1
     ),
     ev AS (
       SELECT DATE(ae.created_at) AS day, COUNT(*)::int AS cnt
       FROM analytics_events ae
       JOIN users u4 ON u4.id = ae.user_id
       WHERE TRUE${adminSql4}
       GROUP BY 1
     )
     SELECT
       d.day::text AS day,
       COALESCE(r.cnt, 0)::int AS new_users,
       COALESCE(c.cnt, 0)::int AS registered_completed_same_day,
       COALESCE(a.cnt, 0)::int AS ai_requests,
       COALESCE(p.cnt, 0)::int AS payments_completed,
       COALESCE(p.revenue, 0)::int AS revenue_rub,
       COALESCE(e.cnt, 0)::int AS analytics_events
     FROM days d
     LEFT JOIN regs r ON r.day = d.day
     LEFT JOIN completed c ON c.day = d.day
     LEFT JOIN ai a ON a.day = d.day
     LEFT JOIN pays p ON p.day = d.day
     LEFT JOIN ev e ON e.day = d.day
     ORDER BY d.day DESC`,
    params,
  );

  return rows;
}

export async function listDistinctModels() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT model FROM usage_events WHERE model IS NOT NULL AND model <> '' ORDER BY model`,
  );
  return rows.map((row) => row.model);
}

export async function listDistinctEventSteps() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT step FROM analytics_events WHERE step IS NOT NULL AND step <> '' ORDER BY step`,
  );
  return rows.map((row) => row.step);
}

const COLUMN_MAP = {
  users: [
    { key: 'id', label: 'user_id' },
    { key: 'telegram_id', label: 'telegram_id' },
    { key: 'username', label: 'username' },
    { key: 'first_name', label: 'first_name' },
    { key: 'created_at', label: 'registered_at' },
    { key: 'onboarding_completed', label: 'onboarding_completed' },
    { key: 'onboarding_step', label: 'onboarding_step' },
    { key: 'personality_code', label: 'personality_code' },
    { key: 'visit_card_published', label: 'visit_card_published' },
    { key: 'visit_card_published_at', label: 'visit_card_published_at' },
    { key: 'credits', label: 'credits_balance' },
    { key: 'messages_count', label: 'messages_count' },
    { key: 'questions_count', label: 'questions_count' },
    { key: 'welcome_bonus_granted', label: 'welcome_bonus_granted' },
    { key: 'specialist', label: 'specialist' },
    { key: 'last_activity', label: 'last_activity' },
  ],
  payments: [
    { key: 'id', label: 'payment_id' },
    { key: 'payment_code', label: 'payment_code' },
    { key: 'user_id', label: 'user_id' },
    { key: 'telegram_id', label: 'telegram_id' },
    { key: 'username', label: 'username' },
    { key: 'first_name', label: 'first_name' },
    { key: 'rub_amount', label: 'rub_amount' },
    { key: 'credits_amount', label: 'credits_amount' },
    { key: 'product_type', label: 'product_type' },
    { key: 'provider', label: 'provider' },
    { key: 'status', label: 'status' },
    { key: 'external_payment_id', label: 'external_payment_id' },
    { key: 'created_at', label: 'created_at' },
    { key: 'completed_at', label: 'completed_at' },
  ],
  events: [
    { key: 'id', label: 'event_id' },
    { key: 'created_at', label: 'created_at' },
    { key: 'user_id', label: 'user_id' },
    { key: 'telegram_id', label: 'telegram_id' },
    { key: 'username', label: 'username' },
    { key: 'first_name', label: 'first_name' },
    { key: 'event_name', label: 'event_name' },
    { key: 'step', label: 'step' },
    { key: 'meta', label: 'meta_json' },
  ],
  usage: [
    { key: 'id', label: 'usage_id' },
    { key: 'created_at', label: 'created_at' },
    { key: 'user_id', label: 'user_id' },
    { key: 'telegram_id', label: 'telegram_id' },
    { key: 'username', label: 'username' },
    { key: 'first_name', label: 'first_name' },
    { key: 'model', label: 'model' },
    { key: 'prompt_tokens', label: 'prompt_tokens' },
    { key: 'completion_tokens', label: 'completion_tokens' },
    { key: 'credits_charged', label: 'credits_charged' },
    { key: 'transaction_id', label: 'transaction_id' },
  ],
  transactions: [
    { key: 'id', label: 'transaction_id' },
    { key: 'created_at', label: 'created_at' },
    { key: 'user_id', label: 'user_id' },
    { key: 'telegram_id', label: 'telegram_id' },
    { key: 'username', label: 'username' },
    { key: 'first_name', label: 'first_name' },
    { key: 'type', label: 'type' },
    { key: 'amount', label: 'amount' },
    { key: 'meta', label: 'meta_json' },
    { key: 'idempotency_key', label: 'idempotency_key' },
  ],
  visit_cards: [
    { key: 'user_id', label: 'user_id' },
    { key: 'telegram_id', label: 'telegram_id' },
    { key: 'username', label: 'username' },
    { key: 'first_name', label: 'first_name' },
    { key: 'personality_code', label: 'personality_code' },
    { key: 'visit_card_published_at', label: 'published_at' },
    { key: 'content_length', label: 'content_length' },
  ],
  funnel_onboarding: [
    { key: 'order', label: 'step_order' },
    { key: 'step_label', label: 'step_label' },
    { key: 'event_name', label: 'event_name' },
    { key: 'step', label: 'step' },
    { key: 'users', label: 'users' },
    { key: 'conversion_pct', label: 'conversion_pct' },
    { key: 'period', label: 'period' },
  ],
  funnel_payment: [
    { key: 'order', label: 'step_order' },
    { key: 'step_label', label: 'step_label' },
    { key: 'event_name', label: 'event_name' },
    { key: 'users', label: 'users' },
    { key: 'conversion_pct', label: 'conversion_pct' },
    { key: 'period', label: 'period' },
  ],
  daily: [
    { key: 'day', label: 'day' },
    { key: 'new_users', label: 'new_users' },
    { key: 'registered_completed_same_day', label: 'registered_completed_same_day' },
    { key: 'ai_requests', label: 'ai_requests' },
    { key: 'payments_completed', label: 'payments_completed' },
    { key: 'revenue_rub', label: 'revenue_rub' },
    { key: 'analytics_events', label: 'analytics_events' },
  ],
};

export function getExportColumns(type) {
  return COLUMN_MAP[type] ?? [];
}

export async function runExport(filters) {
  switch (filters.type) {
    case 'users':
      return exportUsers(filters);
    case 'payments':
      return exportPayments(filters);
    case 'events':
      return exportEvents(filters);
    case 'usage':
      return exportUsage(filters);
    case 'transactions':
      return exportTransactions(filters);
    case 'visit_cards':
      return exportVisitCards(filters);
    case 'funnel_onboarding':
      return exportFunnelOnboarding(filters);
    case 'funnel_payment':
      return exportFunnelPayment(filters);
    case 'daily':
      return exportDailySummary(filters);
    default:
      return exportUsers(filters);
  }
}

export { ONBOARDING_FUNNEL_STEPS, PAYMENT_FUNNEL_STEPS };
