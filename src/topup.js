import { Markup } from 'telegraf';
import { config } from './config.js';
import * as payments from './payments.js';
import { formatRateLine, getTopupPackages } from './pricing.js';
import { mainKeyboard } from './keyboards.js';

export function topupPackagesKeyboard() {
  const packages = getTopupPackages();
  const buttons = packages.map(({ rub, credits }) => [
    Markup.button.callback(`${rub} ₽ — ${credits} кредитов`, `topup:${rub}`),
  ]);
  buttons.push([Markup.button.callback('❌ Отмена', 'topup:cancel')]);
  return Markup.inlineKeyboard(buttons);
}

export async function sendTopupMenu(ctx) {
  await ctx.reply(
    `Пополнение баланса\n\n${formatRateLine()}\n\nВыберите пакет:`,
    topupPackagesKeyboard(),
  );
}

export async function handleTopupCallback(ctx, userId, rubRaw) {
  if (rubRaw === 'cancel') {
    await ctx.answerCbQuery('Отменено');
    await ctx.deleteMessage().catch(() => {});
    return;
  }

  const rub = Number(rubRaw);
  const allowed = config.topupPackagesRub;

  if (!allowed.includes(rub)) {
    await ctx.answerCbQuery('Недоступный пакет');
    return;
  }

  await payments.cancelPendingForUser(userId);
  const pending = await payments.createTopupRequest(userId, rub);

  await ctx.answerCbQuery();
  await ctx.editMessageText(payments.buildPaymentInstructions(pending));

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
