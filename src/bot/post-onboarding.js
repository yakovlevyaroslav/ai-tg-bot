import * as db from '../shared/db.js';
import { config } from '../shared/config.js';
import { formatTariffsMessage } from '../shared/pricing.js';
import {
  postOnboardingInlineKeyboard,
  questionsMenuInlineKeyboard,
  popularQuestionsInlineKeyboard,
  popularSubquestionsInlineKeyboard,
} from './keyboards.js';
import { syncCommandReplyKeyboardIfNeeded } from './command-reply-keyboard.js';
import { resolveUserMenuUrl } from './menu-url.js';
import { scheduleIdleNudge } from './idle-nudge.js';
import { beginCustomQuestion } from './question-flow-handlers.js';
import { tariffsInlineKeyboard } from './topup.js';
import { EVENTS, trackEvent } from '../shared/analytics.js';

export const POPULAR_QUESTIONS = [
  {
    id: 0,
    text: 'В чём моё предназначение по коду личности?',
    button: '1. Предназначение',
    subquestions: [
      {
        id: 0,
        text: 'Какая главная миссия заложена в моём коде личности?',
        button: '• Главная миссия',
      },
      {
        id: 1,
        text: 'Какие таланты мне важнее всего раскрывать в ближайшие годы?',
        button: '• Ключевые таланты',
      },
      {
        id: 2,
        text: 'Как понять, что я иду своим путём, а не навязанным сценарием?',
        button: '• Свой путь',
      },
    ],
  },
  {
    id: 1,
    text: 'Что сейчас больше всего тормозит мой личностный рост?',
    button: '2. Что тормозит рост',
    subquestions: [
      {
        id: 0,
        text: 'Какие внутренние страхи сильнее всего влияют на мои решения?',
        button: '• Внутренние страхи',
      },
      {
        id: 1,
        text: 'Что во мне тянет назад, хотя я уже знаю, куда хочу прийти?',
        button: '• Что тянет назад',
      },
      {
        id: 2,
        text: 'Какой один шаг поможет снять главный блок прямо сейчас?',
        button: '• Первый шаг',
      },
    ],
  },
  {
    id: 2,
    text: 'Как мне выстроить отношения с людьми, опираясь на мой код?',
    button: '3. Отношения',
    subquestions: [
      {
        id: 0,
        text: 'Какой тип людей мне лучше всего подходит в близких отношениях?',
        button: '• Кому я ближе',
      },
      {
        id: 1,
        text: 'Где я чаще всего ошибаюсь в общении по своему коду личности?',
        button: '• Ошибки в общении',
      },
      {
        id: 2,
        text: 'Что мне важно проговорить партнёру о своих потребностях?',
        button: '• Мои потребности',
      },
    ],
  },
  {
    id: 3,
    text: 'В какой сфере работы я реализуюсь лучше всего?',
    button: '4. Сфера работы',
    subquestions: [
      {
        id: 0,
        text: 'В каких ролях я быстрее чувствую энергию и смысл?',
        button: '• Роли с энергией',
      },
      {
        id: 1,
        text: 'Что в работе для меня обязательно, а без чего я выгораю?',
        button: '• Условия без выгорания',
      },
      {
        id: 2,
        text: 'Куда логичнее двигаться в карьере в ближайшие 1–2 года?',
        button: '• Вектор на 1–2 года',
      },
    ],
  },
];

export const POST_ONBOARDING_INTRO_TEXT =
  'Вот мы и посмотрели самую поверхностную характеристику твоего кода личности. Уже отлично! 💫 Думаю, нам стоит покопаться глубже';

export const POST_ONBOARDING_TEXT =
  'Чтобы выбрать вопрос, нажми ниже на кнопку «Вопросы».\n' +
  'Свой код личности можно открыть кнопкой «Мой код личности».\n' +
  'В бесплатном тарифе у тебя есть возможность спросить меня 1 раз.\n' +
  'Ещё ты можешь задать свой вопрос, выбрав платный тариф\n\n' +
  'Готов помочь найти ответы 🙏';

export const QUESTIONS_MENU_TEXT =
  '❓ Выберите, как хотите задать вопрос:';

function buildPopularQuestionsText() {
  const lines = POPULAR_QUESTIONS.map((item) => `${item.id + 1}. ${item.text}`);
  return '🔥 Популярные вопросы\n\n' + lines.join('\n');
}

function buildPopularTopicText(question) {
  const lines = question.subquestions.map(
    (item, index) => `${index + 1}. ${item.text}`,
  );

  return (
    `${question.text}\n\n` +
    'Уточни тему — выбери подвопрос:\n\n' +
    lines.join('\n')
  );
}

export function getPopularQuestionById(id) {
  return POPULAR_QUESTIONS.find((item) => item.id === Number(id)) ?? null;
}

export function getPopularSubquestion(parentId, subId) {
  const parent = getPopularQuestionById(parentId);
  if (!parent) {
    return null;
  }

  const sub = parent.subquestions.find((item) => item.id === Number(subId));
  if (!sub) {
    return null;
  }

  return {
    parent,
    sub,
    prompt: `Тема: ${parent.text}\n\nВопрос: ${sub.text}`,
  };
}

function postOnboardingDelay(ms = config.messageCooldownMs) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendPostOnboardingMenu(ctx, userId) {
  const profile = await db.getUserProfile(userId);
  if (!profile?.onboarding_completed) {
    await ctx.reply('Сначала пройдите анкету — нажмите /start или /restart.');
    return false;
  }

  const menuUrl = await resolveUserMenuUrl(userId);
  await ctx.reply(POST_ONBOARDING_TEXT, postOnboardingInlineKeyboard(menuUrl));
  return true;
}

export async function sendPostOnboardingOffer(ctx, userId, { withIntro = false } = {}) {
  if (withIntro) {
    await postOnboardingDelay();
    await ctx.reply(POST_ONBOARDING_INTRO_TEXT);
    await postOnboardingDelay();
  }

  const sent = await sendPostOnboardingMenu(ctx, userId);
  if (!sent) {
    return;
  }

  await syncCommandReplyKeyboardIfNeeded(ctx, userId);

  const chatId = ctx.chat?.id;
  if (chatId != null) {
    scheduleIdleNudge({
      telegram: ctx.telegram,
      chatId,
      userId,
    });
  }
}

export async function sendTariffsIntro(ctx, userId = null, { source = 'post_onboarding' } = {}) {
  const telegramId = ctx.from?.id;
  if (userId) {
    trackEvent(userId, EVENTS.TARIFFS_OPENED, { source });
  }
  await ctx.reply(formatTariffsMessage(telegramId), tariffsInlineKeyboard(telegramId));
}

export async function sendQuestionsMenu(ctx) {
  await ctx.reply(QUESTIONS_MENU_TEXT, questionsMenuInlineKeyboard());
}

export async function sendPopularQuestionsMenu(ctx) {
  await ctx.reply(
    buildPopularQuestionsText(),
    popularQuestionsInlineKeyboard(POPULAR_QUESTIONS),
  );
}

export async function sendPopularTopicMenu(ctx, questionId) {
  const question = getPopularQuestionById(questionId);
  if (!question) {
    await ctx.reply('Тема не найдена', questionsMenuInlineKeyboard());
    return;
  }

  await ctx.reply(
    buildPopularTopicText(question),
    popularSubquestionsInlineKeyboard(question.id, question.subquestions),
  );
}

export async function handlePostOnboardingCallback(ctx, action, subAction = null, userId = null) {
  if (action === 'questions') {
    await ctx.answerCbQuery();

    if (subAction === 'custom') {
      if (!userId) {
        return;
      }
      await beginCustomQuestion(ctx, userId);
      return;
    }

    if (subAction === 'popular') {
      await sendPopularQuestionsMenu(ctx);
      return;
    }

    if (subAction === 'menu') {
      if (userId) {
        const profile = await db.getUserProfile(userId);
        if (profile?.onboarding_step === 'custom_question') {
          await db.setOnboardingStep(userId, 'completed');
        }
      }
      await sendQuestionsMenu(ctx);
      return;
    }

    if (subAction === 'back') {
      const menuUrl = userId ? await resolveUserMenuUrl(userId) : null;
      await ctx.reply(POST_ONBOARDING_TEXT, postOnboardingInlineKeyboard(menuUrl));
      return;
    }

    await sendQuestionsMenu(ctx);
    return;
  }

  if (action === 'tariffs') {
    await ctx.answerCbQuery();
    await sendTariffsIntro(ctx, userId);
  }
}
