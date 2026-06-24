import { isAdminTelegramId } from '../shared/pricing.js';

const USER_COMMANDS = [
  { command: 'start', description: 'Главное меню' },
  { command: 'questions', description: 'Задать вопрос' },
  { command: 'balance', description: 'Баланс вопросов' },
  { command: 'restart', description: 'Сбросить и начать заново' },
];

const ADMIN_COMMANDS = [
  { command: 'start', description: 'Главное меню' },
  { command: 'balance', description: 'Баланс вопросов' },
  { command: 'questions', description: 'Задать вопрос' },
  { command: 'topup', description: 'Купить вопросы' },
  { command: 'restart', description: 'Сбросить и начать заново' },
  { command: 'help', description: 'Справка по командам' },
  { command: 'skip_onboarding', description: 'Пропустить анкету (админ)' },
];

const REPLY_KEYBOARD_EXCLUDED_COMMANDS = new Set(['start', 'restart']);
const ADMIN_REPLY_KEYBOARD_EXCLUDED_COMMANDS = new Set(['balance', 'help']);

export function getCommandsForUser(telegramId) {
  return isAdminTelegramId(telegramId) ? ADMIN_COMMANDS : USER_COMMANDS;
}

export function getReplyKeyboardCommandsForUser(telegramId) {
  const excluded = isAdminTelegramId(telegramId)
    ? new Set([...REPLY_KEYBOARD_EXCLUDED_COMMANDS, ...ADMIN_REPLY_KEYBOARD_EXCLUDED_COMMANDS])
    : REPLY_KEYBOARD_EXCLUDED_COMMANDS;

  return getCommandsForUser(telegramId).filter((item) => !excluded.has(item.command));
}

async function resetChatMenuButton(telegram, telegramId = null) {
  const payload = {
    menu_button: { type: 'default' },
  };

  if (telegramId != null) {
    payload.chat_id = Number(telegramId);
  }

  await telegram.callApi('setChatMenuButton', payload).catch((err) => {
    console.warn('[bot] setChatMenuButton failed:', err?.message ?? err);
  });
}

export async function syncUserBotCommands(telegram, telegramId, userId = null) {
  if (telegramId == null) {
    return;
  }

  await telegram.setMyCommands(getCommandsForUser(telegramId), {
    scope: { type: 'chat', chat_id: Number(telegramId) },
  });

  await resetChatMenuButton(telegram, telegramId);
}

export async function setupDefaultBotCommands(telegram) {
  await telegram.setMyCommands(USER_COMMANDS, {
    scope: { type: 'all_private_chats' },
  });

  await resetChatMenuButton(telegram);
}
