import { config } from '../shared/config.js';

export async function notifyPaymentSuccess(result) {
  const chatId = result.pending?.telegram_id;
  if (!chatId || result.alreadyGranted) {
    return;
  }

  const text =
    `✅ Оплата прошла успешно!\n\n` +
    `+${result.pending.credits_amount} кредитов\n` +
    `Баланс: ${result.balanceAfter} кредитов`;

  const response = await fetch(
    `https://api.telegram.org/bot${config.telegramToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.warn('[site] notify user failed:', data?.description ?? response.statusText);
  }
}
