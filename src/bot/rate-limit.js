import { config } from '../shared/config.js';

const lastRequestAt = new Map();

export function checkCooldown(telegramId) {
  const now = Date.now();
  const last = lastRequestAt.get(telegramId) ?? 0;
  const elapsed = now - last;

  if (elapsed < config.messageCooldownMs) {
    return {
      ok: false,
      waitSec: Math.ceil((config.messageCooldownMs - elapsed) / 1000),
    };
  }

  lastRequestAt.set(telegramId, now);
  return { ok: true };
}
