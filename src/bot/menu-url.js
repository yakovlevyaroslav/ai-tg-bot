import * as db from '../shared/db.js';
import { Markup } from 'telegraf';
import {
  buildOnboardingPageUrl,
  buildVisitCardPublicUrl,
  canOpenAsWebApp,
  canOpenMenuAsUrl,
  isBrowsableUrl,
} from '../shared/visit-card.js';
import { buildMenuInlineButton, postActionsInlineKeyboard } from './keyboards.js';

export async function resolveUserMenuUrl(userId) {
  if (!userId) {
    return buildOnboardingPageUrl();
  }

  const profile = await db.getUserProfile(userId);

  if (profile?.onboarding_completed) {
    const published = await db.ensureVisitCardPublished(userId);
    const url = buildVisitCardPublicUrl(published?.personalityCode);
    if (url) {
      return url;
    }
  }

  return buildOnboardingPageUrl();
}

export async function buildPostActionsKeyboard(userId) {
  const menuUrl = await resolveUserMenuUrl(userId);
  return postActionsInlineKeyboard({ menuUrl });
}

export async function handleMenuOpen(ctx, userId) {
  await ctx.answerCbQuery().catch(() => {});
  const url = await resolveUserMenuUrl(userId);
  const profile = await db.getUserProfile(userId);

  if (profile?.onboarding_completed && url) {
    if (canOpenAsWebApp(url) || canOpenMenuAsUrl(url)) {
      await ctx.reply('🪪 Ваша визитка с кодом личности', {
        ...Markup.inlineKeyboard([[buildMenuInlineButton(url)]]),
      });
      return;
    }

    await ctx.reply(
      `🪪 Ваша визитка с кодом личности:\n${url}\n\n` +
        'Откройте ссылку в браузере (для localhost Telegram не делает кнопку-ссылку).',
    );
    return;
  }

  await ctx.reply(
    `Пройдите анкету в боте, чтобы получить код личности и визитку.\n\n` +
      (canOpenAsWebApp(url) || isBrowsableUrl(url)
        ? `Страница: ${url}`
        : `Страница: ${buildOnboardingPageUrl()}`),
  );
}
