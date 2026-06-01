import { fileURLToPath } from 'node:url';
import { config } from '../shared/config.js';
import { ensureDatabase } from '../shared/ensure-database.js';
import { initDb, closeDb } from '../shared/db.js';
import { startSiteServer, stopSiteServer } from './server.js';
import { notifyPaymentSuccess } from './notify.js';

export async function runSite({ setupSignals = true, onPaymentSuccess = notifyPaymentSuccess, skipInit = false } = {}) {
  if (!skipInit) {
    await ensureDatabase(config.databaseUrl);
    await initDb();
  }

  const server = startSiteServer({ onPaymentSuccess });

  if (!server) {
    throw new Error('Site server disabled — set ADMIN_WEB_PASSWORD or PAYMENT_PROVIDER=yookassa');
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
