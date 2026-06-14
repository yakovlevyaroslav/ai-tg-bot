import { timingSafeEqual } from 'node:crypto';
import { config } from '../shared/config.js';
import * as db from '../shared/db.js';
import { EVENTS, trackEvent } from '../shared/analytics.js';
import { isAdmin } from './admin-commands.js';

const LOCKED_MESSAGE =
  '🔒 Бот временно доступен только по паролю.\n\nОтправьте пароль одним сообщением.';

function passwordsMatch(input, expected) {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function isBotAccessGateEnabled() {
  return Boolean(config.botAccessPassword);
}

export function createAccessGateMiddleware({ onAccessGranted } = {}) {
  return async (ctx, next) => {
    if (!isBotAccessGateEnabled()) {
      return next();
    }

    const telegramId = ctx.from?.id;
    if (!telegramId) {
      return;
    }

    if (isAdmin(telegramId)) {
      return next();
    }

    const access = await db.getUserAccessByTelegramId(telegramId);
    if (access?.access_granted) {
      return next();
    }

    const text = ctx.message?.text?.trim();
    if (text && passwordsMatch(text, config.botAccessPassword)) {
      const access = await db.grantBotAccess({
        telegramId,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
      });
      trackEvent(access.id, EVENTS.ACCESS_GRANTED);
      if (onAccessGranted) {
        await onAccessGranted(ctx);
      }
      return;
    }

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Сначала введите пароль', { show_alert: true });
      if (ctx.chat?.id) {
        await ctx.telegram.sendMessage(ctx.chat.id, LOCKED_MESSAGE);
      }
      return;
    }

    await ctx.reply(LOCKED_MESSAGE);
  };
}
