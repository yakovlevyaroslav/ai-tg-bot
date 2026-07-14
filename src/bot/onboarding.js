import { Markup } from 'telegraf';
import { config } from '../shared/config.js';
import * as db from '../shared/db.js';
import {
  generatePersonalityCode,
  splitPersonalityCodeReply,
} from './personality-code.js';
import { resolveBirthPlace } from '../shared/birth-place-timezone.js';
import {
  buildCommandReplyKeyboard,
  markCommandReplyKeyboardShown,
  syncCommandReplyKeyboardIfNeeded,
} from './command-reply-keyboard.js';
import { syncUserBotCommands } from './bot-commands.js';
import { sendPostOnboardingOffer, sendQuestionsMenu } from './post-onboarding.js';
import {
  generateRandomOnboardingData,
  buildAdminSkipCodeMessage,
  enrichOnboardingDataWithCodes,
} from '../shared/onboarding-context.js';
import { getUserErrorMessage } from '../shared/errors.js';
import { buildWelcomeText, WELCOME_MESSAGE_PARSE_MODE } from '../shared/welcome-message.js';
import { replyFormatted } from '../shared/telegram-format.js';
import { EVENTS, trackEvent } from '../shared/analytics.js';
import { opensQuestionsMenuOnStart, getAcquirableStartPayload } from '../shared/start-payload.js';

const MESSAGES = {
  askName:
    'Мне нужно немного информации, чтобы определить твой код личности 🔢\n\n' +
    'Для начала скажи своё имя:',
  askGender: 'Выберите пол:',
  askBirthDate: 'А теперь напиши дату рождения в формате 28.05.1993',
  askBirthTime:
    'Напиши время рождения в формате: 18:47\n(если не знаешь точное, напиши примерное):',
  askBirthPlace:
    'И последнее — напиши город или населённый пункт рождения. Например: Москва',
  confirmHint: 'Всё верно? Нажмите кнопку ниже 👇',
  thinking:
    '🧠 Сейчас в раздумьях — свожу Астрологию, Human Design, Нумерологию, Сюцай и Ведическую Астрологию в единый код личности...',
  calculationError:
    'Не удалось сформировать код личности. Попробуйте ещё раз: нажмите /restart и пройдите анкету заново.',
};

const LOADING_PHRASES = [
  'Подожди немного, ещё анализирую твой код личности...',
  'Формирую твой код личности и собираю цифры судьбы, подожди...',
];

const GENDER_LABELS = {
  male: 'Мужской',
  female: 'Женский',
};

const BIRTH_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const BIRTH_TIME_RE = /^(\d{1,2}):(\d{2})$/;

function delay(ms = config.onboardingDelayMs) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pulseTyping(ctx, durationMs) {
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    await ctx.sendChatAction('typing');
    const remaining = end - Date.now();
    await delay(Math.min(4000, remaining));
  }
}

function genderKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Мужской', 'onboard:gender:male')],
    [Markup.button.callback('Женский', 'onboard:gender:female')],
  ]);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Да (начинаем расчёт)', 'onboard:confirm:yes')],
    [Markup.button.callback('Нет (заполнить сначала)', 'onboard:confirm:no')],
  ]);
}

function buildSummaryText(data) {
  const place = data.birth_place_label ?? '—';
  const placeLine = data.birth_timezone
    ? `Место рождения: ${place} (${data.birth_timezone}${data.birth_utc_offset ? `, ${data.birth_utc_offset}` : ''})`
    : `Место рождения: ${place}`;

  return [
    'Указаны данные:',
    '',
    `Ваше имя: ${data.name ?? '—'}`,
    `Пол: ${data.gender_label ?? '—'}`,
    `Дата рождения: ${data.birth_date ?? '—'}`,
    `Время рождения: ${data.birth_time ?? '—'} (местное)`,
    placeLine,
  ].join('\n');
}

export function isOnboardingBlocking(profile) {
  return Boolean(profile?.onboarding_step) && !profile?.onboarding_completed;
}

function parseBirthDate(text) {
  const match = text.trim().match(BIRTH_DATE_RE);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

function parseBirthTime(text) {
  const match = text.trim().match(BIRTH_TIME_RE);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

async function askGender(ctx, userId) {
  await delay();
  await ctx.reply(MESSAGES.askGender, genderKeyboard());
  await db.setOnboardingStep(userId, 'await_gender');
}

async function askBirthDate(ctx, userId) {
  await delay();
  await ctx.reply(MESSAGES.askBirthDate);
  await db.setOnboardingStep(userId, 'await_birth_date');
}

async function askBirthTime(ctx, userId) {
  await delay();
  await ctx.reply(MESSAGES.askBirthTime);
  await db.setOnboardingStep(userId, 'await_birth_time');
}

async function askBirthPlace(ctx, userId) {
  await delay();
  await ctx.reply(MESSAGES.askBirthPlace);
  await db.setOnboardingStep(userId, 'await_birth_place');
}

async function sendSummaryForConfirm(ctx, userId, data) {
  await delay();
  await ctx.reply(buildSummaryText(data), confirmKeyboard());
  await db.setOnboardingStep(userId, 'await_confirm');
}

async function stopTypingLoop(typingLoop) {
  if (!typingLoop) {
    return;
  }

  try {
    await typingLoop;
  } catch {
    // Фоновый typing не должен ломать основной поток
  }
}

async function runCalculationLoading(ctx, userId) {
  let typingActive = false;
  let typingLoop = null;

  try {
    for (const [index, phrase] of LOADING_PHRASES.entries()) {
      await ctx.sendChatAction('typing').catch(() => {});
      await ctx.reply(phrase);
      if (index < LOADING_PHRASES.length - 1) {
        await pulseTyping(ctx, config.onboardingCalculationDelayMs);
      }
    }

    await pulseTyping(ctx, config.onboardingCalculationDelayMs);
    await ctx.reply(MESSAGES.thinking);
    await pulseTyping(ctx, config.onboardingCalculationDelayMs);

    const profile = await db.getUserProfile(userId);
    const data = profile?.onboarding_data;

    typingActive = true;
    typingLoop = (async () => {
      while (typingActive) {
        await ctx.sendChatAction('typing').catch(() => {});
        await delay(4000);
      }
    })();

    const result = await generatePersonalityCode(data);

    const chunks = splitPersonalityCodeReply(result.content, {
      mainContent: result.mainContent,
      conclusionContent: result.conclusionContent,
    });

    for (const chunk of chunks) {
      await replyFormatted(ctx, chunk);
    }

    await db.assignPersonalityCode(userId, result.codes.fullCode, {
      personality_code: result.codes.fullCode,
      astrology_code: result.codes.astrologyCode,
      human_design_code: result.codes.humanDesignCode,
      numerology_code: result.codes.numerologyCode,
      sucai_code: result.codes.sucaiCode,
      jyotish_code: result.codes.jyotishCode,
      personality_code_result: result.content,
      ...(result.onboardingDataPatch ?? {}),
    });
    await db.setOnboardingStep(userId, 'completed');
    await db.setOnboardingCompleted(userId, true);
    trackEvent(userId, EVENTS.PERSONALITY_CODE_GENERATED, { model: result.model });
    await db.ensureVisitCardPublished(userId);
    trackEvent(userId, EVENTS.VISIT_CARD_PUBLISHED, { source: 'onboarding' });
    await syncUserBotCommands(ctx.telegram, ctx.from?.id, userId);
    await sendPostOnboardingOffer(ctx, userId, { withIntro: true });
  } catch (err) {
    console.error('Personality code error:', err?.message ?? err);
    await db.setOnboardingStep(userId, 'calculation_failed');
    trackEvent(userId, EVENTS.PERSONALITY_CODE_FAILED, {
      code: err?.code ?? err?.message ?? 'unknown',
    });
    await ctx.reply(getUserErrorMessage(err) || MESSAGES.calculationError);
  } finally {
    typingActive = false;
    await stopTypingLoop(typingLoop);
  }
}

async function saveBirthPlaceAndConfirm(ctx, userId, query) {
  const place = query.trim();
  if (!place) {
    await ctx.reply('Напишите название города.');
    return;
  }

  const profile = await db.getUserProfile(userId);
  const data = profile?.onboarding_data ?? {};
  const resolved = await resolveBirthPlace(place, {
    birthDate: data.birth_date,
    birthTime: data.birth_time,
  });

  await db.setOnboardingStep(userId, 'await_confirm', {
    birth_place: place,
    birth_place_label: resolved.birth_place_label || place,
    birth_place_lat: resolved.birth_place_lat,
    birth_place_lon: resolved.birth_place_lon,
    birth_timezone: resolved.birth_timezone,
    birth_utc_offset: resolved.birth_utc_offset,
    birth_time_context: resolved.birth_time_context,
  });

  const placeLine = resolved.birth_timezone
    ? `Место рождения: ${resolved.birth_place_label || place} (${resolved.birth_timezone})`
    : `Место рождения: ${resolved.birth_place_label || place}`;
  await ctx.reply(placeLine);

  const updated = await db.getUserProfile(userId);
  await sendSummaryForConfirm(ctx, userId, updated.onboarding_data);
}

async function beginOnboarding(ctx, userId) {
  const profile = await db.getUserProfile(userId);
  const user = profile ?? { first_name: ctx.from?.first_name, onboarding_completed: false };
  await ctx.reply(buildWelcomeText(user, { telegramId: ctx.from?.id }), {
    parse_mode: WELCOME_MESSAGE_PARSE_MODE,
  });
  await delay();
  await ctx.reply(MESSAGES.askName, buildCommandReplyKeyboard(ctx.from?.id));
  markCommandReplyKeyboardShown(ctx);
  await db.setOnboardingStep(userId, 'await_name');
}

async function resumeOnboarding(ctx, userId, profile) {
  const step = profile.onboarding_step;
  const telegramId = ctx.from?.id;

  switch (step) {
    case 'await_name':
      await ctx.reply(MESSAGES.askName, buildCommandReplyKeyboard(telegramId));
      markCommandReplyKeyboardShown(ctx);
      return;
    case 'await_gender':
      await ctx.reply('Выберите пол кнопкой ниже 👇', genderKeyboard());
      return;
    case 'await_birth_date':
      await ctx.reply(MESSAGES.askBirthDate);
      return;
    case 'await_birth_time':
      await ctx.reply(MESSAGES.askBirthTime);
      return;
    case 'await_birth_place':
      await ctx.reply(MESSAGES.askBirthPlace);
      return;
    case 'await_confirm':
      await ctx.reply(buildSummaryText(profile.onboarding_data ?? {}), confirmKeyboard());
      return;
    case 'calculating':
      await ctx.reply(LOADING_PHRASES[LOADING_PHRASES.length - 1]);
      return;
    case 'calculation_failed':
      await ctx.reply(MESSAGES.calculationError);
      return;
    default:
      await beginOnboarding(ctx, userId);
  }
}

/** /start — без сброса: меню после анкеты или продолжение с текущего шага */
export async function handleStartCommand(ctx, userId, { startPayload = '' } = {}) {
  const { saved, isFirst } = await db.saveUserStartPayload(userId, startPayload);
  if (saved) {
    trackEvent(userId, EVENTS.ACQUISITION_START, {
      start_payload: getAcquirableStartPayload(startPayload),
      first_touch: isFirst,
    });
  }

  trackEvent(userId, EVENTS.BOT_START);
  const profile = await db.getUserProfile(userId);

  if (profile?.onboarding_completed) {
    if (opensQuestionsMenuOnStart(startPayload)) {
      await sendQuestionsMenu(ctx);
      await syncCommandReplyKeyboardIfNeeded(ctx, userId);
      return;
    }

    await sendPostOnboardingOffer(ctx, userId);
    return;
  }

  if (profile?.onboarding_step) {
    await resumeOnboarding(ctx, userId, profile);
    return;
  }

  await beginOnboarding(ctx, userId);
}

/** Сброс анкеты и запуск с нуля — /restart и «заполнить сначала» */
export async function startOnboarding(ctx, userId) {
  await db.resetOnboarding(userId);
  await beginOnboarding(ctx, userId);
}

/** Пропуск анкеты для админа — сразу к финальному этапу */
export async function skipOnboardingForAdmin(ctx, userId) {
  const randomData = enrichOnboardingDataWithCodes(generateRandomOnboardingData());
  const stubResult = buildAdminSkipCodeMessage(randomData);

  await db.assignPersonalityCode(userId, randomData.personality_code, {
    ...randomData,
    personality_code_result: stubResult,
    skipped_by_admin: true,
  });
  await db.setOnboardingStep(userId, 'completed');
  await db.setOnboardingCompleted(userId, true);

  await ctx.reply(stubResult);
  await db.ensureVisitCardPublished(userId);
  trackEvent(userId, EVENTS.VISIT_CARD_PUBLISHED, { source: 'admin_skip' });
  await syncUserBotCommands(ctx.telegram, ctx.from?.id, userId);
  await sendPostOnboardingOffer(ctx, userId, { withIntro: true });
}

export async function handleOnboardingText(ctx, userId, text, profile) {
  const step = profile.onboarding_step;

  if (step === 'await_confirm') {
    await ctx.reply(MESSAGES.confirmHint, confirmKeyboard());
    return true;
  }

  if (step === 'calculation_failed') {
    await ctx.reply(MESSAGES.calculationError);
    return true;
  }

  if (step === 'calculating') {
    await ctx.reply(LOADING_PHRASES[LOADING_PHRASES.length - 1]);
    return true;
  }

  if (step === 'await_answer_style') {
    await ctx.reply(MESSAGES.askName);
    await db.setOnboardingStep(userId, 'await_name');
    return true;
  }

  if (step === 'await_name') {
    const name = text.trim();
    if (!name || name.length > 100) {
      await ctx.reply('Напишите имя текстом, пожалуйста.');
      return true;
    }

    await db.setOnboardingStep(userId, 'await_gender', { name });
    await ctx.reply(`Ваше имя: ${name}`);
    await askGender(ctx, userId);
    return true;
  }

  if (step === 'await_gender') {
    await ctx.reply('Выберите пол кнопкой ниже 👇', genderKeyboard());
    return true;
  }

  if (step === 'await_birth_date') {
    const birthDate = parseBirthDate(text);
    if (!birthDate) {
      await ctx.reply('Укажите дату в формате 28.05.1993');
      return true;
    }

    await db.setOnboardingStep(userId, 'await_birth_time', { birth_date: birthDate });
    await ctx.reply(`Дата рождения: ${birthDate}`);
    await askBirthTime(ctx, userId);
    return true;
  }

  if (step === 'await_birth_time') {
    const birthTime = parseBirthTime(text);
    if (!birthTime) {
      await ctx.reply('Укажите время в формате 18:47');
      return true;
    }

    await db.setOnboardingStep(userId, 'await_birth_place', { birth_time: birthTime });
    await ctx.reply(`Время рождения: ${birthTime}`);
    await askBirthPlace(ctx, userId);
    return true;
  }

  if (step === 'await_birth_place') {
    const query = text.trim();
    if (!query || query.length > 120) {
      await ctx.reply('Напишите название города.');
      return true;
    }

    await saveBirthPlaceAndConfirm(ctx, userId, query);
    return true;
  }

  return false;
}

export async function handleOnboardingGender(ctx, userId, gender) {
  const profile = await db.getUserProfile(userId);
  if (!profile || profile.onboarding_step !== 'await_gender') {
    await ctx.answerCbQuery('Сначала укажите имя');
    return;
  }

  const label = GENDER_LABELS[gender];
  if (!label) {
    await ctx.answerCbQuery('Неизвестный вариант');
    return;
  }

  await ctx.answerCbQuery(`Выбрано: ${label}`);
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});

  await db.setOnboardingStep(userId, 'await_birth_date', { gender, gender_label: label });
  await ctx.reply(`Пол: ${label}`);
  await askBirthDate(ctx, userId);
}

export async function handleOnboardingConfirm(ctx, userId, decision) {
  const profile = await db.getUserProfile(userId);
  if (!profile) {
    await ctx.answerCbQuery('Сначала пройдите анкету — /restart');
    return;
  }

  if (profile.onboarding_step === 'calculating') {
    await ctx.answerCbQuery('Расчёт уже идёт — подождите');
    return;
  }

  if (profile.onboarding_step !== 'await_confirm') {
    await ctx.answerCbQuery('Сначала проверьте данные анкеты');
    return;
  }

  await ctx.editMessageReplyMarkup(undefined).catch(() => {});

  if (decision === 'no') {
    await ctx.answerCbQuery('Заполняем заново');
    trackEvent(userId, EVENTS.ONBOARDING_CONFIRM, { decision: 'no' });
    await startOnboarding(ctx, userId);
    return;
  }

  await ctx.answerCbQuery('Начинаем расчёт');
  trackEvent(userId, EVENTS.ONBOARDING_CONFIRM, { decision: 'yes' });
  await db.setOnboardingStep(userId, 'calculating');

  try {
    await runCalculationLoading(ctx, userId);
  } catch (err) {
    console.error('[onboarding] calculation failed:', err?.message ?? err);
    await db.setOnboardingStep(userId, 'calculation_failed').catch(() => {});
    await ctx.reply(MESSAGES.calculationError).catch(() => {});
  }
}
