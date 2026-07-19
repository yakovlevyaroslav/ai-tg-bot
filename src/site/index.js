import { fileURLToPath } from 'node:url';
import { config } from '../shared/config.js';
import { ensureDatabase } from '../shared/ensure-database.js';
import { initDb, closeDb } from '../shared/db.js';
import { startSiteServer, stopSiteServer } from './server.js';

export async function runSite({ setupSignals = true, skipInit = false } = {}) {
  if (!skipInit) {
    await ensureDatabase(config.databaseUrl);
    await initDb();
  }

  const server = startSiteServer();

  if (!server) {
    throw new Error('Site server failed to start');
  }

  const shutdown = async (signal) => {
    console.log(`\n${signal}, stopping site...`);
    await stopSiteServer(server);
    await closeDb();
    process.exit(0);
  };

  if (setupSignals) {
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  }

  const { startBroadcastWorker } = await import('../shared/broadcast/worker.js');
  startBroadcastWorker();

  return { server, shutdown };
}

async function main() {
  try {
    await runSite();
  } catch (err) {
    console.error('Site failed to start:', err?.message ?? err);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
