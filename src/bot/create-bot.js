import { Telegraf } from 'telegraf';
import { config } from '../shared/config.js';
import * as db from '../shared/db.js';
import { buildOnboardingSystemContext } from '../shared/onboarding-context.js';
import * as billing from '../shared/billing.js';
import { complete } from './ai/index.js';
import { getUserErrorMessage } from '../shared/errors.js';
import { postOnboardingInlineKeyboard, balanceTariffsInlineKeyboard } from './keyboards.js';
import { syncUserBotCommands } from './bot-commands.js';
import { isAdmin } from './admin-commands.js';
import { checkCooldown } from './rate-limit.js';
import { formatPackagesInline } from '../shared/pricing.js';
import { formatTokens, formatQuestions } from '../shared/requests-format.js';
import {
  sendTopupMenu,
  handleTopupCallback,
  handleBuyCallback,
  handlePaymentBack,
  handleCheckPaymentCallback,
  syncYookassaBeforeBalance,
} from './topup.js';
import { createAccessGateMiddleware, isBotAccessGateEnabled } from './access-gate.js';
import { createDismissReplyKeyboardMiddleware } from './dismiss-reply-keyboard.js';
import {
  startOnboarding,
  handleOnboardingText,
  handleOnboardingGender,
  handleOnboardingPlaceChoice,
  handleOnboardingConfirm,
  skipOnboardingForAdmin,
  isOnboardingBlocking,
} from './onboarding.js';
import {
  handlePostOnboardingCallback,
  sendPopularTopicMenu,
  getPopularSubquestion,
  POST_ONBOARDING_TEXT,
} from './post-onboarding.js';
import {
  startPendingQuestion,
  beginQuestionAddon,
  handleQuestionAddonText,
  finalizePendingQuestion,
  handleQuestionConfirmReminder,
} from './question-flow-handlers.js';
import { sendQuestionThinkingPrelude } from './question-flow.js';
import {
  ANSWER_FOLLOWUP_TEXT,
  ALL_COMMANDS_TEXT,
  answerFollowupInlineKeyboard,
  allCommandsInlineKeyboard,
  scheduleAnswerFollowup,
} from './answer-followup.js';

const TELEGRAM_MAX_LENGTH = 4096;

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
    return `\n\n−${formatTokens(charged)} · осталось: ${formatTokens(balance)}`;
  }
  return `\n\nОсталось: ${formatTokens(balance)}`;
}

function shouldOfferTariffs(balance) {
  return balance < config.lowTokensTariffsThreshold;
}

async function registerUser(ctx) {
  const user = await db.upsertUser({
    telegramId: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
  });
  const bonus = await billing.grantWelcomeBonus(user.id);
  await syncUserBotCommands(ctx.telegram, ctx.from.id).catch((err) => {
    console.warn('[bot] setMyCommands failed:', err?.message ?? err);
  });
  return { userId: user.id, bonus };
}

async function sendBalance(ctx, userId = null) {
  const id = userId ?? (await registerUser(ctx)).userId;

  const yookassaSync = await syncYookassaBeforeBalance(id);
  const balance = await billing.getBalance(id);
  const questionsAsked = await db.countUserQuestionsAsked(id);

  let text =
    '💰 Баланс\n\n' +
    `Осталось: ${formatTokens(balance)}\n` +
    `Задано вопросов: ${formatQuestions(questionsAsked)}\n\n` +
    '1 токен = 1 вопрос.';

  if (yookassaSync) {
    text =
      `✅ Зачислено +${formatTokens(yookassaSync.pending.credits_amount)} после оплаты\n\n` + text;
  }

  await ctx.reply(text, balanceTariffsInlineKeyboard());
}

async function sendRestart(ctx) {
  const { userId } = await registerUser(ctx);
  await db.clearHistory(userId);
  await ctx.reply('Диалог перезапущен. История очищена — можете писать заново.');
}

async function buildMessages(userId) {
  const profile = await db.getUserProfile(userId);
  const onboardingContext = buildOnboardingSystemContext(profile?.onboarding_data);
  const systemPrompt = onboardingContext
    ? `${config.systemPrompt}\n\n${onboardingContext}`
    : config.systemPrompt;

  const history = await db.getHistory(userId, config.historyLimit);
  return [
    { role: 'system', content: systemPrompt },
    ...history.map(({ role, content }) => ({ role, content })),
  ];
}

async function handleChatMessage(ctx, userId, text) {
  if (text.length > config.maxMessageLength) {
    await ctx.reply(`Слишком длинное сообщение (макс. ${config.maxMessageLength} символов).`);
    return;
  }

  const cooldown = checkCooldown(ctx.from.id);
  if (!cooldown.ok) {
    await ctx.reply(`Подождите ${cooldown.waitSec} сек. перед следующим сообщением.`);
    return;
  }

  const cost = billing.estimateMessageCost();
  let chargeResult;

  try {
    chargeResult = await billing.charge(userId, cost, { reason: 'message' });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_CREDITS') {
      await ctx.reply(getUserErrorMessage(err), balanceTariffsInlineKeyboard());
      return;
    }
    throw err;
  }

  await ctx.sendChatAction('typing');

  try {
    await db.saveMessage(userId, 'user', text);

    const messages = await buildMessages(userId);
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
      await ctx.reply(isLast ? chunk + footer : chunk);
    }

    scheduleAnswerFollowup(ctx.telegram, ctx.chat.id);
  } catch (err) {
    console.error('Chat error:', err?.message ?? err);
    await billing.refund(userId, cost, chargeResult.transactionId, {
      reason: 'api_error',
    });
    const balance = await billing.getBalance(userId);
    await ctx.reply(
      getUserErrorMessage(err) + formatBalanceLine(balance),
      shouldOfferTariffs(balance) ? balanceTariffsInlineKeyboard() : undefined,
    );
  }
}

async function handleMenuCommand(ctx, userId, command) {
  switch (command) {
    case 'start':
      await startOnboarding(ctx, userId);
      return;
    case 'balance':
      await sendBalance(ctx, userId);
      return;
    case 'topup':
      if (!isAdmin(ctx.from.id)) {
        return;
      }
      await sendTopupMenu(ctx);
      return;
    case 'restart':
      if (!isAdmin(ctx.from.id)) {
        return;
      }
      await sendRestart(ctx);
      return;
    case 'help':
      if (!isAdmin(ctx.from.id)) {
        return;
      }
      await ctx.reply(
        'Команды бота:\n' +
          '/start — пройти анкету заново\n' +
          '/balance — баланс токенов и статистика\n' +
          `/topup — купить токены (${formatPackagesInline(ctx.from.id)})\n` +
          '/restart — сбросить историю диалога\n' +
          '/skip_onboarding — пропустить анкету\n\n' +
          '1 токен = 1 вопрос.',
      );
      return;
    case 'skip_onboarding':
      if (!isAdmin(ctx.from.id)) {
        return;
      }
      await skipOnboardingForAdmin(ctx, userId);
      return;
    default:
      return;
  }
}

export function createBot() {
  const bot = new Telegraf(config.telegramToken);

  bot.use(
    createAccessGateMiddleware({
      onAccessGranted: async (ctx) => {
        const { userId } = await registerUser(ctx);
        await ctx.reply('✅ Доступ открыт!');
        await startOnboarding(ctx, userId);
      },
    }),
  );

  bot.use(createDismissReplyKeyboardMiddleware());

  if (isBotAccessGateEnabled()) {
    console.log('[bot] access gate enabled (password required)');
  }

  bot.start(async (ctx) => {
    const { userId } = await registerUser(ctx);
    await startOnboarding(ctx, userId);
  });

  bot.help(async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return;
    }

    let text =
      'Команды бота:\n' +
      '/start — пройти анкету заново\n' +
      '/balance — баланс токенов и статистика\n' +
      `/topup — купить токены (${formatPackagesInline(ctx.from.id)})\n` +
      '/restart — сбросить историю диалога\n' +
      '/skip_onboarding — пропустить анкету\n\n' +
      '1 токен = 1 вопрос.';

    if (config.aiProvider === 'mock') {
      text += '\n\n⚙️ Режим mock — ответы без OpenAI (разработка).';
    }

    await ctx.reply(text);
  });

  bot.command('balance', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleMenuCommand(ctx, userId, 'balance');
  });

  bot.command('topup', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleMenuCommand(ctx, userId, 'topup');
  });

  bot.command('restart', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleMenuCommand(ctx, userId, 'restart');
  });

  bot.command('clear', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleMenuCommand(ctx, userId, 'restart');
  });

  bot.command('skip_onboarding', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleMenuCommand(ctx, userId, 'skip_onboarding');
  });

  bot.action('post:followup:commands', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(ALL_COMMANDS_TEXT, allCommandsInlineKeyboard(ctx.from.id));
  });

  bot.action('post:followup:back', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(ANSWER_FOLLOWUP_TEXT, answerFollowupInlineKeyboard());
  });

  bot.action(/^menu:cmd:(.+)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await ctx.answerCbQuery();
    await handleMenuCommand(ctx, userId, ctx.match[1]);
  });

  bot.action(/^topup:(.+)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleTopupCallback(ctx, userId, ctx.match[1]);
  });

  bot.action(/^buy:(.+)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleBuyCallback(ctx, userId, ctx.match[1]);
  });

  bot.action('pay:back', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handlePaymentBack(ctx, userId);
  });

  bot.action(/^checkpay:(.+)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleCheckPaymentCallback(ctx, userId, ctx.match[1]);
  });

  bot.action(/^onboard:gender:(male|female)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleOnboardingGender(ctx, userId, ctx.match[1]);
  });

  bot.action(/^onboard:place:(\d+)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleOnboardingPlaceChoice(ctx, userId, ctx.match[1]);
  });

  bot.action(/^onboard:confirm:(yes|no)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleOnboardingConfirm(ctx, userId, ctx.match[1]);
  });

  bot.action(/^post:questions(?::([\w]+))?$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handlePostOnboardingCallback(ctx, 'questions', ctx.match[1] ?? null, userId);
  });

  bot.action(/^post:questions:pick:(\d+)$/, async (ctx) => {
    await registerUser(ctx);
    await ctx.answerCbQuery();
    await sendPopularTopicMenu(ctx, ctx.match[1]);
  });

  bot.action(/^post:questions:ask:(\d+):(\d+)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    const profile = await db.getUserProfile(userId);
    const item = getPopularSubquestion(ctx.match[1], ctx.match[2]);

    if (!item) {
      await ctx.answerCbQuery('Вопрос не найден');
      return;
    }

    if (!profile?.onboarding_completed) {
      await ctx.answerCbQuery('Сначала пройдите анкету');
      return;
    }

    await ctx.answerCbQuery('Принято');
    await startPendingQuestion(ctx, userId, item.prompt);
  });

  bot.action('post:question:add', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await ctx.answerCbQuery();
    await beginQuestionAddon(ctx, userId);
  });

  bot.action('post:question:answer', async (ctx) => {
    const { userId } = await registerUser(ctx);
    const prompt = await finalizePendingQuestion(userId);

    if (!prompt) {
      await ctx.answerCbQuery('Вопрос не найден');
      return;
    }

    await ctx.answerCbQuery('Слушаю код…');
    await sendQuestionThinkingPrelude(ctx);
    await handleChatMessage(ctx, userId, prompt);
  });

  bot.action(/^post:tariffs$/, async (ctx) => {
    await registerUser(ctx);
    await handlePostOnboardingCallback(ctx, 'tariffs');
  });

  bot.action('post:tariffs:back', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(POST_ONBOARDING_TEXT, postOnboardingInlineKeyboard());
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith('/')) {
      return;
    }

    const { userId } = await registerUser(ctx);
    const profile = await db.getUserProfile(userId);

    if (text === '💰 Баланс') {
      await sendBalance(ctx, userId);
      return;
    }

    if (text === '▶️ Старт') {
      await startOnboarding(ctx, userId);
      return;
    }

    if (isOnboardingBlocking(profile)) {
      await handleOnboardingText(ctx, userId, text, profile);
      return;
    }

    if (profile?.onboarding_step === 'question_addon') {
      await handleQuestionAddonText(ctx, userId, text);
      return;
    }

    if (profile?.onboarding_step === 'question_confirm') {
      await handleQuestionConfirmReminder(ctx);
      return;
    }

    if (!profile?.onboarding_completed) {
      await ctx.reply('Сначала пройдите анкету — нажмите /start');
      return;
    }

    if (profile?.onboarding_step === 'custom_question') {
      await startPendingQuestion(ctx, userId, text);
      return;
    }
  });

  return bot;
}
