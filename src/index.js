import { createBot } from './bot.js';
import { config } from './config.js';
import { ensureDatabase } from './ensure-database.js';
import { initDb, closeDb } from './db.js';
import { startAdminServer, stopAdminServer } from './admin-panel/server.js';

async function main() {
  await ensureDatabase(config.databaseUrl);
  await initDb();

  const bot = createBot();
  const adminServer = startAdminServer();

  const shutdown = async (signal) => {
    console.log(`\n${signal}, stopping...`);
    bot.stop(signal);
    await stopAdminServer(adminServer);
    await closeDb();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await bot.launch();
    console.log(`Bot is running (AI_PROVIDER=${config.aiProvider})`);
  } catch (err) {
    console.error('Telegram bot failed to start:', err?.message ?? err);
    if (config.adminWebEnabled) {
      console.log(
        `Admin panel is still available at http://localhost:${config.adminWebPort}/admin`,
      );
    }
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
