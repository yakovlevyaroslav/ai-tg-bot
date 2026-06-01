import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_SYSTEM_PROMPT =
  'Ты полезный ассистент в Telegram. Отвечай кратко и по делу на русском языке.';

function loadSystemPrompt() {
  const filePath = process.env.SYSTEM_PROMPT_FILE?.trim();

  if (filePath) {
    const absolute = resolve(process.cwd(), filePath);
    if (!existsSync(absolute)) {
      console.warn(
        `[config] SYSTEM_PROMPT_FILE not found: ${absolute} — using default prompt (specialists use prompts/specialists/*.txt)`,
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
const paymentProvider = (process.env.PAYMENT_PROVIDER || 'manual').toLowerCase();

if (paymentProvider !== 'manual' && paymentProvider !== 'yookassa' && paymentProvider !== 'instant') {
  throw new Error('PAYMENT_PROVIDER must be manual, yookassa or instant');
}

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

export const config = {
  telegramToken: validateTelegramToken(required('TELEGRAM_BOT_TOKEN')),
  databaseUrl: required('DATABASE_URL'),
  aiProvider,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  historyLimit: Number(process.env.HISTORY_LIMIT || 20),
  systemPrompt: loadSystemPrompt(),
  creditsPerMessage: Number(process.env.CREDITS_PER_MESSAGE || 10),
  /** 100 ₽ = 1000 кредитов → 10 кредитов за 1 ₽ */
  creditsPerRub: Number(process.env.CREDITS_PER_RUB || 10),
  welcomeBonusCredits: Number(process.env.WELCOME_BONUS_CREDITS || 300),
  topupPackagesRub: (process.env.TOPUP_PACKAGES_RUB || '1,100,500,1000')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),
  paymentProvider,
  paymentDetails:
    process.env.PAYMENT_DETAILS ||
    'Переведите сумму на карту (укажите в PAYMENT_DETAILS в .env).',
  paymentSupportUsername: process.env.PAYMENT_SUPPORT_USERNAME || '',
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
  publicBotLink: (() => {
    const user = (process.env.PUBLIC_BOT_USERNAME || '').replace(/^@/, '');
    return user ? `https://t.me/${user}` : 'https://t.me/';
  })(),
  adminWebHost: process.env.ADMIN_WEB_HOST || '127.0.0.1',
  adminTelegramIds: parseAdminIds(process.env.ADMIN_TELEGRAM_IDS),
  adminWebPort: Number(process.env.ADMIN_WEB_PORT || 3080),
  adminWebUser: process.env.ADMIN_WEB_USER || 'admin',
  adminWebPassword: process.env.ADMIN_WEB_PASSWORD || '',
  adminWebEnabled: Boolean(process.env.ADMIN_WEB_PASSWORD?.trim()),
  /** HTTP-сервер нужен для админки и/или webhook ЮKassa */
  webServerEnabled:
    Boolean(process.env.ADMIN_WEB_PASSWORD?.trim()) || paymentProvider === 'yookassa',
  messageCooldownMs: Number(process.env.MESSAGE_COOLDOWN_MS || 2000),
  maxMessageLength: Number(process.env.MAX_MESSAGE_LENGTH || 4000),
};

if (config.aiProvider === 'openai' && !config.openaiApiKey) {
  throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai');
}

if (config.paymentProvider === 'yookassa') {
  if (!config.yookassaShopId.trim()) {
    throw new Error('YOOKASSA_SHOP_ID is required when PAYMENT_PROVIDER=yookassa');
  }
  if (!config.yookassaSecretKey.trim()) {
    throw new Error('YOOKASSA_SECRET_KEY is required when PAYMENT_PROVIDER=yookassa');
  }
  if (config.yookassaSendReceipt && !config.yookassaReceiptEmail.trim()) {
    throw new Error(
      'YOOKASSA_RECEIPT_EMAIL is required — in YooKassa shop receipts (54-FZ) are enabled',
    );
  }
}
