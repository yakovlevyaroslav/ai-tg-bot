import { config } from '../shared/config.js';
import { buildPostActionsKeyboard } from '../bot/menu-url.js';
import { formatQuestions } from '../shared/requests-format.js';

/** Уже отправленные уведомления (in-memory, защита от дублей poll/webhook). */
const notifiedPaymentCodes = new Set();

export function buildPaymentSuccessText(result) {
  return (
    `✅ Оплата прошла успешно!\n\n` +
    `+${formatQuestions(result.pending.credits_amount)}\n` +
    `Осталось: ${formatQuestions(result.balanceAfter)}`
  );
}

/**
 * @param {object} result — результат completeYookassaPayment
 * @param {{ force?: boolean }} opts — force: true если webhook уже зачислил, но Telegram ещё не уведомлён
 */
export async function notifyPaymentSuccess(result, { force = false } = {}) {
  const chatId = result.pending?.telegram_id;
  const paymentCode = result.pending?.payment_code;

  if (!chatId) {
    return;
  }

  if (paymentCode && notifiedPaymentCodes.has(paymentCode)) {
    return;
  }

  if (result.alreadyGranted && !force) {
    return;
  }

  const balanceAfter = Number(result.balanceAfter);
  if (!Number.isFinite(balanceAfter)) {
    return;
  }

  const userId = result.pending?.user_id;
  const keyboard = userId ? await buildPostActionsKeyboard(userId) : undefined;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.telegramToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: buildPaymentSuccessText(result),
          reply_markup: keyboard?.reply_markup,
        }),
      },
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.warn('[notify] sendMessage failed:', data?.description ?? response.statusText);
      return;
    }

    if (paymentCode) {
      notifiedPaymentCodes.add(paymentCode);
    }
  } catch (err) {
    console.warn('[notify] payment success failed:', err?.message ?? err);
  }
}
