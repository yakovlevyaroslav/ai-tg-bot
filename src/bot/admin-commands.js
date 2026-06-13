import { config } from '../shared/config.js';
import * as billing from '../shared/billing.js';
import * as db from '../shared/db.js';
import { formatRequests } from '../shared/requests-format.js';

export function isAdmin(telegramId) {
  return config.adminTelegramIds.includes(Number(telegramId));
}

export async function handleGrantCommand(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/).slice(1);

  if (parts.length === 0) {
    await ctx.reply(
      'Использование:\n' +
        '/grant <вопросы> — себе\n' +
        '/grant <telegram_id> <вопросы> — другому пользователю',
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
    await ctx.reply('Укажите корректные telegram_id и положительное число вопросов.');
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
    `Начислено ${formatRequests(amount)} пользователю ${targetTelegramId}.\n` +
      `Осталось: ${formatRequests(result.balanceAfter)}`,
  );
}
