import { Markup } from 'telegraf';
import * as db from '../shared/db.js';
import * as payments from '../shared/payments.js';
import { config } from '../shared/config.js';
import { buildVisitCardPublicUrl } from '../shared/visit-card.js';
import { startVisitCardPayment, syncUserYookassaPayments } from '../shared/yookassa/service.js';
import { scheduleYookassaPaymentPoll } from '../shared/yookassa/poll.js';
import { notifyPaymentSuccess, buildPaymentSuccessText } from '../site/notify.js';
import { EVENTS, trackEvent } from '../shared/analytics.js';
import { postActionsInlineKeyboard } from './keyboards.js';
import { sendTariffsIntro } from './post-onboarding.js';

function visitCardGetKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🪪 Получить визитку', 'post:visit_card:buy')],
    [Markup.button.callback('◀️ Назад', 'post:visit_card:back')],
  ]);
}

function visitCardPublishedKeyboard(url) {
  return Markup.inlineKeyboard([
    [Markup.button.url('🌐 Открыть визитку', url)],
    [Markup.button.callback('◀️ Назад', 'post:visit_card:back')],
  ]);
}

function visitCardPaymentKeyboard(pending, confirmationUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.url(`🪪 Оплатить (${pending.rub_amount} ₽)`, confirmationUrl)],
    [Markup.button.callback('◀️ Назад', 'post:visit_card:pay:back')],
  ]);
}

function buildVisitCardOfferText() {
  return (
    `🪪 Визитка Кода Личности\n\n` +
    `Красивая страница на сайте с вашим кодом и полным разбором — без имени, даты и места рождения.\n\n` +
    `Удобно посмотреть с компьютера и поделиться с друзьями.\n\n` +
    `Стоимость: ${config.visitCardPriceRub} ₽\n\n` +
    `После оплаты вы получите персональную ссылку на страницу.`
  );
}

function buildVisitCardPublishedText(url) {
  return (
    `🪪 Ваша визитка опубликована:\n\n` +
    `${url}\n\n` +
    `На странице только код и разбор — без личных данных.`
  );
}

function buildVisitCardPaymentInstructions(pending) {
  const support = config.paymentSupportUsername;

  return (
    `🪪 Визитка — ${pending.rub_amount} ₽\n\n` +
    '⚠️ Перед оплатой выключите VPN — иначе платёж может не пройти.\n\n' +
    'После оплаты визитка публикуется автоматически, и вы получите ссылку. ' +
    'Обычно это занимает до 10 минут, но иногда задержка может быть 1–2 часа.\n\n' +
    `Если возникнут сложности — напишите админу: ${support}`
  );
}

export async function sendVisitCardMenu(ctx, userId) {
  const profile = await db.getUserProfile(userId);
  const code = profile?.personality_code || profile?.onboarding_data?.personality_code;

  if (!profile?.onboarding_completed || !code) {
    await ctx.reply('Сначала пройдите анкету и получите код личности.');
    return;
  }

  trackEvent(userId, EVENTS.VISIT_CARD_OPENED);

  if (profile.visit_card_published) {
    const url = buildVisitCardPublicUrl(code);
    await ctx.reply(buildVisitCardPublishedText(url), visitCardPublishedKeyboard(url));
    return;
  }

  await ctx.reply(buildVisitCardOfferText(), visitCardGetKeyboard());
}

export async function handleVisitCardBuy(ctx, userId) {
  const profile = await db.getUserProfile(userId);
  const code = profile?.personality_code || profile?.onboarding_data?.personality_code;

  if (!profile?.onboarding_completed || !code) {
    await ctx.answerCbQuery('Сначала пройдите анкету');
    return;
  }

  if (profile.visit_card_published) {
    await ctx.answerCbQuery('Визитка уже опубликована');
    await sendVisitCardMenu(ctx, userId);
    return;
  }

  await ctx.answerCbQuery();
  trackEvent(userId, EVENTS.VISIT_CARD_BUY_CLICKED, { rub: config.visitCardPriceRub });

  const synced = await syncUserYookassaPayments(userId);
  const visitCardPayment = synced.find(
    (item) => item.productType === 'visit_card' || item.pending?.product_type === 'visit_card',
  );
  if (visitCardPayment) {
    await ctx.reply(
      buildPaymentSuccessText(visitCardPayment),
      postActionsInlineKeyboard({ visitCardPublished: true }),
    );
    return;
  }

  await payments.cancelPendingForUser(userId);

  try {
    const { pending, confirmationUrl } = await startVisitCardPayment(userId);
    scheduleYookassaPaymentPoll({
      userId,
      paymentCode: pending.payment_code,
      onSuccess: notifyPaymentSuccess,
    });

    await ctx.reply(
      buildVisitCardPaymentInstructions(pending),
      visitCardPaymentKeyboard(pending, confirmationUrl),
    );
  } catch (err) {
    console.error('[visit-card] yookassa error:', err?.message ?? err);
    await ctx.reply(
      `Не удалось создать платёж: ${err?.message ?? 'ошибка API'}\n\n` +
        'Проверьте настройки ЮKassa в .env',
    );
  }
}

export async function handleVisitCardBack(ctx, userId) {
  await ctx.answerCbQuery();
  await payments.cancelPendingForUser(userId);
  await ctx.deleteMessage().catch(() => {});
  await sendTariffsIntro(ctx, userId);
}

export async function handleVisitCardPayBack(ctx, userId) {
  await ctx.answerCbQuery();
  await payments.cancelPendingForUser(userId);
  await ctx.deleteMessage().catch(() => {});
  await sendVisitCardMenu(ctx, userId);
}
