import { Markup } from 'telegraf';
import * as db from '../shared/db.js';
import { canOpenAsWebApp, canOpenMenuAsUrl, WEB_APP_MENU_TEXT } from '../shared/visit-card.js';
import { getCommandsForUser } from './bot-commands.js';
import { resolveUserMenuUrl } from './menu-url.js';

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

function keyboardFingerprint(telegramId, menuUrl = null) {
  const commands = getCommandsForUser(telegramId)
    .map((item) => item.command)
    .join(',');
  const menuPart =
    menuUrl && canOpenAsWebApp(menuUrl)
      ? menuUrl
      : menuUrl && canOpenMenuAsUrl(menuUrl)
        ? `url:${menuUrl}`
        : '';
  return `${telegramId}:${commands}:${menuPart}`;
}

export function getCommandForReplyLabel(text) {
  return LABEL_TO_COMMAND[String(text ?? '').trim()] ?? null;
}

export function buildCommandReplyKeyboard(telegramId, menuUrl = null) {
  const labels = getCommandsForUser(telegramId)
    .map((item) => COMMAND_BUTTON_LABELS[item.command])
    .filter(Boolean);

  const rows = [];
  for (let i = 0; i < labels.length; i += 2) {
    rows.push(labels.slice(i, i + 2));
  }

  if (menuUrl && canOpenAsWebApp(menuUrl)) {
    rows.push([Markup.button.webApp(`🗂️ ${WEB_APP_MENU_TEXT}`, menuUrl)]);
  } else if (menuUrl && canOpenMenuAsUrl(menuUrl)) {
    rows.push([Markup.button.url(`🗂️ ${WEB_APP_MENU_TEXT}`, menuUrl)]);
  }

  return Markup.keyboard(rows).resize().persistent();
}

/** Прикрепить reply-клавиатуру к обычному сообщению (без inline-кнопок) */
export function withCommandReplyKeyboard(telegramId, extra = {}, menuUrl = null) {
  const keyboard = buildCommandReplyKeyboard(telegramId, menuUrl);
  return { ...extra, ...keyboard };
}

export function markCommandReplyKeyboardShown(ctx, menuUrl = null) {
  const chatId = ctx.chat?.id;
  const telegramId = ctx.from?.id;

  if (chatId != null && telegramId != null) {
    keyboardState.set(chatId, keyboardFingerprint(telegramId, menuUrl));
  }
}

export function invalidateCommandReplyKeyboard(chatId) {
  if (chatId != null) {
    keyboardState.delete(chatId);
  }
}

async function resolveReplyKeyboardMenuUrl(userId) {
  if (!userId) {
    return null;
  }

  const profile = await db.getUserProfile(userId);
  if (!profile?.onboarding_completed) {
    return null;
  }

  const menuUrl = await resolveUserMenuUrl(userId);
  return canOpenAsWebApp(menuUrl) || canOpenMenuAsUrl(menuUrl) ? menuUrl : null;
}

/** Показать клавиатуру отдельным сообщением, если ещё не показывали в этой сессии бота */
export async function syncCommandReplyKeyboardIfNeeded(ctx, userId = null) {
  const chatId = ctx.chat?.id;
  const telegramId = ctx.from?.id;

  if (chatId == null || telegramId == null || ctx.chat?.type !== 'private') {
    return;
  }

  const menuUrl = await resolveReplyKeyboardMenuUrl(userId);
  const fingerprint = keyboardFingerprint(telegramId, menuUrl);

  if (keyboardState.get(chatId) === fingerprint) {
    return;
  }

  try {
    await ctx.telegram.sendMessage(chatId, 'Команды — на кнопках ниже 👇', {
      ...buildCommandReplyKeyboard(telegramId, menuUrl),
      disable_notification: true,
    });
    keyboardState.set(chatId, fingerprint);
  } catch (err) {
    console.warn('[bot] reply keyboard failed:', err?.message ?? err);
  }
}
