import { Markup } from 'telegraf';
import { config } from '../shared/config.js';
import { getCommandsForUser } from './bot-commands.js';

const INLINE_BUTTON_MAX = 58;

const COMMAND_ICONS = {
  start: '▶️',
  balance: '💰',
  topup: '💳',
  restart: '🔄',
  help: '❓',
  skip_onboarding: '⏭',
};

export const ANSWER_FOLLOWUP_TEXT =
  'Хотите узнать что-то ещё?\n\n' +
  'Можете задать свой вопрос, выбрать из популярных — или открыть всё меню 👇';

export const ALL_COMMANDS_TEXT = '🗂️ Все доступные команды:';

function truncateInlineButton(label) {
  if (label.length <= INLINE_BUTTON_MAX) {
    return label;
  }
  return `${label.slice(0, INLINE_BUTTON_MAX - 1)}…`;
}

export function answerFollowupInlineKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✍️ Свой вопрос', 'post:questions:custom'),
      Markup.button.callback('🔥 Популярные вопросы', 'post:questions:popular'),
    ],
    [
      Markup.button.callback('📋 Тарифы', 'post:tariffs'),
      Markup.button.callback('🗂️ Меню', 'post:followup:commands'),
    ],
  ]);
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

export function scheduleAnswerFollowup(telegram, chatId) {
  setTimeout(() => {
    telegram
      .sendMessage(chatId, ANSWER_FOLLOWUP_TEXT, answerFollowupInlineKeyboard())
      .catch((err) => {
        console.warn('[followup] send failed:', err?.message ?? err);
      });
  }, config.postAnswerFollowupDelayMs);
}
