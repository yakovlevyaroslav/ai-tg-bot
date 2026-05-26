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
      throw new Error(`SYSTEM_PROMPT_FILE not found: ${absolute}`);
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
  const placeholders = new Set([
    'your_telegram_bot_token',
    'your_token',
    'changeme',
  ]);

  if (placeholders.has(token.trim().toLowerCase())) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN is a placeholder. Open @BotFather → your bot → API Token, copy token to .env',
    );
  }

  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token.trim())) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN format is invalid. Expected: 123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    );
  }

  return token.trim();
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
  topupPackagesRub: (process.env.TOPUP_PACKAGES_RUB || '100,300,500,1000')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),
  paymentDetails:
    process.env.PAYMENT_DETAILS ||
    'Переведите сумму на карту (укажите в PAYMENT_DETAILS в .env).',
  paymentSupportUsername: process.env.PAYMENT_SUPPORT_USERNAME || '',
  adminTelegramIds: parseAdminIds(process.env.ADMIN_TELEGRAM_IDS),
  adminWebPort: Number(process.env.ADMIN_WEB_PORT || 3080),
  adminWebUser: process.env.ADMIN_WEB_USER || 'admin',
  adminWebPassword: process.env.ADMIN_WEB_PASSWORD || '',
  adminWebEnabled: Boolean(process.env.ADMIN_WEB_PASSWORD?.trim()),
  messageCooldownMs: Number(process.env.MESSAGE_COOLDOWN_MS || 2000),
  maxMessageLength: Number(process.env.MAX_MESSAGE_LENGTH || 4000),
};

if (config.aiProvider === 'openai' && !config.openaiApiKey) {
  throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai');
}
