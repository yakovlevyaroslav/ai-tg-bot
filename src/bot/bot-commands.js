import { isAdminTelegramId } from '../shared/pricing.js';

const USER_COMMANDS = [
  { command: 'start', description: 'Пройти анкету заново' },
  { command: 'balance', description: 'Баланс токенов' },
];

const ADMIN_COMMANDS = [
  { command: 'start', description: 'Пройти анкету заново' },
  { command: 'balance', description: 'Баланс токенов' },
  { command: 'topup', description: 'Купить токены' },
  { command: 'restart', description: 'Сбросить историю диалога' },
  { command: 'help', description: 'Справка по командам' },
  { command: 'skip_onboarding', description: 'Пропустить анкету (админ)' },
];

export function getCommandsForUser(telegramId) {
  return isAdminTelegramId(telegramId) ? ADMIN_COMMANDS : USER_COMMANDS;
}

export async function syncUserBotCommands(telegram, telegramId) {
  if (telegramId == null) {
    return;
  }

  await telegram.setMyCommands(getCommandsForUser(telegramId), {
    scope: { type: 'chat', chat_id: Number(telegramId) },
  });
}

export async function setupDefaultBotCommands(telegram) {
  await telegram.setMyCommands(USER_COMMANDS, {
    scope: { type: 'all_private_chats' },
  });
}
