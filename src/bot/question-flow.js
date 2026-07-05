import { Markup } from 'telegraf';
import { config } from '../shared/config.js';

const THINKING_PHRASES = [
  'Сверяю цифры со звёздами… дай мне мгновение ✨',
  'Слушаю отголоски твоего кода в тишине…',
  'Соединяю нити судьбы, чисел и твоего вопроса…',
  'Смотрю в карту твоей личности — скоро откликнусь 🌙',
  'Настраиваюсь на ритм твоего кода, почти готово…',
  'Цифры складываются в узор — сейчас проявлю смысл ✨',
  'Перебираю знаки и архетипы твоего кода…',
  'Вопрос уже на столе — ищу, где в коде лежит ответ 🔮',
  'Слушаю, как твой код откликается на этот запрос…',
  'Сопоставляю линии судьбы с тем, что ты спросил…',
  'Код шепчет подсказки — собираю их в ответ ✨',
  'Заглядываю в глубину твоей карты личности…',
  'Числа и символы выстраиваются — миг терпения 🌙',
  'Смотрю, какие грани личности здесь ключевые…',
  'Сверяю внутренний ритм кода с темой вопроса ✨',
];

export const QUESTION_CONFIRM_TEXT =
  'Перед ответом можете добавить уточнение к вопросу — так разбор будет точнее.\n\n' +
  'Ваш вопрос:\n{question}\n\n' +
  '💬 Что для тебя в этом вопросе сейчас важнее всего — чувства, решение или долгосрочный результат? ' +
  'Можешь добавить это в уточнении или сразу получить ответ.';

export const QUESTION_ADDON_TEXT =
  'Напишите, что хотите добавить к вопросу:';

export const CUSTOM_QUESTION_TEXT =
  '✍️ Свой вопрос\n\n' +
  'Напишите ваш вопрос одним сообщением — учту код личности и помогу разобраться.';

export const QUESTION_CHANGE_TEXT =
  'Выберите другой вопрос из списка или напишите свой:';

export function questionConfirmInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Добавить информацию', 'post:question:add')],
    [Markup.button.callback('✏️ Поменять вопрос', 'post:question:change')],
    [Markup.button.callback('✅ Получить ответ', 'post:question:answer')],
  ]);
}

export function isQuestionFlowActive(profile) {
  const step = profile?.onboarding_step;
  return step === 'question_confirm' || step === 'question_addon';
}

export function buildQuestionConfirmMessage(pending) {
  let text = QUESTION_CONFIRM_TEXT.replace('{question}', pending.base_prompt);

  if (pending.additions?.length) {
    const extras = pending.additions
      .map((item, index) => `${index + 1}. ${item}`)
      .join('\n');
    text += `\n\nДополнительно:\n${extras}`;
  }

  return text;
}

export function buildFinalQuestionPrompt(pending) {
  let prompt = pending.base_prompt;

  if (pending.additions?.length) {
    const extras = pending.additions
      .map((item, index) => `${index + 1}. ${item}`)
      .join('\n');
    prompt += `\n\nДополнительно от пользователя:\n${extras}`;
  }

  return prompt;
}

function pickThinkingPhrase() {
  return THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
}

function delay(ms = config.questionThinkingDelayMs) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Короткий мистический пролог перед генерацией ответа */
export async function sendQuestionThinkingPrelude(ctx) {
  await ctx.sendChatAction('typing');
  await ctx.reply(pickThinkingPhrase());

  const end = Date.now() + config.questionThinkingDelayMs;
  while (Date.now() < end) {
    await ctx.sendChatAction('typing');
    const remaining = end - Date.now();
    await delay(Math.min(4000, remaining));
  }
}
