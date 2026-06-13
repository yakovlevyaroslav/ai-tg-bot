import '../shared/dns-ipv4-first.js';
import { fileURLToPath } from 'node:url';
import { config } from '../shared/config.js';
import { ensureDatabase } from '../shared/ensure-database.js';
import { initDb, closeDb } from '../shared/db.js';
import { createBot } from './create-bot.js';
import { formatTelegramStartError, launchBot } from './launch.js';
import { setupDefaultBotCommands } from './bot-commands.js';
import { warnIfGeocodingMisconfigured } from '../shared/geocoding.js';

export async function runBot({ setupSignals = true, skipInit = false } = {}) {
  if (!skipInit) {
    await ensureDatabase(config.databaseUrl);
    await initDb();
  }

  const bot = createBot();
  warnIfGeocodingMisconfigured();
  let botRunning = false;

  const shutdown = async (signal) => {
    console.log(`\n${signal}, stopping bot...`);
    if (botRunning) {
      try {
        bot.stop(signal);
      } catch {
        // ignore
      }
    }
    await closeDb();
    process.exit(0);
  };

  if (setupSignals) {
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  }

  console.log('Connecting to Telegram API...');
  await launchBot(bot);
  await setupDefaultBotCommands(bot.telegram);
  botRunning = true;
  console.log(`Bot is running (AI_PROVIDER=${config.aiProvider})`);

  return { bot, shutdown, setBotRunning: (v) => { botRunning = v; } };
}

async function main() {
  try {
    await runBot();
  } catch (err) {
    console.error('Telegram bot failed to start:', formatTelegramStartError(err));
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Failed to start:', err?.message ?? err);
    process.exit(1);
  });
}
