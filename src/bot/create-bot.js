import { Telegraf } from 'telegraf';
import { config } from '../shared/config.js';
import * as db from '../shared/db.js';
import * as billing from '../shared/billing.js';
import { complete } from './ai/index.js';
import { getUserErrorMessage } from '../shared/errors.js';
import { BUTTONS, mainKeyboard, TOPUP_BACK } from './keyboards.js';
import { isAdmin, handleGrantCommand, handleConfirmCommand } from './admin-commands.js';
import { checkCooldown } from './rate-limit.js';
import { formatRateLine } from '../shared/pricing.js';
import {
  sendTopupMenu,
  handleTopupCallback,
  handleTopupAmount,
  parseTopupButton,
  handleCheckPaymentCallback,
  syncYookassaBeforeBalance,
} from './topup.js';
import { getSpecialistPrompt } from './specialists.js';
import {
  applySpecialistChoice,
  ensureSpecialistOrPrompt,
  sendSpecialistMenu,
  specialistStatusLine,
} from './specialist-flow.js';

const TELEGRAM_MAX_LENGTH = 4096;

const WELCOME_TEXT =
  'Привет! Здесь три специалиста: таролог, нумеролог и родолог.\n\n' +
  '🧙 Специалист — выбрать, к кому обратиться\n' +
  'Напиши сообщение — ответ с учётом истории диалога.\n' +
  `Стоимость ответа: ${config.creditsPerMessage} кредитов. ${formatRateLine()}\n` +
  `При регистрации: ${config.welcomeBonusCredits} кредитов.\n\n` +
  '▶️ Старт · 🔄 Рестарт · 💰 Баланс · 💳 Пополнить';

function splitMessage(text) {
  if (text.length <= TELEGRAM_MAX_LENGTH) {
    return [text];
  }

  const chunks = [];
  let rest = text;

  while (rest.length > TELEGRAM_MAX_LENGTH) {
    let cut = rest.lastIndexOf('\n', TELEGRAM_MAX_LENGTH);
    if (cut < TELEGRAM_MAX_LENGTH / 2) {
      cut = TELEGRAM_MAX_LENGTH;
    }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }

  if (rest) {
    chunks.push(rest);
  }

  return chunks;
}

function formatBalanceLine(balance, charged = null) {
  if (charged !== null) {
    return `\n\n−${charged} кредитов · осталось: ${balance}`;
  }
  return `\n\nБаланс: ${balance} кредитов`;
}

async function registerUser(ctx) {
  const user = await db.upsertUser({
    telegramId: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
  });
  const bonus = await billing.grantWelcomeBonus(user.id);
  return { userId: user.id, bonus };
}

async function sendBalance(ctx, userId = null) {
  const id = userId ?? (await registerUser(ctx)).userId;

  const yookassaSync = await syncYookassaBeforeBalance(id);
  const balance = await billing.getBalance(id);
  const cost = billing.estimateMessageCost();

  let text =
    `Баланс: ${balance} кредитов\n` +
    `Стоимость сообщения: ${cost} кредитов\n` +
    `Хватит примерно на ${cost > 0 ? Math.floor(balance / cost) : '∞'} ответов.\n\n` +
    formatRateLine();

  if (yookassaSync) {
    text =
      `✅ Зачислено +${yookassaSync.pending.credits_amount} кредитов после оплаты\n\n` + text;
  }

  await ctx.reply(text, mainKeyboard());
}

async function sendWelcome(ctx, bonus = null, userId = null) {
  let text = WELCOME_TEXT;
  if (bonus?.granted) {
    text += `\n\n🎁 Вам начислено ${bonus.amount} приветственных кредитов!`;
  }
  const profile = userId ? await db.getUserProfile(userId) : null;
  if (profile?.specialist) {
    text += `\n\n${specialistStatusLine(profile.specialist)}`;
  }
  await ctx.reply(text, mainKeyboard());
  if (!profile?.specialist) {
    await sendSpecialistMenu(ctx, { intro: 'Выберите специалиста для начала:' });
  }
}

async function sendRestart(ctx) {
  const { userId } = await registerUser(ctx);
  const profile = await db.getUserProfile(userId);
  await db.clearHistory(userId);
  let text = 'Диалог перезапущен. История очищена — можете писать заново.';
  if (profile?.specialist) {
    text += `\n\n${specialistStatusLine(profile.specialist)}`;
  }
  await ctx.reply(text, mainKeyboard());
}

async function buildMessages(userId, specialistId) {
  const history = await db.getHistory(userId, config.historyLimit);
  return [
    { role: 'system', content: getSpecialistPrompt(specialistId) },
    ...history.map(({ role, content }) => ({ role, content })),
  ];
}

async function handleChatMessage(ctx, userId, text, specialistId) {
  if (text.length > config.maxMessageLength) {
    await ctx.reply(
      `Слишком длинное сообщение (макс. ${config.maxMessageLength} символов).`,
      mainKeyboard(),
    );
    return;
  }

  const cooldown = checkCooldown(ctx.from.id);
  if (!cooldown.ok) {
    await ctx.reply(
      `Подождите ${cooldown.waitSec} сек. перед следующим сообщением.`,
      mainKeyboard(),
    );
    return;
  }

  const cost = billing.estimateMessageCost();
  let chargeResult;

  try {
    chargeResult = await billing.charge(userId, cost, { reason: 'message' });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_CREDITS') {
      await ctx.reply(getUserErrorMessage(err), mainKeyboard());
      return;
    }
    throw err;
  }

  await ctx.sendChatAction('typing');

  try {
    await db.saveMessage(userId, 'user', text);

    const messages = await buildMessages(userId, specialistId);
    const result = await complete(messages);

    await db.saveMessage(userId, 'assistant', result.content);

    await billing.recordUsage(userId, {
      transactionId: chargeResult.transactionId,
      promptTokens: result.usage.prompt_tokens,
      completionTokens: result.usage.completion_tokens,
      creditsCharged: cost,
      model: result.model,
    });

    const footer = formatBalanceLine(chargeResult.balanceAfter, cost);
    const chunks = splitMessage(result.content);

    for (const [index, chunk] of chunks.entries()) {
      const isLast = index === chunks.length - 1;
      await ctx.reply(isLast ? chunk + footer : chunk, mainKeyboard());
    }
  } catch (err) {
    console.error('Chat error:', err?.message ?? err);
    await billing.refund(userId, cost, chargeResult.transactionId, {
      reason: 'api_error',
    });
    const balance = await billing.getBalance(userId);
    await ctx.reply(
      getUserErrorMessage(err) + formatBalanceLine(balance),
      mainKeyboard(),
    );
  }
}

export function createBot() {
  const bot = new Telegraf(config.telegramToken);

  bot.start(async (ctx) => {
    const { userId, bonus } = await registerUser(ctx);
    await sendWelcome(ctx, bonus, userId);
  });

  bot.help(async (ctx) => {
    await ctx.reply(
      `${BUTTONS.SPECIALIST} — таролог, нумеролог или родолог\n` +
        `Ответ стоит ${config.creditsPerMessage} кредитов.\n` +
        `${BUTTONS.BALANCE} — баланс\n` +
        `${BUTTONS.TOPUP} — пополнить (${formatRateLine()})\n` +
        `${BUTTONS.RESTART} — сбросить историю (специалист остаётся)\n` +
        `${BUTTONS.START} — приветствие` +
        (config.aiProvider === 'mock'
          ? '\n\n⚙️ Режим mock — ответы без OpenAI (разработка).'
          : ''),
      mainKeyboard(),
    );
  });

  bot.command('balance', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await sendBalance(ctx, userId);
  });

  bot.command('clear', async (ctx) => {
    await sendRestart(ctx);
  });

  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return;
    }
    if (!config.adminWebEnabled) {
      await ctx.reply(
        'Веб-админка выключена.\nДобавьте ADMIN_WEB_PASSWORD в .env и перезапустите бота.',
      );
      return;
    }
    await ctx.reply(
      `Веб-админка:\nhttp://localhost:${config.adminWebPort}/admin\n\n` +
        `Логин: ${config.adminWebUser}\nПароль: из ADMIN_WEB_PASSWORD`,
    );
  });

  bot.command('grant', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('Команда только для администратора.');
      return;
    }
    await handleGrantCommand(ctx);
  });

  bot.command('confirm', async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply('Команда только для администратора.');
      return;
    }
    await handleConfirmCommand(ctx);
  });

  bot.action(/^topup:(.+)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleTopupCallback(ctx, userId, ctx.match[1]);
  });

  bot.action(/^checkpay:(.+)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleCheckPaymentCallback(ctx, userId, ctx.match[1]);
  });

  bot.action(/^specialist:(.+)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await applySpecialistChoice(ctx, userId, ctx.match[1]);
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith('/')) {
      return;
    }

    if (text === BUTTONS.START) {
      const { userId, bonus } = await registerUser(ctx);
      await sendWelcome(ctx, bonus.granted ? bonus : null, userId);
      return;
    }

    if (text === BUTTONS.SPECIALIST) {
      const { userId } = await registerUser(ctx);
      const profile = await db.getUserProfile(userId);
      const intro = profile?.specialist
        ? `Сменить специалиста? Сейчас: ${specialistStatusLine(profile.specialist)}`
        : 'Выберите специалиста:';
      await sendSpecialistMenu(ctx, { intro });
      return;
    }

    if (text === BUTTONS.RESTART) {
      await sendRestart(ctx);
      return;
    }

    if (text === BUTTONS.BALANCE) {
      const { userId } = await registerUser(ctx);
      await sendBalance(ctx, userId);
      return;
    }

    if (text === BUTTONS.TOPUP) {
      await registerUser(ctx);
      await sendTopupMenu(ctx);
      return;
    }

    if (text === TOPUP_BACK) {
      await ctx.reply('Главное меню', mainKeyboard());
      return;
    }

    const topupRub = parseTopupButton(text);
    if (topupRub !== null) {
      const { userId } = await registerUser(ctx);
      await handleTopupAmount(ctx, userId, topupRub);
      return;
    }

    const { userId } = await registerUser(ctx);
    const specialistId = await ensureSpecialistOrPrompt(ctx, userId);
    if (!specialistId) {
      return;
    }
    await handleChatMessage(ctx, userId, text, specialistId);
  });

  return bot;
}
