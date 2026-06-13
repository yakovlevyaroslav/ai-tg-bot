/** Снимает устаревшее reply-меню (кнопки под полем ввода) один раз на чат за сессию бота. */
export function createDismissReplyKeyboardMiddleware() {
  const dismissed = new Set();

  return async (ctx, next) => {
    const chatId = ctx.chat?.id;

    if (chatId != null && ctx.chat?.type === 'private' && !dismissed.has(chatId)) {
      dismissed.add(chatId);
      try {
        const msg = await ctx.telegram.sendMessage(chatId, '\u200b', {
          reply_markup: { remove_keyboard: true },
        });
        await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
      } catch {
        // ignore — чат мог быть недоступен
      }
    }

    return next();
  };
}
