import { isAdminTelegramId } from '../shared/pricing.js';
import {
  buildOnboardingPageUrl,
  canOpenAsWebApp,
  WEB_APP_MENU_TEXT,
} from '../shared/visit-card.js';
import { resolveUserMenuUrl } from './menu-url.js';

const USER_COMMANDS = [
  { command: 'start', description: 'Главное меню' },
  { command: 'balance', description: 'Баланс вопросов' },
  { command: 'questions', description: 'Задать вопрос' },
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

export function getCommandsForUser(telegramId) {
  return isAdminTelegramId(telegramId) ? ADMIN_COMMANDS : USER_COMMANDS;
}

async function syncWebAppMenuButton(telegram, telegramId = null, userId = null) {
  const menuUrl =
    userId != null ? await resolveUserMenuUrl(userId) : buildOnboardingPageUrl();

  if (!canOpenAsWebApp(menuUrl)) {
    return;
  }

  const payload = {
    menu_button: {
      type: 'web_app',
      text: WEB_APP_MENU_TEXT,
      web_app: { url: menuUrl },
    },
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

  await syncWebAppMenuButton(telegram, telegramId, userId);
}

export async function setupDefaultBotCommands(telegram) {
  await telegram.setMyCommands(USER_COMMANDS, {
    scope: { type: 'all_private_chats' },
  });

  await syncWebAppMenuButton(telegram);
}
