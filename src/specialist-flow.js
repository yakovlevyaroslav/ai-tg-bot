import * as db from './db.js';
import {
  SPECIALISTS,
  formatSpecialistLine,
  getSpecialist,
  specialistPickerKeyboard,
} from './specialists.js';
import { mainKeyboard } from './keyboards.js';

export async function sendSpecialistMenu(ctx, { intro = '' } = {}) {
  const lines = [
    intro || 'Выберите специалиста — от его личности зависит стиль ответов:',
    '',
    ...Object.values(SPECIALISTS).map((s) => `${s.button} — ${s.description}`),
  ];

  await ctx.reply(lines.join('\n'), specialistPickerKeyboard());
}

export async function applySpecialistChoice(ctx, userId, specialistId) {
  const specialist = getSpecialist(specialistId);
  if (!specialist) {
    await ctx.answerCbQuery?.('Неизвестный специалист');
    return null;
  }

  await db.setUserSpecialist(userId, specialistId);
  await db.clearHistory(userId);

  const text =
    `Вы общаетесь с: ${specialist.button}\n` +
    `${specialist.description}\n\n` +
    'История диалога сброшена под нового специалиста. Напишите ваш вопрос.';

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery(`Выбран: ${specialist.title}`);
    await ctx.editMessageText(text);
    await ctx.reply('Клавиатура ниже 👇', mainKeyboard());
  } else {
    await ctx.reply(text, mainKeyboard());
  }

  return specialist;
}

export async function ensureSpecialistOrPrompt(ctx, userId) {
  const profile = await db.getUserProfile(userId);
  if (profile?.specialist) {
    return profile.specialist;
  }
  await sendSpecialistMenu(ctx, {
    intro: 'Сначала выберите специалиста — потом можно писать вопрос.',
  });
  return null;
}

export function specialistStatusLine(specialistId) {
  return `Сейчас: ${formatSpecialistLine(specialistId)}`;
}
