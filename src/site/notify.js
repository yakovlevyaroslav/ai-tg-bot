import { buildPostActionsKeyboard } from '../bot/menu-url.js';
import { formatBalanceCredit, formatBalanceRemaining } from '../shared/requests-format.js';
import { sendTelegramMessage } from '../shared/telegram-api.js';

/** Уже отправленные уведомления (in-memory, защита от дублей poll/webhook). */
const notifiedPaymentCodes = new Set();

export function buildPaymentSuccessText(result) {
  return (
    `✅ Оплата прошла успешно!\n\n` +
    `${formatBalanceCredit(result.pending.credits_amount)}\n` +
    `${formatBalanceRemaining(result.balanceAfter)}`
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
    const sendResult = await sendTelegramMessage({
      chatId,
      text: buildPaymentSuccessText(result),
      replyMarkup: keyboard?.reply_markup ?? null,
    });

    if (!sendResult.ok) {
      console.warn('[notify] sendMessage failed:', sendResult.description ?? 'unknown error');
      return;
    }

    if (paymentCode) {
      notifiedPaymentCodes.add(paymentCode);
    }
  } catch (err) {
    console.warn('[notify] payment success failed:', err?.message ?? err);
  }
}
