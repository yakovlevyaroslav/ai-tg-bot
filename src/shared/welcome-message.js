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

const PRIVACY_POLICY_LINK_TEXT = 'Политикой обработки персональных данных';

export const WELCOME_MESSAGE_PARSE_MODE = 'HTML';

function welcomeBonusLine() {
  if (config.welcomeBonusRequests <= 0) {
    return '\n';
  }
  return `\nПри регистрации: ${formatTokens(config.welcomeBonusRequests)}.\n`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function resolvePrivacyPolicyUrl() {
  return (
    config.privacyPolicyUrl ||
    (config.publicSiteUrl ? `${config.publicSiteUrl}/privacy` : '')
  );
}

function buildPrivacyPolicyLinkHtml(url) {
  if (!url) {
    return escapeHtml(PRIVACY_POLICY_LINK_TEXT);
  }

  return `<a href="${escapeHtmlAttr(url)}">${escapeHtml(PRIVACY_POLICY_LINK_TEXT)}</a>`;
}

/** Текст приветствия на /start и кнопку «▶️ Старт». */
export function buildWelcomeText(telegramId = null) {
  const template = config.welcomeMessageTemplate || DEFAULT_TEMPLATE;
  const privacyPolicyLink = buildPrivacyPolicyLinkHtml(resolvePrivacyPolicyUrl());

  return escapeHtml(template)
    .replace(/\{packages\}/g, escapeHtml(formatPackagesLine(telegramId)))
    .replace(/\{welcome_bonus_line\}/g, escapeHtml(welcomeBonusLine()))
    .replace(/\{requests_per_message\}/g, escapeHtml(formatTokens(config.requestsPerMessage)))
    .replace(/\{privacy_policy_url\}/g, privacyPolicyLink);
}
