import { Markup } from 'telegraf';
import { config } from '../shared/config.js';
import * as db from '../shared/db.js';
import { EVENTS, trackEvent } from '../shared/analytics.js';
import { applyUserMessagePlaceholders } from '../shared/user-display-name.js';

/** Темы для напоминания после базового разбора (5 мин без активности) */
export const IDLE_NUDGE_TOPICS = [
  {
    id: 0,
    button: '❤️ Отношения',
    prompt:
      'На основе моего кода личности: что сейчас важно понять в отношениях и близости? На что обратить внимание в ближайшие месяцы?',
  },
  {
    id: 1,
    button: '💼 Карьера и деньги',
    prompt:
      'На основе моего кода личности: в какой сфере работы и в деньгах мне сейчас сильнее всего раскрыться? Какой вектор выбрать на 1–2 года?',
  },
  {
    id: 2,
    button: '✨ Предназначение',
    prompt:
      'На основе моего кода личности: в чём моё предназначение и главная миссия? Какие таланты важнее всего раскрывать сейчас?',
  },
  {
    id: 3,
    button: '🌱 Внутренние блоки',
    prompt:
      'На основе моего кода личности: что сильнее всего тормозит мой рост и какой первый шаг поможет снять главный блок?',
  },
  {
    id: 4,
    button: '⚡ Энергия и ресурс',
    prompt:
      'На основе моего кода личности: где я теряю энергию и как восстановить ресурс? Что поддержит меня в ближайший период?',
  },
];

export const IDLE_NUDGE_INTRO =
  '{name}, по твоему коду личности сейчас могут особенно волновать такие темы 👇\n\n' +
  'Выбери сферу — сразу дам разбор. Или задай свой вопрос через «Вопросы».';

const activeTimers = new Map();

export function idleNudgeTopicsInlineKeyboard() {
  const rows = IDLE_NUDGE_TOPICS.map((topic) => [
    Markup.button.callback(topic.button, `post:idle:${topic.id}`),
  ]);
  rows.push([Markup.button.callback('❓ Другой вопрос', 'post:questions')]);
  return Markup.inlineKeyboard(rows);
}

export function getIdleNudgeTopicById(id) {
  return IDLE_NUDGE_TOPICS.find((item) => item.id === Number(id)) ?? null;
}

export function cancelIdleNudge(userId) {
  const timer = activeTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(userId);
  }
}

export function scheduleIdleNudge({ telegram, chatId, userId }) {
  cancelIdleNudge(userId);

  const delayMs = config.idleNudgeDelayMs;
  if (!delayMs || delayMs <= 0) {
    return;
  }

  const timer = setTimeout(() => {
    void sendIdleNudgeIfNeeded({ telegram, chatId, userId });
  }, delayMs);

  timer.unref?.();
  activeTimers.set(userId, timer);
}

async function sendIdleNudgeIfNeeded({ telegram, chatId, userId }) {
  activeTimers.delete(userId);

  try {
    const profile = await db.getUserProfile(userId);
    if (!profile?.onboarding_completed) {
      return;
    }
    if (profile.onboarding_data?.idle_nudge_sent) {
      return;
    }

    await db.setOnboardingStep(userId, profile.onboarding_step ?? 'completed', {
      idle_nudge_sent: true,
    });

    trackEvent(userId, EVENTS.IDLE_NUDGE_SENT);

    await telegram.sendMessage(
      chatId,
      applyUserMessagePlaceholders(IDLE_NUDGE_INTRO, profile),
      idleNudgeTopicsInlineKeyboard(),
    );
  } catch (err) {
    console.warn('[idle-nudge] send failed:', err?.message ?? err);
  }
}
