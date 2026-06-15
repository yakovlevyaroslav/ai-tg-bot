import { Markup } from 'telegraf';
import { getCommandsForUser } from './bot-commands.js';

const COMMAND_BUTTON_LABELS = {
  start: '▶️ Старт',
  balance: '💰 Баланс',
  restart: '🔄 Заново',
  topup: '💳 Тарифы',
  help: '❓ Справка',
  skip_onboarding: '⏭ Пропуск',
};

const LABEL_TO_COMMAND = Object.fromEntries(
  Object.entries(COMMAND_BUTTON_LABELS).map(([command, label]) => [label, command]),
);

const keyboardState = new Map();

function keyboardFingerprint(telegramId) {
  return `${telegramId}:${getCommandsForUser(telegramId)
    .map((item) => item.command)
    .join(',')}`;
}

export function getCommandForReplyLabel(text) {
  return LABEL_TO_COMMAND[String(text ?? '').trim()] ?? null;
}

export function buildCommandReplyKeyboard(telegramId) {
  const labels = getCommandsForUser(telegramId)
    .map((item) => COMMAND_BUTTON_LABELS[item.command])
    .filter(Boolean);

  const rows = [];
  for (let i = 0; i < labels.length; i += 2) {
    rows.push(labels.slice(i, i + 2));
  }

  return Markup.keyboard(rows).resize().persistent();
}

/** Прикрепить reply-клавиатуру к обычному сообщению (без inline-кнопок) */
export function withCommandReplyKeyboard(telegramId, extra = {}) {
  const keyboard = buildCommandReplyKeyboard(telegramId);
  return { ...extra, ...keyboard };
}

export function markCommandReplyKeyboardShown(ctx) {
  const chatId = ctx.chat?.id;
  const telegramId = ctx.from?.id;

  if (chatId != null && telegramId != null) {
    keyboardState.set(chatId, keyboardFingerprint(telegramId));
  }
}

export function invalidateCommandReplyKeyboard(chatId) {
  if (chatId != null) {
    keyboardState.delete(chatId);
  }
}

/** Показать клавиатуру отдельным сообщением, если ещё не показывали в этой сессии бота */
export async function syncCommandReplyKeyboardIfNeeded(ctx) {
  const chatId = ctx.chat?.id;
  const telegramId = ctx.from?.id;

  if (chatId == null || telegramId == null || ctx.chat?.type !== 'private') {
    return;
  }

  const fingerprint = keyboardFingerprint(telegramId);

  if (keyboardState.get(chatId) === fingerprint) {
    return;
  }

  try {
    await ctx.telegram.sendMessage(chatId, 'Команды — на кнопках ниже 👇', {
      ...buildCommandReplyKeyboard(telegramId),
      disable_notification: true,
    });
    keyboardState.set(chatId, fingerprint);
  } catch (err) {
    console.warn('[bot] reply keyboard failed:', err?.message ?? err);
  }
}
