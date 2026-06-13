import { config } from './config.js';
import { formatPackagesLine } from './pricing.js';
import { formatTokens } from './requests-format.js';

const DEFAULT_TEMPLATE =
  'Привет! Это система «Код личности».\n\n' +
  'Пройди анкету и получи персональный код.\n' +
  '1 токен = 1 вопрос. История сохраняется между сообщениями.\n\n' +
  'Тарифы:\n{packages}\n' +
  '{welcome_bonus_line}' +
  'Команды: /start · /balance\n' +
  '(у админов также /topup, /restart и другие)';

function welcomeBonusLine() {
  if (config.welcomeBonusRequests <= 0) {
    return '\n';
  }
  return `\nПри регистрации: ${formatTokens(config.welcomeBonusRequests)}.\n`;
}

/** Текст приветствия на /start и кнопку «▶️ Старт». */
export function buildWelcomeText(telegramId = null) {
  const template = config.welcomeMessageTemplate || DEFAULT_TEMPLATE;

  return template
    .replace(/\{packages\}/g, formatPackagesLine(telegramId))
    .replace(/\{welcome_bonus_line\}/g, welcomeBonusLine())
    .replace(/\{requests_per_message\}/g, formatTokens(config.requestsPerMessage));
}
