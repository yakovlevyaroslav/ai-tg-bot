import { config } from '../config.js';
import { formatRequests } from '../requests-format.js';
import * as billing from '../billing.js';
import * as payments from '../payments.js';
import { EVENTS, trackEvent } from '../analytics.js';
import { createPayment, getPayment } from './client.js';

export function isYookassaEnabled() {
  return true;
}

export async function startTopupPayment(userId, rubAmount, requests = null) {
  const pending = await payments.createTopupRequest(userId, rubAmount, requests);

  const payment = await createPayment({
    amountRub: rubAmount,
    description: `Пополнение ${rubAmount} ₽ (${formatRequests(pending.credits_amount)})`,
    metadata: {
      payment_code: pending.payment_code,
      user_id: String(userId),
    },
  });

  await payments.attachExternalPaymentId(pending.id, payment.id);

  trackEvent(userId, EVENTS.PAYMENT_CREATED, {
    rub: rubAmount,
    requests: pending.credits_amount,
    payment_code: pending.payment_code,
  });

  const confirmationUrl = payment.confirmation?.confirmation_url;
  if (!confirmationUrl) {
    throw new Error('YooKassa did not return confirmation_url');
  }

  return {
    pending,
    confirmationUrl,
    yookassaPaymentId: payment.id,
  };
}

/** Проверка статуса в API — запасной путь, если webhook недоступен (localhost). */
export async function syncUserYookassaPayments(userId) {
  const pendingList = await payments.getPendingYookassaForUser(userId);
  const completed = [];

  for (const pending of pendingList) {
    const remote = await getPayment(pending.external_payment_id);

    if (remote.status === 'succeeded') {
      const result = await payments.completeYookassaPayment(
        pending.payment_code,
        remote.id,
      );
      if (result.ok && !result.alreadyGranted) {
        completed.push(result);
      }
    } else if (remote.status === 'canceled') {
      await payments.markPendingCancelled(pending.id);
    }
  }

  return completed;
}

export async function checkYookassaPayment(userId, paymentCode) {
  const pending = await payments.getPendingByCode(paymentCode);

  if (!pending || pending.user_id !== userId) {
    return { ok: false, reason: 'not_found' };
  }

  if (pending.status === 'completed') {
    const balanceAfter = await billing.getBalance(userId);
    return {
      ok: true,
      reason: 'already_completed',
      pending,
      productType: pending.product_type ?? 'topup',
      alreadyGranted: true,
      balanceAfter,
    };
  }

  if (!pending.external_payment_id) {
    return { ok: false, reason: 'no_external_id' };
  }

  const remote = await getPayment(pending.external_payment_id);

  if (remote.status === 'succeeded') {
    return payments.completeYookassaPayment(paymentCode, remote.id);
  }

  if (remote.status === 'canceled') {
    await payments.markPendingCancelled(pending.id);
    return { ok: false, reason: 'cancelled' };
  }

  return { ok: false, reason: 'pending', status: remote.status };
}
