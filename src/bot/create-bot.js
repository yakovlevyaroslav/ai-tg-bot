import { Telegraf } from 'telegraf';
import { config } from '../shared/config.js';
import * as db from '../shared/db.js';
import {
  buildAnswerIntroPrefix,
  buildOnboardingSystemContext,
} from '../shared/onboarding-context.js';
import { loadQuestionsSystemPrompt } from '../shared/answer-style.js';
import { replyFormatted, splitFormattedMessage } from '../shared/telegram-format.js';
import * as billing from '../shared/billing.js';
import { complete } from './ai/index.js';
import { getUserErrorMessage } from '../shared/errors.js';
import { postOnboardingInlineKeyboard, balanceTariffsInlineKeyboard } from './keyboards.js';
import { syncUserBotCommands } from './bot-commands.js';
import { isAdmin } from './admin-commands.js';
import { checkCooldown } from './rate-limit.js';
import { formatPackagesInline } from '../shared/pricing.js';
import { formatQuestions, formatBalanceChangeFooter, formatBalanceCredit, formatBalanceRemaining } from '../shared/requests-format.js';
import {
  sendTopupMenu,
  handleTopupCallback,
  handleBuyCallback,
  handlePaymentBack,
  handleCheckPaymentCallback,
  syncYookassaBeforeBalance,
} from './topup.js';
import {
  getCommandForReplyLabel,
  syncCommandReplyKeyboardIfNeeded,
} from './command-reply-keyboard.js';
import { EVENTS, trackEvent } from '../shared/analytics.js';
import {
  startOnboarding,
  handleStartCommand,
  handleOnboardingText,
  handleOnboardingGender,
  handleOnboardingConfirm,
  skipOnboardingForAdmin,
  isOnboardingBlocking,
} from './onboarding.js';
import {
  handlePostOnboardingCallback,
  sendPopularTopicMenu,
  getPopularSubquestion,
  sendPostOnboardingMenu,
  POST_ONBOARDING_TEXT,
  sendTariffsIntro,
} from './post-onboarding.js';
import { handleMenuOpen, resolveUserMenuUrl } from './menu-url.js';
import {
  startPendingQuestion,
  beginQuestionAddon,
  beginQuestionChange,
  handleQuestionAddonText,
  finalizePendingQuestion,
  handleQuestionConfirmReminder,
} from './question-flow-handlers.js';
import { cancelIdleNudge, getIdleNudgeTopicById } from './idle-nudge.js';
import { getBroadcastButtonQuestion } from '../shared/broadcast/button-questions.js';
import { sendQuestionThinkingPrelude } from './question-flow.js';
import {
  ANSWER_FOLLOWUP_TEXT,
  ALL_COMMANDS_TEXT,
  answerFollowupInlineKeyboard,
  answerTopicChoiceInlineKeyboard,
  allCommandsInlineKeyboard,
  beginContinueTopic,
  beginNewTopic,
} from './answer-followup.js';

function splitMessage(text) {
  return splitFormattedMessage(text);
}

function formatBalanceLine(balance, charged = null) {
  return formatBalanceChangeFooter(balance, charged);
}

function shouldOfferTariffs(balance) {
  return balance < config.lowTokensTariffsThreshold;
}

async function refuseQuestionForInsufficientBalance(ctx, userId, balance, required) {
  trackEvent(userId, EVENTS.QUESTION_INSUFFICIENT_BALANCE, {
    balance,
    required,
  });

  const text =
    balance <= 0
      ? 'На балансе не осталось вопросов — без пополнения ответ получить не получится.'
      : `Недостаточно вопросов: осталось ${formatQuestions(balance)}, нужно ${formatQuestions(required)}.`;

  await ctx.reply(text);
  await sendTariffsIntro(ctx, userId, { source: 'insufficient_balance' });
}

async function guardQuestionCredits(ctx, userId) {
  const cost = billing.estimateMessageCost();
  const balance = await billing.getBalance(userId);

  if (balance < cost) {
    await refuseQuestionForInsufficientBalance(ctx, userId, balance, cost);
    return false;
  }

  return true;
}

async function registerUser(ctx, { syncKeyboard = true } = {}) {
  const user = await db.upsertUser({
    telegramId: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
  });
  cancelIdleNudge(user.id);
  const bonus = await billing.grantWelcomeBonus(user.id);
  await syncUserBotCommands(ctx.telegram, ctx.from.id, user.id).catch((err) => {
    console.warn('[bot] setMyCommands failed:', err?.message ?? err);
  });

  if (syncKeyboard) {
    await syncCommandReplyKeyboardIfNeeded(ctx, user.id);
  }

  return { userId: user.id, bonus };
}

async function sendBalance(ctx, userId = null) {
  const id = userId ?? (await registerUser(ctx)).userId;

  const yookassaSync = await syncYookassaBeforeBalance(id);
  const balance = await billing.getBalance(id);
  const questionsAsked = await db.countUserQuestionsAsked(id);

  let text =
    '💰 Баланс\n\n' +
    `Осталось: ${formatQuestions(balance)}\n` +
    `Задано вопросов: ${formatQuestions(questionsAsked)}`;

  if (yookassaSync) {
    text =
      `✅ Зачислено после оплаты\n\n` +
      `${formatBalanceCredit(yookassaSync.pending.credits_amount)}\n` +
      `${formatBalanceRemaining(balance)}\n\n` +
      text;
  }

  await ctx.reply(text, balanceTariffsInlineKeyboard());
}

async function sendRestart(ctx, userId) {
  trackEvent(userId, EVENTS.BOT_RESTART);
  await db.clearHistory(userId);
  await startOnboarding(ctx, userId);
}

async function buildMessages(userId) {
  const profile = await db.getUserProfile(userId);
  const onboardingData = profile?.onboarding_data;
  const onboardingContext = buildOnboardingSystemContext(onboardingData);
  const questionsPrompt =
    profile?.onboarding_completed && onboardingData?.personality_code
      ? loadQuestionsSystemPrompt()
      : '';
  const basePrompt = questionsPrompt || config.systemPrompt;
  const systemPrompt = onboardingContext
    ? `${basePrompt}\n\n${onboardingContext}`
    : basePrompt;

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
      await refuseQuestionForInsufficientBalance(ctx, userId, err.balance, err.required);
      return;
    }
    throw err;
  }

  trackEvent(userId, EVENTS.QUESTION_ASKED);

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

    const profile = await db.getUserProfile(userId);
    const introPrefix = buildAnswerIntroPrefix(profile?.onboarding_data);
    const footer = formatBalanceLine(chargeResult.balanceAfter, cost);
    const chunks = splitMessage(introPrefix + result.content);

    for (const [index, chunk] of chunks.entries()) {
      const isLast = index === chunks.length - 1;
      const replyText = isLast ? chunk + footer : chunk;
      const keyboard = isLast ? answerTopicChoiceInlineKeyboard() : undefined;
      await replyFormatted(ctx, replyText, keyboard);
    }

    trackEvent(userId, EVENTS.QUESTION_ANSWERED, { model: result.model });
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
      await handleStartCommand(ctx, userId);
      return;
    case 'balance':
      await sendBalance(ctx, userId);
      return;
    case 'questions':
      await sendPostOnboardingMenu(ctx, userId);
      return;
    case 'topup':
      if (!isAdmin(ctx.from.id)) {
        return;
      }
      await sendTopupMenu(ctx, userId);
      return;
    case 'restart':
      await sendRestart(ctx, userId);
      return;
    case 'help':
      if (!isAdmin(ctx.from.id)) {
        return;
      }
      await ctx.reply(
        'Команды бота:\n' +
          '/start — главное меню\n' +
          '/balance — баланс вопросов и статистика\n' +
          `/topup — купить вопросы (${formatPackagesInline(ctx.from.id)})\n` +
          '/restart — пройти анкету заново\n' +
          '/skip_onboarding — пропустить анкету\n\n' +
          '1 вопрос = 1 развёрнутый ответ.',
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

  bot.catch((err, ctx) => {
    console.error('[bot] unhandled error:', err?.message ?? err);
    if (err?.stack) {
      console.error(err.stack);
    }
    if (ctx?.updateType) {
      console.error('[bot] update type:', ctx.updateType);
    }
  });

  bot.start(async (ctx) => {
    const { userId } = await registerUser(ctx, { syncKeyboard: false });
    await handleStartCommand(ctx, userId, { startPayload: ctx.startPayload });
  });

  bot.help(async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return;
    }

    let text =
      'Команды бота:\n' +
      '/start — главное меню\n' +
      '/balance — баланс вопросов и статистика\n' +
      `/topup — купить вопросы (${formatPackagesInline(ctx.from.id)})\n` +
      '/restart — пройти анкету заново\n' +
      '/skip_onboarding — пропустить анкету\n\n' +
      '1 вопрос = 1 развёрнутый ответ.';

    if (config.aiProvider === 'mock') {
      text += '\n\n⚙️ Режим mock — ответы без OpenAI (разработка).';
    }

    await ctx.reply(text);
  });

  bot.command('balance', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleMenuCommand(ctx, userId, 'balance');
  });

  bot.command('questions', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleMenuCommand(ctx, userId, 'questions');
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

  bot.action('post:followup:continue', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await ctx.answerCbQuery();
    await beginContinueTopic(ctx, userId);
  });

  bot.action('post:followup:new', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await ctx.answerCbQuery();
    await beginNewTopic(ctx, userId);
  });

  bot.action('post:followup:back', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await ctx.answerCbQuery();
    await ctx.reply(ANSWER_FOLLOWUP_TEXT, await answerFollowupInlineKeyboard(userId));
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

  bot.action(/^onboard:confirm:(yes|no)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleOnboardingConfirm(ctx, userId, ctx.match[1]);
  });

  bot.action(/^post:idle:(\d+)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    const topic = getIdleNudgeTopicById(ctx.match[1]);

    if (!topic) {
      await ctx.answerCbQuery('Тема не найдена');
      return;
    }

    const profile = await db.getUserProfile(userId);
    if (!profile?.onboarding_completed) {
      await ctx.answerCbQuery('Сначала пройдите анкету');
      return;
    }

    trackEvent(userId, EVENTS.IDLE_NUDGE_TOPIC, { topic_id: topic.id });
    await ctx.answerCbQuery('Слушаю код…');
    if (!(await guardQuestionCredits(ctx, userId))) {
      return;
    }
    await sendQuestionThinkingPrelude(ctx);
    await handleChatMessage(ctx, userId, topic.prompt);
  });

  bot.action(/^bcq:(\d+)$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    const questionText = await getBroadcastButtonQuestion(ctx.match[1]);

    if (!questionText) {
      await ctx.answerCbQuery('Вопрос не найден');
      return;
    }

    const profile = await db.getUserProfile(userId);
    if (!profile?.onboarding_completed) {
      await ctx.answerCbQuery('Сначала пройдите анкету');
      return;
    }

    await ctx.answerCbQuery('Слушаю код…');
    if (!(await guardQuestionCredits(ctx, userId))) {
      return;
    }
    await sendQuestionThinkingPrelude(ctx);
    await handleChatMessage(ctx, userId, questionText);
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

  bot.action('post:question:change', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await ctx.answerCbQuery();
    await beginQuestionChange(ctx, userId);
  });

  bot.action('post:question:answer', async (ctx) => {
    const { userId } = await registerUser(ctx);
    const prompt = await finalizePendingQuestion(userId);

    if (!prompt) {
      await ctx.answerCbQuery('Вопрос не найден');
      return;
    }

    await ctx.answerCbQuery('Слушаю код…');
    if (!(await guardQuestionCredits(ctx, userId))) {
      return;
    }
    await sendQuestionThinkingPrelude(ctx);
    await handleChatMessage(ctx, userId, prompt);
  });

  bot.action(/^post:tariffs$/, async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handlePostOnboardingCallback(ctx, 'tariffs', null, userId);
  });

  bot.action('post:menu:open', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await handleMenuOpen(ctx, userId);
  });

  bot.action('post:tariffs:back', async (ctx) => {
    const { userId } = await registerUser(ctx);
    await ctx.answerCbQuery();
    const menuUrl = await resolveUserMenuUrl(userId);
    await ctx.reply(POST_ONBOARDING_TEXT, postOnboardingInlineKeyboard(menuUrl));
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith('/')) {
      return;
    }

    const { userId } = await registerUser(ctx);
    const profile = await db.getUserProfile(userId);

    const menuCommand = getCommandForReplyLabel(text);
    if (menuCommand) {
      await handleMenuCommand(ctx, userId, menuCommand);
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

    if (profile?.onboarding_step === 'topic_continue') {
      await handleChatMessage(ctx, userId, text);
      return;
    }

    if (!profile?.onboarding_completed) {
      await ctx.reply('Сначала пройдите анкету — нажмите /start или /restart для начала заново');
      return;
    }

    await startPendingQuestion(ctx, userId, text);
  });

  return bot;
}
