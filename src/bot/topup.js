import { Markup } from 'telegraf';
import * as payments from '../shared/payments.js';
import {
  formatTariffsMessage,
  getTopupPackagesForUser,
  getPackagePresentation,
  resolveTopupPackage,
} from '../shared/pricing.js';
import { formatTokens } from '../shared/requests-format.js';
import {
  startTopupPayment,
  syncUserYookassaPayments,
  checkYookassaPayment,
} from '../shared/yookassa/service.js';
import { scheduleYookassaPaymentPoll } from '../shared/yookassa/poll.js';
import { notifyPaymentSuccess } from '../site/notify.js';
import { config } from '../shared/config.js';

function packageButtonLabel(pkg, publicIndex = 0) {
  const { emoji, title } = getPackagePresentation(pkg, publicIndex);
  return `${emoji} ${pkg.rub} ₽ · ${title}`;
}

function buildPackagesInlineKeyboard(telegramId, backCallback = 'buy:cancel') {
  const packages = getTopupPackagesForUser(telegramId);
  let publicIndex = 0;
  const buttons = packages.map((pkg) => {
    const isAdmin =
      config.adminTopupPackage && pkg.rub === config.adminTopupPackage.rub;
    const label = packageButtonLabel(pkg, isAdmin ? -1 : publicIndex);
    if (!isAdmin) {
      publicIndex += 1;
    }
    return Markup.button.callback(label, `buy:${pkg.rub}`);
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([Markup.button.callback('◀️ Назад', backCallback)]);

  return Markup.inlineKeyboard(rows);
}

export function topupInlineKeyboard(telegramId) {
  return buildPackagesInlineKeyboard(telegramId, 'buy:cancel');
}

export function tariffsInlineKeyboard(telegramId) {
  return buildPackagesInlineKeyboard(telegramId, 'post:tariffs:back');
}

export async function sendTopupMenu(ctx) {
  const telegramId = ctx.from.id;
  await ctx.reply(formatTariffsMessage(telegramId), topupInlineKeyboard(telegramId));
}

function buildPaymentInstructionsMessage(pending) {
  const support = config.paymentSupportUsername;

  return (
    `💳 Оплата — ${pending.rub_amount} ₽ · ${formatTokens(pending.credits_amount)}\n\n` +
    '⚠️ Перед оплатой выключите VPN — иначе платёж может не пройти.\n\n' +
    'После оплаты токены начисляются автоматически. ' +
    'Обычно это занимает до 10 минут, но иногда задержка может быть 1–2 часа.\n\n' +
    `Если возникнут сложности с оплатой — напишите админу: ${support}`
  );
}

function paymentConfirmationKeyboard(pending, confirmationUrl) {
  return Markup.inlineKeyboard([
    [Markup.button.url(`💳 Оплатить (${pending.rub_amount} ₽)`, confirmationUrl)],
    [Markup.button.callback('◀️ Назад', 'pay:back')],
  ]);
}

export async function handleTopupAmount(ctx, userId, rub) {
  const telegramId = ctx.from.id;
  const pkg = resolveTopupPackage(rub, telegramId);

  if (!pkg) {
    await ctx.reply('Недоступный пакет. Выберите из предложенных.', topupInlineKeyboard(telegramId));
    return;
  }

  const synced = await syncUserYookassaPayments(userId);
  if (synced.length > 0) {
    const last = synced[synced.length - 1];
    await ctx.reply(
      `✅ Оплата прошла!\n\n+${formatTokens(last.pending.credits_amount)}\n` +
        `Осталось: ${formatTokens(last.balanceAfter)}`,
    );
    return;
  }

  await payments.cancelPendingForUser(userId);

  try {
    const { pending, confirmationUrl } = await startTopupPayment(userId, pkg.rub, pkg.requests);
    scheduleYookassaPaymentPoll({
      userId,
      paymentCode: pending.payment_code,
      onSuccess: notifyPaymentSuccess,
    });

    await ctx.reply(
      buildPaymentInstructionsMessage(pending),
      paymentConfirmationKeyboard(pending, confirmationUrl),
    );
  } catch (err) {
    console.error('[topup] yookassa error:', err?.message ?? err);
    await ctx.reply(
      `Не удалось создать платёж: ${err?.message ?? 'ошибка API'}\n\n` +
        'Проверьте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY в .env',
    );
  }
}

export async function handlePaymentBack(ctx, userId) {
  await ctx.answerCbQuery();
  await payments.cancelPendingForUser(userId);
  await ctx.deleteMessage().catch(() => {});
  await sendTopupMenu(ctx);
}

export async function handleBuyCallback(ctx, userId, rubRaw) {
  if (rubRaw === 'cancel') {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    return;
  }

  const rub = Number(rubRaw);
  if (!Number.isFinite(rub)) {
    await ctx.answerCbQuery('Неверный пакет');
    return;
  }

  await ctx.answerCbQuery();
  await handleTopupAmount(ctx, userId, rub);
}

export async function handleCheckPaymentCallback(ctx, userId, paymentCode) {
  try {
    const result = await checkYookassaPayment(userId, paymentCode);

    if (result.ok && !result.alreadyGranted) {
      await ctx.answerCbQuery('Оплата получена!');
      await ctx.reply(
        `✅ Баланс пополнен!\n\n` +
          `+${formatTokens(result.pending.credits_amount)}\n` +
          `Осталось: ${formatTokens(result.balanceAfter)}`,
      );
      return;
    }

    if (result.ok && result.alreadyGranted) {
      await ctx.answerCbQuery('Вопросы уже начислены');
      return;
    }

    const messages = {
      not_found: 'Платёж не найден',
      no_external_id: 'Платёж ещё создаётся',
      cancelled: 'Платёж отменён',
      pending: 'Оплата ещё не прошла — завершите её на сайте ЮKassa',
    };

    await ctx.answerCbQuery(messages[result.reason] ?? 'Не удалось проверить', {
      show_alert: result.reason === 'pending',
    });
  } catch (err) {
    console.error('[topup] check payment error:', err?.message ?? err);
    await ctx.answerCbQuery('Ошибка проверки оплаты', { show_alert: true });
  }
}

/** @deprecated inline-кнопки из старых сообщений */
export async function handleTopupCallback(ctx, userId, rubRaw) {
  await handleBuyCallback(ctx, userId, rubRaw);
}

export async function syncYookassaBeforeBalance(userId) {
  const synced = await syncUserYookassaPayments(userId);
  return synced.length > 0 ? synced[synced.length - 1] : null;
}
