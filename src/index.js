import './shared/dns-ipv4-first.js';
import { config } from './shared/config.js';
import { ensureDatabase } from './shared/ensure-database.js';
import { initDb, closeDb } from './shared/db.js';
import { runBot } from './bot/index.js';
import { runSite } from './site/index.js';
import { stopSiteServer } from './site/server.js';
import { formatTelegramStartError } from './bot/launch.js';

/** Локальная разработка: бот + сайт в одном процессе */
async function main() {
  await ensureDatabase(config.databaseUrl);
  await initDb();

  const { server } = await runSite({
    setupSignals: false,
    skipInit: true,
  });

  let botHandle;

  const shutdown = async (signal) => {
    console.log(`\n${signal}, stopping...`);
    try {
      botHandle?.bot.stop(signal);
    } catch {
      // ignore
    }
    await stopSiteServer(server);
    await closeDb();
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    botHandle = await runBot({ setupSignals: false, skipInit: true });
  } catch (err) {
    console.error('Telegram bot failed to start:', formatTelegramStartError(err));
    console.log(`Site is still available at ${config.publicSiteUrl || 'http://localhost:3080'}/`);
  }
}

main().catch((err) => {
  console.error('Failed to start:', err?.message ?? err);
  process.exit(1);
});
