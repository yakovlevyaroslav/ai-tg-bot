import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { config } from './config.js';
import * as billing from './billing.js';
import { creditsFromRub } from './pricing.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: config.databaseUrl });

function generatePaymentCode() {
  return `PAY-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function cancelPendingForUser(userId) {
  await pool.query(
    `UPDATE pending_payments
     SET status = 'cancelled'
     WHERE user_id = $1 AND status = 'pending'`,
    [userId],
  );
}

export async function createTopupRequest(userId, rubAmount) {
  const credits = creditsFromRub(rubAmount);
  if (credits <= 0) {
    throw new Error('Invalid top-up amount');
  }

  const paymentCode = generatePaymentCode();

  const { rows } = await pool.query(
    `INSERT INTO pending_payments (user_id, payment_code, rub_amount, credits_amount)
     VALUES ($1, $2, $3, $4)
     RETURNING id, payment_code, rub_amount, credits_amount, created_at`,
    [userId, paymentCode, rubAmount, credits],
  );

  return rows[0];
}

export async function getPendingByCode(paymentCode) {
  const normalized = paymentCode.trim().toUpperCase();
  const { rows } = await pool.query(
    `SELECT p.*, u.telegram_id, u.username, u.first_name
     FROM pending_payments p
     JOIN users u ON u.id = p.user_id
     WHERE p.payment_code = $1`,
    [normalized],
  );
  return rows[0] ?? null;
}

export async function confirmPayment(paymentCode, adminTelegramId) {
  const pending = await getPendingByCode(paymentCode);

  if (!pending) {
    return { ok: false, reason: 'not_found' };
  }

  if (pending.status === 'completed') {
    return { ok: false, reason: 'already_completed', pending };
  }

  if (pending.status === 'cancelled') {
    return { ok: false, reason: 'cancelled', pending };
  }

  const idempotencyKey = `purchase:${pending.payment_code}`;

  const grantResult = await billing.grant(
    pending.user_id,
    Number(pending.credits_amount),
    'purchase',
    {
      rubAmount: pending.rub_amount,
      paymentCode: pending.payment_code,
      confirmedBy: adminTelegramId,
    },
    idempotencyKey,
  );

  await pool.query(
    `UPDATE pending_payments
     SET status = 'completed', completed_at = NOW()
     WHERE id = $1`,
    [pending.id],
  );

  return {
    ok: true,
    pending,
    balanceAfter: grantResult.balanceAfter,
    alreadyGranted: grantResult.alreadyGranted,
  };
}

export function buildPaymentInstructions(pending) {
  const lines = [
    `💳 Пополнение: ${pending.rub_amount} ₽ → ${pending.credits_amount} кредитов`,
    '',
    `Код оплаты: ${pending.payment_code}`,
    '(укажите его в комментарии к переводу)',
    '',
    config.paymentDetails,
  ];

  if (config.paymentSupportUsername) {
    lines.push('', `Вопросы: ${config.paymentSupportUsername}`);
  }

  lines.push(
    '',
    'После оплаты кредиты начисляет администратор (обычно в течение нескольких минут).',
  );

  return lines.join('\n');
}
