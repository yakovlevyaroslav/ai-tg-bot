import { config } from '../config.js';
import { checkYookassaPayment } from './service.js';

const activePolls = new Set();

/**
 * Периодически проверяет статус платежа в API ЮKassa, если webhook не дошёл.
 * @param {{ userId: number, paymentCode: string, onSuccess?: (result: object) => Promise<void> }} opts
 */
export function scheduleYookassaPaymentPoll({ userId, paymentCode, onSuccess }) {
  if (!paymentCode || activePolls.has(paymentCode)) {
    return;
  }

  activePolls.add(paymentCode);

  const intervalMs = config.yookassaPollIntervalMs;
  const maxAttempts = config.yookassaPollMaxAttempts;
  let attempts = 0;
  let stopped = false;

  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    activePolls.delete(paymentCode);

    if (reason === 'succeeded') {
      console.log(`[yookassa] poll confirmed ${paymentCode}`);
    } else if (reason === 'max_attempts') {
      console.log(
        `[yookassa] poll stopped for ${paymentCode}: no success after ${maxAttempts} checks`,
      );
    }
  };

  const tick = async () => {
    if (stopped) return;

    attempts += 1;

    try {
      const result = await checkYookassaPayment(userId, paymentCode);

      if (result.reason === 'already_completed' || (result.ok && result.alreadyGranted)) {
        // Webhook на RU уже зачислил — бот на NL шлёт «Оплата прошла» (RU не достучится до Telegram).
        if (onSuccess && result.ok && result.productType === 'topup') {
          await onSuccess(result, { force: true });
        }
        stop('already_completed');
        return;
      }

      if (result.ok && !result.alreadyGranted) {
        if (onSuccess) {
          await onSuccess(result);
        }
        stop('succeeded');
        return;
      }

      if (result.reason === 'cancelled') {
        stop('cancelled');
        return;
      }
    } catch (err) {
      console.warn(`[yookassa] poll error (${paymentCode}):`, err?.message ?? err);
    }

    if (attempts >= maxAttempts) {
      stop('max_attempts');
    }
  };

  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
}
