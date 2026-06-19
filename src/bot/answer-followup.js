import { Markup } from 'telegraf';
import * as db from '../shared/db.js';
import { EVENTS, trackEvent } from '../shared/analytics.js';
import { getCommandsForUser } from './bot-commands.js';
import { buildPostActionsKeyboard } from './menu-url.js';

export const ANSWER_FOLLOWUP_TEXT =
  'Хотите узнать что-то ещё?\n\n' +
  'Можете задать свой вопрос, выбрать из популярных — или открыть «Мой код личности» 👇';

export const CONTINUE_TOPIC_TEXT =
  'Напишите уточнение или продолжение вопроса по этой теме — учту предыдущий ответ.';

export const ALL_COMMANDS_TEXT = '🗂️ Все доступные команды:';

const INLINE_BUTTON_MAX = 58;

const COMMAND_ICONS = {
  start: '▶️',
  balance: '💰',
  topup: '💳',
  restart: '🔄',
  help: '❓',
  skip_onboarding: '⏭',
};

function truncateInlineButton(label) {
  if (label.length <= INLINE_BUTTON_MAX) {
    return label;
  }
  return `${label.slice(0, INLINE_BUTTON_MAX - 1)}…`;
}

export function answerTopicChoiceInlineKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔁 Продолжить эту тему', 'post:followup:continue'),
      Markup.button.callback('✨ Начать новую', 'post:followup:new'),
    ],
  ]);
}

export async function answerFollowupInlineKeyboard(userId) {
  return buildPostActionsKeyboard(userId);
}

export function allCommandsInlineKeyboard(telegramId) {
  const commands = getCommandsForUser(telegramId);
  const rows = commands.map((cmd) => {
    const icon = COMMAND_ICONS[cmd.command] ?? '•';
    const label = truncateInlineButton(`${icon} /${cmd.command} — ${cmd.description}`);
    return [Markup.button.callback(label, `menu:cmd:${cmd.command}`)];
  });
  rows.push([Markup.button.callback('◀️ Назад', 'post:followup:back')]);
  return Markup.inlineKeyboard(rows);
}

export async function beginContinueTopic(ctx, userId) {
  trackEvent(userId, EVENTS.FOLLOWUP_CONTINUE);
  await db.setOnboardingStep(userId, 'topic_continue');
  await ctx.reply(CONTINUE_TOPIC_TEXT);
}

export async function beginNewTopic(ctx, userId) {
  trackEvent(userId, EVENTS.FOLLOWUP_NEW);
  await db.setOnboardingStep(userId, 'completed');
  await ctx.reply(ANSWER_FOLLOWUP_TEXT, await answerFollowupInlineKeyboard(userId));
}
