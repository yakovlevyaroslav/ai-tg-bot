import { Markup } from 'telegraf';
import {
  buildOnboardingPageUrl,
  canOpenAsWebApp,
  canOpenMenuAsUrl,
  WEB_APP_MENU_TEXT,
} from '../shared/visit-card.js';

export function dismissReplyKeyboard() {
  return Markup.removeKeyboard();
}

/** Скрывает старое reply-меню у пользователей, у которых оно ещё отображается */
export async function dismissLegacyReplyKeyboard(ctx) {
  const msg = await ctx.reply('\u200b', dismissReplyKeyboard()).catch(() => null);
  if (msg) {
    await ctx.deleteMessage(msg.message_id).catch(() => {});
  }
}

export function buildMenuInlineButton(menuUrl = buildOnboardingPageUrl()) {
  const label = `🗂️ ${WEB_APP_MENU_TEXT}`;

  if (canOpenAsWebApp(menuUrl)) {
    return Markup.button.webApp(label, menuUrl);
  }

  if (canOpenMenuAsUrl(menuUrl)) {
    return Markup.button.url(label, menuUrl);
  }

  return Markup.button.callback(label, 'post:menu:open');
}

export function postActionsInlineKeyboard({ menuUrl = null } = {}) {
  const url = menuUrl || buildOnboardingPageUrl();

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✍️ Свой вопрос', 'post:questions:custom'),
      Markup.button.callback('🔥 Популярные вопросы', 'post:questions:popular'),
    ],
    [
      Markup.button.callback('📋 Тарифы', 'post:tariffs'),
      buildMenuInlineButton(url),
    ],
  ]);
}

export function balanceTariffsInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 Тарифы', 'post:tariffs')],
  ]);
}

export function postOnboardingInlineKeyboard(menuUrl = null) {
  const url = menuUrl || buildOnboardingPageUrl();
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('❓ Вопросы', 'post:questions'),
      Markup.button.callback('📋 Тарифы', 'post:tariffs'),
    ],
    [buildMenuInlineButton(url)],
  ]);
}

export function questionsMenuInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Свой вопрос', 'post:questions:custom')],
    [Markup.button.callback('🔥 Популярные вопросы', 'post:questions:popular')],
    [Markup.button.callback('◀️ Назад', 'post:questions:back')],
  ]);
}

export function customQuestionInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('◀️ Назад', 'post:questions:menu')],
  ]);
}

const INLINE_BUTTON_MAX = 58;

function truncateInlineButton(label) {
  if (label.length <= INLINE_BUTTON_MAX) {
    return label;
  }
  return `${label.slice(0, INLINE_BUTTON_MAX - 1)}…`;
}

export function popularQuestionsInlineKeyboard(questions) {
  const rows = questions.map((item) => [
    Markup.button.callback(truncateInlineButton(item.button), `post:questions:pick:${item.id}`),
  ]);
  rows.push([Markup.button.callback('◀️ Назад', 'post:questions:menu')]);
  return Markup.inlineKeyboard(rows);
}

export function popularSubquestionsInlineKeyboard(parentId, subquestions) {
  const rows = subquestions.map((item) => [
    Markup.button.callback(
      truncateInlineButton(item.button),
      `post:questions:ask:${parentId}:${item.id}`,
    ),
  ]);
  rows.push([Markup.button.callback('◀️ Назад', 'post:questions:popular')]);
  return Markup.inlineKeyboard(rows);
}
