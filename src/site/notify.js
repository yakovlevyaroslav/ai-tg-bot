import { config } from '../shared/config.js';
import { postActionsInlineKeyboard } from '../bot/keyboards.js';
import { isVisitCardPublished } from '../shared/db.js';
import { formatQuestions } from '../shared/requests-format.js';
import { buildVisitCardPublicUrl } from '../shared/visit-card.js';

export function buildPaymentSuccessText(result) {
  const productType = result.productType ?? result.pending?.product_type;

  if (productType === 'visit_card') {
    const code =
      result.visitCard?.personalityCode ?? result.pending?.personality_code ?? '';
    const url = buildVisitCardPublicUrl(code);
    return (
      `✅ Оплата прошла успешно!\n\n` +
      `🪪 Визитка опубликована на сайте.\n\n` +
      `Поделитесь ссылкой:\n${url}`
    );
  }

  return (
    `✅ Оплата прошла успешно!\n\n` +
    `+${formatQuestions(result.pending.credits_amount)}\n` +
    `Осталось: ${formatQuestions(result.balanceAfter)}`
  );
}

export async function notifyPaymentSuccess(result) {
  const chatId = result.pending?.telegram_id;
  const productType = result.productType ?? result.pending?.product_type;

  if (!chatId || result.alreadyGranted) {
    return;
  }

  if (productType !== 'visit_card') {
    const balanceAfter = Number(result.balanceAfter);
    if (!Number.isFinite(balanceAfter)) {
      return;
    }
  }

  const visitCardPublished =
    productType === 'visit_card' ||
    (result.pending?.user_id ? await isVisitCardPublished(result.pending.user_id) : false);

  const response = await fetch(
    `https://api.telegram.org/bot${config.telegramToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildPaymentSuccessText(result),
        reply_markup: postActionsInlineKeyboard({ visitCardPublished }).reply_markup,
      }),
    },
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.warn('[site] notify user failed:', data?.description ?? response.statusText);
  }
}
