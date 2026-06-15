import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function detectEnvFile() {
  if (process.env.ENV_FILE) {
    return resolve(projectRoot, process.env.ENV_FILE);
  }

  const entry = process.argv[1] ?? '';
  if (entry.includes('/bot/') || entry.includes('\\bot\\')) {
    return resolve(projectRoot, '.env.bot');
  }
  if (entry.includes('/site/') || entry.includes('\\site\\')) {
    return resolve(projectRoot, '.env.site');
  }

  return resolve(projectRoot, '.env');
}

/** Загружает .env.bot / .env.site / .env, если переменные ещё не заданы (--env-file). */
export function loadProjectEnv() {
  if (process.env.TELEGRAM_BOT_TOKEN) {
    return;
  }

  const envFile = detectEnvFile();

  if (existsSync(envFile)) {
    dotenv.config({ path: envFile });
    return;
  }

  const fallback = resolve(projectRoot, '.env');
  if (envFile !== fallback && existsSync(fallback)) {
    dotenv.config({ path: fallback });
  }
}

loadProjectEnv();
