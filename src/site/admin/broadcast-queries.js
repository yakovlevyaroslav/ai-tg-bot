import { getPool } from '../../shared/db.js';
import { config } from '../../shared/config.js';
import { ONBOARDING_FUNNEL_STEPS } from './analytics-queries.js';
import { appendStartPayloadFilters, parseStartPayloadFilters } from './user-audience-sql.js';

export const BROADCAST_MAX_RECIPIENTS = Number(process.env.BROADCAST_MAX_RECIPIENTS || 10_000);
export const BROADCAST_DELIVERIES_PER_PAGE = 50;

const DELIVERY_STATUS_LABELS = {
  pending: 'В очереди',
  sent: 'Отправлено',
  failed: 'Ошибка',
  skipped: 'Пропущено',
};

export { DELIVERY_STATUS_LABELS };

export const BROADCAST_SORT_OPTIONS = [
  { value: 'created_at_desc', label: 'Регистрация: новые → старые' },
  { value: 'created_at_asc', label: 'Регистрация: старые → новые' },
  { value: 'last_activity_desc', label: 'Активность: недавно → давно' },
  { value: 'last_activity_asc', label: 'Активность: давно → недавно' },
  { value: 'credits_desc', label: 'Баланс: больше → меньше' },
  { value: 'credits_asc', label: 'Баланс: меньше → больше' },
  { value: 'messages_desc', label: 'Сообщений: больше → меньше' },
  { value: 'questions_desc', label: 'Вопросов к AI: больше → меньше' },
  { value: 'start_payload_asc', label: 'Метка ?start=: А → Я' },
  { value: 'start_payload_desc', label: 'Метка ?start=: Я → А' },
  { value: 'name_asc', label: 'Имя: А → Я' },
];

const SORT_SQL = {
  created_at_desc: 'u.created_at DESC',
  created_at_asc: 'u.created_at ASC',
  last_activity_desc: 'last_activity DESC NULLS LAST',
  last_activity_asc: 'last_activity ASC NULLS LAST',
  credits_desc: 'credits DESC',
  credits_asc: 'credits ASC',
  messages_desc: 'messages_count DESC',
  messages_asc: 'messages_count ASC',
  questions_desc: 'questions_count DESC',
  questions_asc: 'questions_count ASC',
  start_payload_asc: 'u.start_payload ASC NULLS LAST',
  start_payload_desc: 'u.start_payload DESC NULLS LAST',
  name_asc: "LOWER(COALESCE(NULLIF(u.first_name, ''), NULLIF(u.username, ''), u.telegram_id::text)) ASC",
};

const BROADCAST_ORDER_SQL = {
  ...SORT_SQL,
  last_activity_desc:
    '(SELECT MAX(ae.created_at) FROM analytics_events ae WHERE ae.user_id = u.id) DESC NULLS LAST',
  last_activity_asc:
    '(SELECT MAX(ae.created_at) FROM analytics_events ae WHERE ae.user_id = u.id) ASC NULLS LAST',
  credits_desc: 'COALESCE(b.credits, 0) DESC',
  credits_asc: 'COALESCE(b.credits, 0) ASC',
  messages_desc: '(SELECT COUNT(*)::int FROM messages m WHERE m.user_id = u.id) DESC',
  messages_asc: '(SELECT COUNT(*)::int FROM messages m WHERE m.user_id = u.id) ASC',
  questions_desc: '(SELECT COUNT(*)::int FROM usage_events ue WHERE ue.user_id = u.id) DESC',
  questions_asc: '(SELECT COUNT(*)::int FROM usage_events ue WHERE ue.user_id = u.id) ASC',
};

export const ONBOARDING_STEP_OPTIONS = ONBOARDING_FUNNEL_STEPS.filter((item) => item.step).map(
  (item) => ({ value: item.step, label: item.label }),
);

/** Этапы воронки: после анкеты код и визитка выдаются вместе (ensureVisitCardPublished) */
export const AUDIENCE_STAGE_OPTIONS = [
  { value: '', label: 'Все пользователи' },
  { value: 'in_progress', label: 'В процессе анкеты' },
  { value: 'completed', label: 'Анкета завершена' },
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

function parseIsoDate(value) {
  const raw = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export function parseAudienceFilters(query = {}) {
  const period = Number(query.period);
  const days = Number.isFinite(period) && [7, 30, 90, 0].includes(period) ? period : 0;
  const dateFrom = parseIsoDate(query.date_from);
  const dateTo = parseIsoDate(query.date_to);
  const useCustomRange = Boolean(dateFrom || dateTo);
  const sortCandidate = String(query.sort_order || query.sort || 'created_at_desc').trim();

  return {
    days: useCustomRange ? null : days,
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    useCustomRange,
    excludeAdmins: query.exclude_admins !== '0',
    search: String(query.search ?? '').trim(),
    audienceStage: ['in_progress', 'completed'].includes(query.audience_stage)
      ? query.audience_stage
      : '',
    welcomeBonus: ['yes', 'no'].includes(query.welcome_bonus) ? query.welcome_bonus : '',
    gender: ['male', 'female'].includes(query.gender) ? query.gender : '',
    onboardingStep:
      query.audience_stage === 'in_progress'
        ? String(query.onboarding_step ?? '').trim()
        : '',
    hasPayment: ['yes', 'no'].includes(query.has_payment) ? query.has_payment : '',
    balanceFilter: ['zero', 'positive'].includes(query.balance_filter) ? query.balance_filter : 'all',
    inactiveDays: Number.isFinite(Number(query.inactive_days))
      ? Math.max(0, Number(query.inactive_days))
      : null,
    ...parseStartPayloadFilters(query),
    sortOrder: SORT_SQL[sortCandidate] ? sortCandidate : 'created_at_desc',
    limit: Math.min(
      Math.max(Number(query.limit) || BROADCAST_MAX_RECIPIENTS, 1),
      BROADCAST_MAX_RECIPIENTS,
    ),
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

function buildAudienceWhere(filters, params) {
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
      OR u.start_payload ILIKE $${params.length}
      OR EXISTS (
        SELECT 1 FROM user_start_payloads usp
        WHERE usp.user_id = u.id AND usp.payload ILIKE $${params.length}
      )
    )`);
  }

  if (filters.audienceStage === 'in_progress') {
    clauses.push('u.onboarding_completed = FALSE');
  } else if (filters.audienceStage === 'completed') {
    clauses.push('u.onboarding_completed = TRUE');
  }

  if (filters.welcomeBonus === 'yes') {
    clauses.push('u.welcome_bonus_granted = TRUE');
  } else if (filters.welcomeBonus === 'no') {
    clauses.push('COALESCE(u.welcome_bonus_granted, FALSE) = FALSE');
  }

  if (filters.gender) {
    params.push(filters.gender);
    clauses.push(`u.onboarding_data->>'gender' = $${params.length}`);
  }

  if (filters.onboardingStep && filters.audienceStage === 'in_progress') {
    params.push(filters.onboardingStep);
    clauses.push(`u.onboarding_step = $${params.length}`);
  }

  if (filters.hasPayment === 'yes') {
    clauses.push(`EXISTS (
      SELECT 1 FROM pending_payments p
      WHERE p.user_id = u.id AND p.status = 'completed'
    )`);
  } else if (filters.hasPayment === 'no') {
    clauses.push(`NOT EXISTS (
      SELECT 1 FROM pending_payments p
      WHERE p.user_id = u.id AND p.status = 'completed'
    )`);
  }

  if (filters.balanceFilter === 'zero') {
    clauses.push('COALESCE(b.credits, 0) = 0');
  } else if (filters.balanceFilter === 'positive') {
    clauses.push('COALESCE(b.credits, 0) > 0');
  }

  if (filters.inactiveDays != null && filters.inactiveDays > 0) {
    params.push(filters.inactiveDays);
    clauses.push(`COALESCE(
      (SELECT MAX(ae.created_at) FROM analytics_events ae WHERE ae.user_id = u.id),
      u.created_at
    ) < NOW() - ($${params.length}::int * INTERVAL '1 day')`);
  }

  appendStartPayloadFilters({ filters, params, clauses });

  const admin = adminExcludeClause('u', params.length + 1);
  params.push(...admin.params);

  return { whereSql: clauses.join(' AND ') + admin.sql, params };
}

export async function countAudienceRecipients(filters) {
  const pool = getPool();
  const params = [];
  const { whereSql } = buildAudienceWhere(filters, params);

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM users u
     LEFT JOIN balances b ON b.user_id = u.id
     WHERE ${whereSql}`,
    params,
  );

  return rows[0]?.total ?? 0;
}

export async function createBroadcastCampaign({
  name,
  messageText,
  photoUrl = '',
  photoFileId = null,
  replyMarkup = null,
  filters,
  sortOrder = 'created_at_desc',
  scheduledAt = null,
}) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const total = await countAudienceRecipients(filters);
    if (total === 0) {
      throw new BroadcastError('По выбранным фильтрам не найдено получателей');
    }

    if (total > BROADCAST_MAX_RECIPIENTS) {
      throw new BroadcastError(
        `Слишком много получателей (${total}). Максимум: ${BROADCAST_MAX_RECIPIENTS}. Уточните фильтры.`,
      );
    }

    const status = scheduledAt ? 'scheduled' : 'queued';

    const { rows: campaignRows } = await client.query(
      `INSERT INTO broadcast_campaigns (
         name, message_text, photo_url, photo_file_id, reply_markup, filters, sort_order,
         status, total_recipients, scheduled_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
       RETURNING *`,
      [
        name,
        messageText,
        photoUrl || null,
        photoFileId || null,
        replyMarkup ? JSON.stringify(replyMarkup) : null,
        JSON.stringify(filters),
        sortOrder,
        status,
        total,
        scheduledAt,
      ],
    );

    const campaign = campaignRows[0];
    const insertParams = [campaign.id];
    const { whereSql } = buildAudienceWhere(filters, insertParams);
    insertParams.push(filters.limit);
    const limitIdx = insertParams.length;
    const orderSql = BROADCAST_ORDER_SQL[filters.sortOrder] ?? BROADCAST_ORDER_SQL.created_at_desc;

    await client.query(
      `INSERT INTO broadcast_deliveries (campaign_id, user_id, telegram_id)
       SELECT $1, u.id, u.telegram_id
       FROM users u
       LEFT JOIN balances b ON b.user_id = u.id
       WHERE ${whereSql}
       ORDER BY ${orderSql}
       LIMIT $${limitIdx}`,
      insertParams,
    );

    await client.query('COMMIT');
    return campaign;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export class BroadcastError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BroadcastError';
  }
}

export async function listBroadcastCampaigns(limit = 20) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT *
     FROM broadcast_campaigns
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function getBroadcastCampaign(id) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM broadcast_campaigns WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getBroadcastCampaignStats(id) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM broadcast_deliveries
     WHERE campaign_id = $1
     GROUP BY status`,
    [id],
  );
  return rows;
}

export async function listBroadcastFailures(id, limit = 15) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT d.telegram_id, d.error_description, d.sent_at,
            u.id AS user_id, u.username, u.first_name
     FROM broadcast_deliveries d
     JOIN users u ON u.id = d.user_id
     WHERE d.campaign_id = $1 AND d.status = 'failed'
     ORDER BY d.id DESC
     LIMIT $2`,
    [id, limit],
  );
  return rows;
}

export function normalizeCampaignFilters(raw) {
  if (!raw) {
    return {};
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

const GENDER_LABELS = { male: 'Мужской', female: 'Женский' };

export function describeAudienceFilters(filters = {}) {
  const items = [];

  if (filters.useCustomRange) {
    if (filters.dateFrom) {
      items.push({ label: 'Регистрация с', value: filters.dateFrom });
    }
    if (filters.dateTo) {
      items.push({ label: 'Регистрация по', value: filters.dateTo });
    }
  } else if (filters.days > 0) {
    items.push({ label: 'Период регистрации', value: `последние ${filters.days} дн.` });
  } else {
    items.push({ label: 'Период регистрации', value: 'всё время' });
  }

  if (filters.search) {
    items.push({ label: 'Поиск', value: filters.search });
  }

  const stage = AUDIENCE_STAGE_OPTIONS.find((option) => option.value === filters.audienceStage);
  if (stage?.value) {
    items.push({ label: 'Статус пользователя', value: stage.label });
  }

  if (filters.onboardingStep) {
    const step = ONBOARDING_STEP_OPTIONS.find((option) => option.value === filters.onboardingStep);
    items.push({ label: 'Шаг анкеты', value: step?.label ?? filters.onboardingStep });
  }

  if (filters.gender) {
    items.push({ label: 'Пол', value: GENDER_LABELS[filters.gender] ?? filters.gender });
  }

  if (filters.startPayload) {
    items.push({ label: 'Метка ?start=', value: filters.startPayload });
  }
  if (filters.hasStartPayload === 'yes') {
    items.push({ label: 'Есть метку', value: 'да' });
  } else if (filters.hasStartPayload === 'no') {
    items.push({ label: 'Есть метку', value: 'нет (organic)' });
  }

  if (filters.welcomeBonus === 'yes') {
    items.push({ label: 'Стартовый бонус', value: 'получен' });
  } else if (filters.welcomeBonus === 'no') {
    items.push({ label: 'Стартовый бонус', value: 'нет' });
  }

  if (filters.hasPayment === 'yes') {
    items.push({ label: 'Была оплата', value: 'да' });
  } else if (filters.hasPayment === 'no') {
    items.push({ label: 'Была оплата', value: 'нет' });
  }

  const balanceLabels = {
    all: 'все пользователи',
    zero: 'баланс 0',
    positive: 'баланс > 0',
  };
  items.push({
    label: 'Баланс',
    value: balanceLabels[filters.balanceFilter] ?? balanceLabels.all,
  });

  if (filters.inactiveDays > 0) {
    items.push({ label: 'Неактивны', value: `${filters.inactiveDays} дн.` });
  }

  const sort = BROADCAST_SORT_OPTIONS.find((option) => option.value === filters.sortOrder);
  items.push({ label: 'Сортировка', value: sort?.label ?? filters.sortOrder ?? '—' });
  items.push({ label: 'Лимит получателей', value: String(filters.limit ?? BROADCAST_MAX_RECIPIENTS) });
  items.push({ label: 'Исключить админов', value: filters.excludeAdmins === false ? 'нет' : 'да' });

  return items;
}

export async function countBroadcastDeliveries(campaignId, status = '') {
  const pool = getPool();
  const params = [campaignId];
  let statusClause = '';

  if (status && DELIVERY_STATUS_LABELS[status]) {
    params.push(status);
    statusClause = ` AND d.status = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM broadcast_deliveries d
     WHERE d.campaign_id = $1${statusClause}`,
    params,
  );

  return rows[0]?.total ?? 0;
}

export async function listBroadcastDeliveries({
  campaignId,
  status = '',
  page = 1,
  limit = BROADCAST_DELIVERIES_PER_PAGE,
}) {
  const pool = getPool();
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(Number(limit) || BROADCAST_DELIVERIES_PER_PAGE, 1), 200);
  const offset = (safePage - 1) * safeLimit;
  const params = [campaignId];
  let statusClause = '';

  if (status && DELIVERY_STATUS_LABELS[status]) {
    params.push(status);
    statusClause = ` AND d.status = $${params.length}`;
  }

  params.push(safeLimit, offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const { rows } = await pool.query(
    `SELECT
       d.id,
       d.status,
       d.telegram_id,
       d.sent_at,
       d.error_description,
       u.id AS user_id,
       u.username,
       u.first_name,
       NULLIF(TRIM(u.onboarding_data->>'name'), '') AS onboarding_name,
       NULLIF(TRIM(u.start_payload), '') AS start_payload,
       COALESCE(b.credits, 0)::bigint AS credits,
       COALESCE(u.personality_code, u.onboarding_data->>'personality_code') AS personality_code
     FROM broadcast_deliveries d
     JOIN users u ON u.id = d.user_id
     LEFT JOIN balances b ON b.user_id = u.id
     WHERE d.campaign_id = $1${statusClause}
     ORDER BY
       CASE d.status
         WHEN 'sent' THEN 0
         WHEN 'failed' THEN 1
         WHEN 'pending' THEN 2
         ELSE 3
       END,
       d.sent_at DESC NULLS LAST,
       d.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return rows;
}

export async function updateBroadcastCampaignPhotoFileId(campaignId, photoFileId) {
  const pool = getPool();
  await pool.query(
    `UPDATE broadcast_campaigns SET photo_file_id = $2 WHERE id = $1`,
    [campaignId, photoFileId],
  );
}

export async function setBroadcastCampaignStatus(id, status) {
  const pool = getPool();
  const extra =
    status === 'running'
      ? ', started_at = COALESCE(started_at, NOW())'
      : status === 'completed' || status === 'cancelled'
        ? ', completed_at = NOW()'
        : '';

  await pool.query(
    `UPDATE broadcast_campaigns SET status = $2${extra} WHERE id = $1`,
    [id, status],
  );
}

export async function getActiveBroadcastCampaign() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT *
     FROM broadcast_campaigns
     WHERE status IN ('queued', 'running')
     ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

/** Переводит due scheduled → queued (время уже наступило). */
export async function promoteDueScheduledCampaigns() {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE broadcast_campaigns
     SET status = 'queued'
     WHERE status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at <= NOW()
     RETURNING id`,
  );
  return rows.map((row) => row.id);
}

export async function claimPendingDeliveries(campaignId, limit) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT d.id, d.user_id, d.telegram_id,
            u.first_name, u.onboarding_completed, u.onboarding_data
     FROM broadcast_deliveries d
     JOIN users u ON u.id = d.user_id
     WHERE d.campaign_id = $1 AND d.status = 'pending'
     ORDER BY d.id ASC
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [campaignId, limit],
  );
  return rows;
}

export async function markDeliverySent(deliveryId) {
  const pool = getPool();
  await pool.query(
    `UPDATE broadcast_deliveries
     SET status = 'sent', sent_at = NOW(), error_description = NULL
     WHERE id = $1`,
    [deliveryId],
  );
}

export async function markDeliveryFailed(deliveryId, description) {
  const pool = getPool();
  await pool.query(
    `UPDATE broadcast_deliveries
     SET status = 'failed', error_description = $2
     WHERE id = $1`,
    [deliveryId, description?.slice(0, 500) ?? 'Unknown error'],
  );
}

export async function skipPendingDeliveries(campaignId) {
  const pool = getPool();
  await pool.query(
    `UPDATE broadcast_deliveries
     SET status = 'skipped'
     WHERE campaign_id = $1 AND status = 'pending'`,
    [campaignId],
  );
}

export async function refreshBroadcastCampaignCounters(campaignId) {
  const pool = getPool();
  await pool.query(
    `UPDATE broadcast_campaigns c SET
       sent_count = (SELECT COUNT(*)::int FROM broadcast_deliveries d WHERE d.campaign_id = c.id AND d.status = 'sent'),
       failed_count = (SELECT COUNT(*)::int FROM broadcast_deliveries d WHERE d.campaign_id = c.id AND d.status = 'failed'),
       skipped_count = (SELECT COUNT(*)::int FROM broadcast_deliveries d WHERE d.campaign_id = c.id AND d.status = 'skipped')
     WHERE c.id = $1`,
    [campaignId],
  );

  const campaign = await getBroadcastCampaign(campaignId);
  if (!campaign) {
    return null;
  }

  const pending = campaign.total_recipients - campaign.sent_count - campaign.failed_count - campaign.skipped_count;

  if (campaign.status === 'running' && pending <= 0) {
    await setBroadcastCampaignStatus(campaignId, 'completed');
    return getBroadcastCampaign(campaignId);
  }

  return campaign;
}

export async function promoteQueuedCampaign(campaignId) {
  await setBroadcastCampaignStatus(campaignId, 'running');
}
