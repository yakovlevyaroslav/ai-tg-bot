import './dns-ipv4-first.js';
import { createBot } from './bot.js';
import { config } from './config.js';
import { ensureDatabase } from './ensure-database.js';
import { initDb, closeDb } from './db.js';
import { startAdminServer, stopAdminServer } from './admin-panel/server.js';

const TELEGRAM_LAUNCH_TIMEOUT_MS = Number(process.env.TELEGRAM_LAUNCH_TIMEOUT_MS || 60000);

function formatTelegramStartError(err) {
  const code = err?.code ?? err?.cause?.code ?? err?.errno;
  const message = err?.message ?? String(err);

  if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') {
    return (
      `Нет связи с Telegram API (${code}: ${message}).\n` +
      'Проверьте: curl -s "https://api.telegram.org/bot<TOKEN>/getMe"'
    );
  }

  return message || 'Unknown Telegram error';
}

function launchWithTimeout(bot, ms) {
  return Promise.race([
    bot.launch(),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Telegram connection timeout (${ms / 1000}s). Проверьте TELEGRAM_BOT_TOKEN и доступ к api.telegram.org`,
          ),
        );
      }, ms);
    }),
  ]);
}

async function main() {
  await ensureDatabase(config.databaseUrl);
  await initDb();

  const bot = createBot();
  const adminServer = startAdminServer();
  let botRunning = false;

  const shutdown = async (signal) => {
    console.log(`\n${signal}, stopping...`);
    if (botRunning) {
      try {
        bot.stop(signal);
      } catch {
        // бот не успел запуститься — игнорируем
      }
    }
    await stopAdminServer(adminServer);
    await closeDb();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    console.log('Connecting to Telegram API...');
    await launchWithTimeout(bot, TELEGRAM_LAUNCH_TIMEOUT_MS);
    botRunning = true;
    console.log(`Bot is running (AI_PROVIDER=${config.aiProvider})`);
  } catch (err) {
    console.error('Telegram bot failed to start:', formatTelegramStartError(err));
    if (config.adminWebEnabled) {
      console.log(
        `Admin panel is still available at http://localhost:${config.adminWebPort}/admin`,
      );
    }
    console.log('Исправьте ошибку и выполните: pm2 restart ai-tg-bot');
  }
}

main().catch((err) => {
  if (err?.response?.error_code === 404 && err?.on?.method === 'getMe') {
    console.error(
      'Failed to start: Telegram bot not found (404 on getMe).\n' +
        'Проверьте TELEGRAM_BOT_TOKEN в .env — возьмите токен у @BotFather (/token или /newbot).\n' +
        'Не используйте значение из .env.example (your_telegram_bot_token).',
    );
  } else {
    console.error('Failed to start:', err?.message ?? err);
  }
  process.exit(1);
});
