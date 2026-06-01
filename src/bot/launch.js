const TELEGRAM_LAUNCH_TIMEOUT_MS = Number(process.env.TELEGRAM_LAUNCH_TIMEOUT_MS || 30000);

export function formatTelegramStartError(err) {
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

/** Telegraf launch() не резолвится — polling бесконечный. Старт считаем успешным после onLaunch. */
export function launchBot(bot, ms = TELEGRAM_LAUNCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Telegram connection timeout (${ms / 1000}s). Проверьте TELEGRAM_BOT_TOKEN и доступ к api.telegram.org`,
        ),
      );
    }, ms);

    bot
      .launch({ dropPendingUpdates: false }, () => {
        clearTimeout(timer);
        resolve();
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
