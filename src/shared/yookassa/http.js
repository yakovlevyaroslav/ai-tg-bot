import '../dns-ipv4-first.js';
import { Agent, fetch as undiciFetch } from 'undici';

const YOOKASSA_TIMEOUT_MS = Number(process.env.YOOKASSA_REQUEST_TIMEOUT_MS || 30000);

/** На VPS Node иногда ходит по IPv6 → fetch failed; принудительно IPv4 */
const dispatcher = new Agent({
  connect: {
    family: 4,
    timeout: YOOKASSA_TIMEOUT_MS,
  },
  bodyTimeout: YOOKASSA_TIMEOUT_MS,
  headersTimeout: YOOKASSA_TIMEOUT_MS,
});

export async function yookassaFetch(url, options = {}) {
  try {
    return await undiciFetch(url, {
      ...options,
      dispatcher,
    });
  } catch (err) {
    const code = err.cause?.code ?? err.code;
    const detail = code ? `${code}: ${err.cause?.message ?? err.message}` : (err.message ?? 'fetch failed');
    throw new Error(
      `Нет связи с api.yookassa.ru (${detail}). ` +
        'Проверьте интернет на сервере: curl -4 -I https://api.yookassa.ru',
    );
  }
}
