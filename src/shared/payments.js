import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { config } from './config.js';
import * as billing from './billing.js';
import { EVENTS, trackEvent } from './analytics.js';

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

export async function createTopupRequest(userId, rubAmount, requests) {
  if (requests <= 0) {
    throw new Error('Invalid top-up amount');
  }

  const paymentCode = generatePaymentCode();

  const { rows } = await pool.query(
    `INSERT INTO pending_payments (user_id, payment_code, rub_amount, credits_amount, provider)
     VALUES ($1, $2, $3, $4, 'yookassa')
     RETURNING id, payment_code, rub_amount, credits_amount, provider, created_at`,
    [userId, paymentCode, rubAmount, requests],
  );

  return rows[0];
}

export async function attachExternalPaymentId(pendingId, externalPaymentId) {
  await pool.query(
    `UPDATE pending_payments SET external_payment_id = $2 WHERE id = $1`,
    [pendingId, externalPaymentId],
  );
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

export async function completeYookassaPayment(paymentCode, yookassaPaymentId) {
  const pending = await getPendingByCode(paymentCode);

  if (!pending) {
    return { ok: false, reason: 'not_found' };
  }

  if (pending.status === 'completed') {
    const balanceAfter = await billing.getBalance(pending.user_id);
    return {
      ok: true,
      reason: 'already_completed',
      pending,
      alreadyGranted: true,
      balanceAfter,
    };
  }

  if (pending.status === 'cancelled') {
    return { ok: false, reason: 'cancelled', pending };
  }

  if (pending.provider !== 'yookassa') {
    return { ok: false, reason: 'wrong_provider', pending };
  }

  const idempotencyKey = `purchase:yookassa:${yookassaPaymentId}`;

  const grantResult = await billing.grant(
    pending.user_id,
    Number(pending.credits_amount),
    'purchase',
    {
      rubAmount: pending.rub_amount,
      paymentCode: pending.payment_code,
      yookassaPaymentId,
      provider: 'yookassa',
    },
    idempotencyKey,
  );

  await pool.query(
    `UPDATE pending_payments
     SET status = 'completed', completed_at = NOW(), external_payment_id = $2
     WHERE id = $1`,
    [pending.id, yookassaPaymentId],
  );

  if (!grantResult.alreadyGranted) {
    trackEvent(pending.user_id, EVENTS.PAYMENT_COMPLETED, {
      rub: pending.rub_amount,
      requests: pending.credits_amount,
      payment_code: pending.payment_code,
    });
  }

  return {
    ok: true,
    pending,
    balanceAfter: grantResult.balanceAfter,
    alreadyGranted: grantResult.alreadyGranted,
  };
}

export async function getPendingYookassaForUser(userId) {
  const { rows } = await pool.query(
    `SELECT *
     FROM pending_payments
     WHERE user_id = $1
       AND status = 'pending'
       AND provider = 'yookassa'
       AND external_payment_id IS NOT NULL
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

export async function markPendingCancelled(pendingId) {
  await pool.query(
    `UPDATE pending_payments SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`,
    [pendingId],
  );
}
