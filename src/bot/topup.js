import { Markup } from 'telegraf';
import { config } from '../shared/config.js';
import * as payments from '../shared/payments.js';
import { formatRateLine, getTopupPackages } from '../shared/pricing.js';
import {
  startTopupPayment,
  syncUserYookassaPayments,
  checkYookassaPayment,
} from '../shared/yookassa/service.js';
import { mainKeyboard, TOPUP_BACK } from './keyboards.js';

export function topupAmountKeyboard() {
  const packages = getTopupPackages();
  const rows = [];

  for (let i = 0; i < packages.length; i += 2) {
    rows.push(packages.slice(i, i + 2).map(({ rub, credits }) => `${rub} ₽ · ${credits} кр.`));
  }

  rows.push([TOPUP_BACK]);
  return Markup.keyboard(rows).resize().oneTime();
}

export function parseTopupButton(text) {
  const match = text.match(/^(\d+)\s*₽/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

export async function sendTopupMenu(ctx) {
  await ctx.reply(
    `Пополнение баланса\n\n${formatRateLine()}\n\nВыберите сумму:`,
    topupAmountKeyboard(),
  );
}

export async function handleTopupAmount(ctx, userId, rub) {
  try {
    await handleTopupAmountInner(ctx, userId, rub);
  } catch (err) {
    console.error('[topup] unhandled:', err?.message ?? err, err?.stack);
    await ctx.reply(
      'Не удалось оформить пополнение. Попробуйте позже.\n\n' +
        `Технически: ${err?.message ?? 'ошибка'}`,
      mainKeyboard(),
    ).catch(() => {});
  }
}

async function handleTopupAmountInner(ctx, userId, rub) {
  const allowed = config.topupPackagesRub;

  if (!allowed.includes(rub)) {
    await ctx.reply('Недоступная сумма. Выберите из предложенных.', topupAmountKeyboard());
    return;
  }

  if (config.paymentProvider === 'yookassa') {
    try {
      const synced = await syncUserYookassaPayments(userId);
      if (synced.length > 0) {
        const last = synced[synced.length - 1];
        await ctx.reply(
          `✅ Оплата прошла!\n\n+${last.pending.credits_amount} кредитов\n` +
            `Баланс: ${last.balanceAfter} кредитов`,
          mainKeyboard(),
        );
        return;
      }
    } catch (err) {
      console.warn('[topup] sync pending payments skipped:', err?.message ?? err);
    }
  }

  await payments.cancelPendingForUser(userId);

  if (config.paymentProvider === 'yookassa') {
    try {
      const { pending, confirmationUrl } = await startTopupPayment(userId, rub);
      await ctx.reply(
        `💳 Оплата ${pending.rub_amount} ₽ → ${pending.credits_amount} кредитов\n\n` +
          '1. Нажмите «Оплатить» и завершите платёж на сайте ЮKassa\n' +
          '2. Вернитесь в бот и нажмите «Проверить оплату»\n\n' +
          '(на сервере с webhook кредиты начислятся автоматически)',
        Markup.inlineKeyboard([
          [Markup.button.url('💳 Оплатить', confirmationUrl)],
          [Markup.button.callback('🔄 Проверить оплату', `checkpay:${pending.payment_code}`)],
        ]),
      );
      await ctx.reply('После оплаты нажмите «Проверить оплату» в сообщении выше ↑', mainKeyboard());
    } catch (err) {
      console.error('[topup] yookassa error:', err?.message ?? err);
      await ctx.reply(
        `Не удалось создать платёж: ${err?.message ?? 'ошибка API'}\n\n` +
          'Проверьте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY в .env',
        mainKeyboard(),
      );
    }
    return;
  }

  if (config.paymentProvider === 'instant') {
    const pending = await payments.createTopupRequest(userId, rub);
    const result = await payments.confirmPayment(pending.payment_code, 0);

    await ctx.reply(
      `✅ Баланс пополнен!\n\n` +
        `+${pending.credits_amount} кредитов (${pending.rub_amount} ₽)\n` +
        `Текущий баланс: ${result.balanceAfter} кредитов`,
      mainKeyboard(),
    );
    return;
  }

  const pending = await payments.createTopupRequest(userId, rub);

  await ctx.reply(payments.buildPaymentInstructions(pending), mainKeyboard());

  if (config.adminTelegramIds.length > 0) {
    const userLabel = ctx.from.username
      ? `@${ctx.from.username}`
      : `${ctx.from.first_name ?? 'User'} (${ctx.from.id})`;

    const adminText =
      `🆕 Заявка на пополнение\n` +
      `${userLabel}\n` +
      `${pending.rub_amount} ₽ → ${pending.credits_amount} кредитов\n` +
      `Код: ${pending.payment_code}\n\n` +
      `/confirm ${pending.payment_code}`;

    for (const adminId of config.adminTelegramIds) {
      await ctx.telegram.sendMessage(adminId, adminText).catch(() => {});
    }
  }
}

export async function handleCheckPaymentCallback(ctx, userId, paymentCode) {
  try {
    const result = await checkYookassaPayment(userId, paymentCode);

    if (result.ok && !result.alreadyGranted) {
      await ctx.answerCbQuery('Оплата получена!');
      await ctx.reply(
        `✅ Баланс пополнен!\n\n` +
          `+${result.pending.credits_amount} кредитов\n` +
          `Текущий баланс: ${result.balanceAfter} кредитов`,
        mainKeyboard(),
      );
      return;
    }

    if (result.ok && result.alreadyGranted) {
      await ctx.answerCbQuery('Кредиты уже начислены');
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
  if (rubRaw === 'cancel') {
    await ctx.answerCbQuery('Отменено');
    await ctx.deleteMessage().catch(() => {});
    return;
  }

  const rub = Number(rubRaw);
  await ctx.answerCbQuery();
  await handleTopupAmount(ctx, userId, rub);
}

export async function syncYookassaBeforeBalance(userId) {
  if (config.paymentProvider !== 'yookassa') {
    return null;
  }
  const synced = await syncUserYookassaPayments(userId);
  return synced.length > 0 ? synced[synced.length - 1] : null;
}
