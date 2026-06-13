import { config } from '../shared/config.js';
import { postActionsInlineKeyboard } from '../bot/keyboards.js';
import { formatQuestions } from '../shared/requests-format.js';

export function buildPaymentSuccessText(result) {
  return (
    `✅ Оплата прошла успешно!\n\n` +
    `+${formatQuestions(result.pending.credits_amount)}\n` +
    `Осталось: ${formatQuestions(result.balanceAfter)}`
  );
}

export async function notifyPaymentSuccess(result) {
  const chatId = result.pending?.telegram_id;
  const balanceAfter = Number(result.balanceAfter);

  if (!chatId || result.alreadyGranted || !Number.isFinite(balanceAfter)) {
    return;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${config.telegramToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildPaymentSuccessText(result),
        reply_markup: postActionsInlineKeyboard().reply_markup,
      }),
    },
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.warn('[site] notify user failed:', data?.description ?? response.statusText);
  }
}
