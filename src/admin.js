import { config } from './config.js';
import * as billing from './billing.js';
import * as db from './db.js';
import * as payments from './payments.js';

export function isAdmin(telegramId) {
  return config.adminTelegramIds.includes(telegramId);
}

export async function handleGrantCommand(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/).slice(1);

  if (parts.length === 0) {
    await ctx.reply(
      'Использование:\n' +
        '/grant <кредиты> — себе\n' +
        '/grant <telegram_id> <кредиты> — другому пользователю',
    );
    return;
  }

  let targetTelegramId;
  let amount;

  if (parts.length === 1) {
    targetTelegramId = ctx.from.id;
    amount = Number(parts[0]);
  } else {
    targetTelegramId = Number(parts[0]);
    amount = Number(parts[1]);
  }

  if (!Number.isFinite(targetTelegramId) || !Number.isFinite(amount) || amount <= 0) {
    await ctx.reply('Укажите корректные telegram_id и положительное число кредитов.');
    return;
  }

  const userId = await db.getUserIdByTelegramId(targetTelegramId);

  if (!userId) {
    await ctx.reply(
      `Пользователь ${targetTelegramId} ещё не писал боту. Пусть нажмёт /start, затем повторите команду.`,
    );
    return;
  }

  const result = await billing.grant(userId, amount, 'grant', {
    byAdmin: ctx.from.id,
  });

  await ctx.reply(
    `Начислено ${amount} кредитов пользователю ${targetTelegramId}.\n` +
      `Баланс: ${result.balanceAfter}`,
  );
}

export async function handleConfirmCommand(ctx) {
  const code = ctx.message.text.trim().split(/\s+/)[1];

  if (!code) {
    await ctx.reply(
      'Использование: /confirm <код>\nПример: /confirm PAY-A1B2C3\n\n' +
        'Подтверждает оплату после перевода по заявке пользователя.',
    );
    return;
  }

  const result = await payments.confirmPayment(code, ctx.from.id);

  if (!result.ok) {
    const messages = {
      not_found: 'Заявка с таким кодом не найдена.',
      already_completed: 'Эта заявка уже была подтверждена ранее.',
      cancelled: 'Заявка отменена. Пользователь может создать новую через «Пополнить».',
    };
    await ctx.reply(messages[result.reason] ?? 'Не удалось подтвердить оплату.');
    return;
  }

  const { pending, balanceAfter } = result;
  const userTag = pending.username ? `@${pending.username}` : pending.telegram_id;

  await ctx.reply(
    `✅ Оплата ${pending.payment_code} подтверждена.\n` +
      `Пользователь ${userTag}: +${pending.credits_amount} кредитов\n` +
      `Баланс: ${balanceAfter}`,
  );

  try {
    await ctx.telegram.sendMessage(
      pending.telegram_id,
      `✅ Зачислено ${pending.credits_amount} кредитов (${pending.rub_amount} ₽).\n` +
        `Баланс: ${balanceAfter}`,
    );
  } catch {
    await ctx.reply('Кредиты начислены, но не удалось уведомить пользователя в Telegram.');
  }
}
