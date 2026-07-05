import { getPool } from '../../shared/db.js';
import { config } from '../../shared/config.js';
import { ONBOARDING_FUNNEL_STEPS } from './analytics-queries.js';
import { appendStartPayloadFilters, parseStartPayloadFilters } from './user-audience-sql.js';

export const BROADCAST_MAX_RECIPIENTS = Number(process.env.BROADCAST_MAX_RECIPIENTS || 10_000);

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
  const days = [7, 30, 90, 0].includes(period) ? period : 30;
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
    minCredits: Number.isFinite(Number(query.min_credits)) ? Number(query.min_credits) : null,
    maxCredits: Number.isFinite(Number(query.max_credits)) ? Number(query.max_credits) : null,
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

  if (filters.minCredits != null) {
    params.push(filters.minCredits);
    clauses.push(`COALESCE(b.credits, 0) >= $${params.length}`);
  }

  if (filters.maxCredits != null) {
    params.push(filters.maxCredits);
    clauses.push(`COALESCE(b.credits, 0) <= $${params.length}`);
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

function shiftSqlParams(sql, offset) {
  if (!offset) {
    return sql;
  }
  return sql.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + offset}`);
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

    const { rows: campaignRows } = await client.query(
      `INSERT INTO broadcast_campaigns (
         name, message_text, photo_url, photo_file_id, reply_markup, filters, sort_order,
         status, total_recipients
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 'queued', $8)
       RETURNING *`,
      [
        name,
        messageText,
        photoUrl || null,
        photoFileId || null,
        replyMarkup ? JSON.stringify(replyMarkup) : null,
        JSON.stringify(filters),
        sortOrder,
        total,
      ],
    );

    const campaign = campaignRows[0];
    const insertParams = [campaign.id];
    const { whereSql } = buildAudienceWhere(filters, insertParams);
    insertParams.push(filters.limit);
    const limitIdx = insertParams.length;
    const shiftedWhere = shiftSqlParams(whereSql, 1);
    const orderSql = SORT_SQL[filters.sortOrder] ?? SORT_SQL.created_at_desc;

    await client.query(
      `INSERT INTO broadcast_deliveries (campaign_id, user_id, telegram_id)
       SELECT $1, u.id, u.telegram_id
       FROM users u
       LEFT JOIN balances b ON b.user_id = u.id
       WHERE ${shiftedWhere}
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
