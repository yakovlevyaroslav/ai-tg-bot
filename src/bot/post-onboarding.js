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
import { applyUserMessagePlaceholders } from '../shared/user-display-name.js';

export const POPULAR_QUESTIONS = [
  {
    id: 0,
    emoji: '❤️',
    text: 'Что мой код личности говорит об отношениях и любви?',
    button: '❤️ Отношения',
    subquestions: [
      {
        id: 0,
        text: 'Какой партнёр мне подходит по коду личности и где искать свою любовь?',
        button: '💕 Кого искать',
      },
      {
        id: 1,
        text: 'Когда для меня наступает благоприятный период для отношений и что важно сделать, чтобы встретить «своего» человека?',
        button: '🌙 Лучший период',
      },
      {
        id: 2,
        text: 'Что во мне притягивает не тех мужчин и как выстроить отношения, в которых я чувствую себя любимой и ценной?',
        button: '🪞 Любовь к себе',
      },
    ],
  },
  {
    id: 1,
    emoji: '💰',
    text: 'Как мне реализовать себя в деньгах и работе?',
    button: '💰 Деньги',
    subquestions: [
      {
        id: 0,
        text: 'Какие пути заработка и источники дохода лучше всего открыты для меня по коду личности?',
        button: '💸 Пути заработка',
      },
      {
        id: 1,
        text: 'В чём мои сильные стороны в работе и как их выгодно применить?',
        button: '⭐ Сильные стороны',
      },
      {
        id: 2,
        text: 'С каким партнёром — в бизнесе или личной жизни — я не буду нуждаться в достатке?',
        button: '🤝 Партнёр и достаток',
      },
    ],
  },
  {
    id: 2,
    emoji: '🌿',
    text: 'На что обратить внимание в здоровье по моему коду?',
    button: '🌿 Здоровье',
    subquestions: [
      {
        id: 0,
        text: 'На что в здоровье мне важно обратить внимание в ближайший период?',
        button: '🩺 На что смотреть',
      },
      {
        id: 1,
        text: 'Как поддержать ментальное спокойствие и эмоциональный баланс по моему коду личности?',
        button: '🧘 Спокойствие и душа',
      },
      {
        id: 2,
        text: 'Где я теряю силы и как мягко восстановить энергию, чтобы не выгорать?',
        button: '🔋 Энергия и ресурс',
      },
    ],
  },
  {
    id: 3,
    emoji: '✨',
    text: 'Куда двигаться в личном развитии?',
    button: '✨ Развитие',
    subquestions: [
      {
        id: 0,
        text: 'Какое хобби или творческое занятие принесёт мне радость и наполнит жизнь?',
        button: '🎨 Хобби и радость',
      },
      {
        id: 1,
        text: 'В какой профессии или сфере меня ждёт настоящий успех?',
        button: '🚀 Профессия и успех',
      },
      {
        id: 2,
        text: 'В какой сфере жизни сейчас важнее всего расти и развиваться?',
        button: '🌱 Куда расти',
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
  const lines = POPULAR_QUESTIONS.map(
    (item) => `${item.emoji} ${item.text}`,
  );
  return '🔥 Популярные вопросы\n\nВыбери тему 👇\n\n' + lines.join('\n\n');
}

function buildPopularTopicText(question) {
  const lines = question.subquestions.map((item) => `${item.button}\n${item.text}`);

  return (
    `${question.emoji} ${question.text}\n\n` +
    'Выбери вопрос 👇\n\n' +
    lines.join('\n\n')
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
  await ctx.reply(
    applyUserMessagePlaceholders(POST_ONBOARDING_TEXT, profile),
    postOnboardingInlineKeyboard(menuUrl),
  );
  return true;
}

export async function sendPostOnboardingOffer(ctx, userId, { withIntro = false } = {}) {
  const profile = withIntro ? await db.getUserProfile(userId) : null;

  if (withIntro) {
    await postOnboardingDelay();
    await ctx.reply(applyUserMessagePlaceholders(POST_ONBOARDING_INTRO_TEXT, profile ?? {}));
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
