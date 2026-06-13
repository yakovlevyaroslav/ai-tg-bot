import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_SYSTEM_PROMPT =
  'Ты полезный ассистент в Telegram. Отвечай кратко и по делу на русском языке.';

function loadWelcomeMessageTemplate() {
  const filePath = process.env.WELCOME_MESSAGE_FILE?.trim();

  if (filePath) {
    const absolute = resolve(process.cwd(), filePath);
    if (!existsSync(absolute)) {
      console.warn(
        `[config] WELCOME_MESSAGE_FILE not found: ${absolute} — using default welcome message`,
      );
      return null;
    }
    return readFileSync(absolute, 'utf8').trim();
  }

  const inline = process.env.WELCOME_MESSAGE?.trim();
  if (inline) {
    return inline.replace(/\\n/g, '\n');
  }

  return null;
}

function loadSystemPrompt() {
  const filePath = process.env.SYSTEM_PROMPT_FILE?.trim();

  if (filePath) {
    const absolute = resolve(process.cwd(), filePath);
    if (!existsSync(absolute)) {
      console.warn(
        `[config] SYSTEM_PROMPT_FILE not found: ${absolute} — using default prompt`,
      );
      return DEFAULT_SYSTEM_PROMPT;
    }
    return readFileSync(absolute, 'utf8').trim();
  }

  const inline = process.env.SYSTEM_PROMPT?.trim();
  if (inline) {
    // В .env: буквальные \n превращаются в переносы строк
    return inline.replace(/\\n/g, '\n');
  }

  return DEFAULT_SYSTEM_PROMPT;
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function parseAdminIds(value) {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isFinite(id));
}

const aiProvider = (process.env.AI_PROVIDER || 'mock').toLowerCase();

function validateTelegramToken(token) {
  const cleaned = token.trim().replace(/^['"]|['"]$/g, '');
  const placeholders = new Set([
    'your_telegram_bot_token',
    'your_token',
    'changeme',
  ]);

  if (placeholders.has(cleaned.toLowerCase())) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN is a placeholder. Open @BotFather → your bot → API Token, copy token to .env',
    );
  }

  // Формат BotFather: 1234567890:AAH... (без пробелов и переносов)
  if (!/^\d{8,12}:[A-Za-z0-9_-]{30,}$/.test(cleaned)) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN format is invalid. Copy the full token from @BotFather (one line, no quotes). Example: 1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    );
  }

  return cleaned;
}

function parseTopupPackages(raw) {
  const source = raw?.trim() || '200:5,300:10,500:20';

  const packages = source
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [rubRaw, requestsRaw] = part.split(':').map((v) => v.trim());
      const rub = Number(rubRaw);
      const requests = Number(requestsRaw);
      if (!Number.isFinite(rub) || !Number.isFinite(requests) || rub <= 0 || requests <= 0) {
        return null;
      }
      return { rub, requests };
    })
    .filter(Boolean)
    .sort((a, b) => a.rub - b.rub);

  if (packages.length === 0) {
    throw new Error(
      'TOPUP_PACKAGES must contain at least one package (format: 200:5,300:10,500:20)',
    );
  }

  return packages;
}

function parseAdminTopupPackage(raw) {
  if (!raw?.trim() || raw.trim().toLowerCase() === 'off') {
    return null;
  }

  const [rubRaw, requestsRaw] = raw.trim().split(':').map((v) => v.trim());
  const rub = Number(rubRaw);
  const requests = Number(requestsRaw);

  if (!Number.isFinite(rub) || !Number.isFinite(requests) || rub <= 0 || requests <= 0) {
    throw new Error('ADMIN_TOPUP_PACKAGE must be rub:requests (example: 1:10)');
  }

  return { rub, requests, adminOnly: true };
}

export const config = {
  telegramToken: validateTelegramToken(required('TELEGRAM_BOT_TOKEN')),
  databaseUrl: required('DATABASE_URL'),
  aiProvider,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  historyLimit: Number(process.env.HISTORY_LIMIT || 20),
  systemPrompt: loadSystemPrompt(),
  /** Списание за один ответ бота (обычно 1) */
  requestsPerMessage: Number(process.env.REQUESTS_PER_MESSAGE || 1),
  /** Бесплатные вопросы при первом /start (0 — без бонуса) */
  welcomeBonusRequests: Number(process.env.WELCOME_BONUS_REQUESTS || 0),
  /** Шаблон приветствия на /start; null — текст по умолчанию. Плейсхолдеры: {packages}, {welcome_bonus_line}, {requests_per_message} */
  welcomeMessageTemplate: loadWelcomeMessageTemplate(),
  /** Тарифы: рубли:кол-во вопросов (публичные) */
  topupPackages: parseTopupPackages(process.env.TOPUP_PACKAGES),
  /** Тестовый тариф только для ADMIN_TELEGRAM_IDS */
  adminTopupPackage: parseAdminTopupPackage(process.env.ADMIN_TOPUP_PACKAGE ?? '1:10'),
  paymentSupportUsername: process.env.PAYMENT_SUPPORT_USERNAME || '@yakovlev_dev',
  yookassaShopId: process.env.YOOKASSA_SHOP_ID || '',
  yookassaSecretKey: process.env.YOOKASSA_SECRET_KEY || '',
  yookassaReturnUrl: process.env.YOOKASSA_RETURN_URL || 'https://t.me/',
  yookassaWebhookPath: process.env.YOOKASSA_WEBHOOK_PATH || '/payments/yookassa/webhook',
  yookassaReceiptEmail: process.env.YOOKASSA_RECEIPT_EMAIL || '',
  yookassaVatCode: Number(process.env.YOOKASSA_VAT_CODE || 1),
  /** В кабинете ЮKassa включены «Чеки от ЮKassa» → receipt обязателен */
  yookassaSendReceipt: process.env.YOOKASSA_SEND_RECEIPT !== 'false',
  yookassaSkipIpCheck: process.env.YOOKASSA_SKIP_IP_CHECK === 'true',
  /** Фоновая проверка статуса платежа, если webhook не дошёл */
  yookassaPollIntervalMs: Number(process.env.YOOKASSA_POLL_INTERVAL_MS || 15000),
  yookassaPollMaxAttempts: Number(process.env.YOOKASSA_POLL_MAX_ATTEMPTS || 20),
  /** HTTP(S)-прокси для запросов к api.yookassa.ru (нужен, если основной сервер не в РФ).
   *  Формат: http://user:pass@host:port или http://host:port. Пусто — без прокси. */
  yookassaProxy: process.env.YOOKASSA_PROXY?.trim() || '',
  publicSiteName: process.env.PUBLIC_SITE_NAME || 'AI Bot',
  publicSiteTagline:
    process.env.PUBLIC_SITE_TAGLINE ||
    'Таролог, нумеролог и родолог в Telegram. Пополнение баланса и ответы на ваши вопросы.',
  publicBotUsername: (process.env.PUBLIC_BOT_USERNAME || '').replace(/^@/, ''),
  publicSiteUrl: (process.env.PUBLIC_SITE_URL || '').replace(/\/$/, ''),
  privacyPolicyUrl: (process.env.PRIVACY_POLICY_URL || '').trim(),
  publicBotLink: (() => {
    const user = (process.env.PUBLIC_BOT_USERNAME || '').replace(/^@/, '');
    return user ? `https://t.me/${user}` : 'https://t.me/';
  })(),
  adminWebHost: process.env.ADMIN_WEB_HOST || '127.0.0.1',
  adminTelegramIds: parseAdminIds(process.env.ADMIN_TELEGRAM_IDS),
  /** Если задан — бот доступен только после ввода пароля (админы проходят без пароля) */
  botAccessPassword: process.env.BOT_ACCESS_PASSWORD?.trim() || '',
  adminWebPort: Number(process.env.ADMIN_WEB_PORT || 3080),
  adminWebUser: process.env.ADMIN_WEB_USER || 'admin',
  adminWebPassword: process.env.ADMIN_WEB_PASSWORD || '',
  adminWebEnabled: Boolean(process.env.ADMIN_WEB_PASSWORD?.trim()),
  /** HTTP-сервер: лендинг, webhook ЮKassa, админка */
  webServerEnabled: true,
  messageCooldownMs: Number(process.env.MESSAGE_COOLDOWN_MS || 2000),
  maxMessageLength: Number(process.env.MAX_MESSAGE_LENGTH || 4000),
  /** Пауза между шагами анкеты (мс) */
  onboardingDelayMs: Number(process.env.ONBOARDING_DELAY_MS || 5000),
  /** Пауза при расчёте кода личности — бот «думает» (мс) */
  onboardingCalculationDelayMs: Number(process.env.ONBOARDING_CALCULATION_DELAY_MS || 15000),
  /** Пауза после мистического пролога перед ответом на вопрос (мс) */
  questionThinkingDelayMs: Number(process.env.QUESTION_THINKING_DELAY_MS || 4000),
  /** Пауза перед предложением задать следующий вопрос (мс) */
  postAnswerFollowupDelayMs: Number(process.env.POST_ANSWER_FOLLOWUP_DELAY_MS || 5000),
  /** Порог: при остатке ниже — кнопка «Тарифы» под ответами после списания */
  lowTokensTariffsThreshold: Number(process.env.LOW_TOKENS_TARIFFS_THRESHOLD || 3),
};

if (config.aiProvider === 'openai' && !config.openaiApiKey) {
  throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai');
}

if (!config.yookassaShopId.trim()) {
  throw new Error('YOOKASSA_SHOP_ID is required');
}
if (!config.yookassaSecretKey.trim()) {
  throw new Error('YOOKASSA_SECRET_KEY is required');
}
if (config.yookassaSendReceipt && !config.yookassaReceiptEmail.trim()) {
  throw new Error(
    'YOOKASSA_RECEIPT_EMAIL is required — in YooKassa shop receipts (54-FZ) are enabled',
  );
}
