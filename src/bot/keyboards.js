import { Markup } from 'telegraf';
import { config } from '../shared/config.js';

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

export function postActionsInlineKeyboard({ visitCardPublished = false } = {}) {
  const rows = [
    [
      Markup.button.callback('✍️ Свой вопрос', 'post:questions:custom'),
      Markup.button.callback('🔥 Популярные вопросы', 'post:questions:popular'),
    ],
    [
      Markup.button.callback('📋 Тарифы', 'post:tariffs'),
      Markup.button.callback('🗂️ Меню', 'post:followup:commands'),
    ],
  ];

  if (visitCardPublished) {
    rows.push([Markup.button.callback('🪪 Моя визитка', 'post:tariffs:visit_card')]);
  }

  return Markup.inlineKeyboard(rows);
}

export function balanceTariffsInlineKeyboard({ visitCardPublished = false } = {}) {
  const rows = [[Markup.button.callback('📋 Тарифы', 'post:tariffs')]];

  if (visitCardPublished) {
    rows.unshift([Markup.button.callback('🪪 Моя визитка', 'post:tariffs:visit_card')]);
  }

  return Markup.inlineKeyboard(rows);
}

export function postOnboardingInlineKeyboard({ visitCardPublished = false } = {}) {
  const rows = [
    [
      Markup.button.callback('❓ Вопросы', 'post:questions'),
      Markup.button.callback('📋 Тарифы', 'post:tariffs'),
    ],
  ];

  if (visitCardPublished) {
    rows.push([Markup.button.callback('🪪 Моя визитка', 'post:tariffs:visit_card')]);
  }

  return Markup.inlineKeyboard(rows);
}

export function visitCardTariffsRow(visitCardPublished) {
  if (visitCardPublished) {
    return [Markup.button.callback('🪪 Моя визитка', 'post:tariffs:visit_card')];
  }

  return [
    Markup.button.callback(`🪪 Визитка · ${config.visitCardPriceRub} ₽`, 'post:tariffs:visit_card'),
  ];
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
