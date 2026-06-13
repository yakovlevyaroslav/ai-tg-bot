import { Markup } from 'telegraf';
import { config } from '../shared/config.js';
import * as db from '../shared/db.js';
import { searchBirthPlaces } from '../shared/geocoding.js';
import {
  generatePersonalityCode,
  splitPersonalityCodeReply,
} from './personality-code.js';
import { dismissLegacyReplyKeyboard, dismissReplyKeyboard } from './keyboards.js';
import { sendPostOnboardingOffer } from './post-onboarding.js';
import {
  generateRandomOnboardingData,
  buildAdminSkipCodeMessage,
  enrichOnboardingDataWithCodes,
} from '../shared/onboarding-context.js';
import { getUserErrorMessage } from '../shared/errors.js';
import { buildWelcomeText, WELCOME_MESSAGE_PARSE_MODE } from '../shared/welcome-message.js';

const MESSAGES = {
  askName:
    'Мне нужно немного информации, чтобы определить твой код личности 🔢\n\n' +
    'Для начала скажи своё имя:',
  askGender: 'Выберите пол:',
  askBirthDate: 'А теперь напиши дату рождения в формате 28.05.1993',
  askBirthTime:
    'Напиши время рождения в формате: 18:47\n(если не знаешь точное, напиши примерное):',
  askBirthPlace:
    'И последнее — город или населённый пункт рождения. Например, Москва',
  chooseBirthPlace: 'Выберите населённый пункт из списка:',
  confirmHint: 'Всё верно? Нажмите кнопку ниже 👇',
  thinking:
    '🧠 Сейчас в раздумьях — свожу астрологию, Human Design, нумерологию, Сюцай и ведическую астрологию в единый код личности...',
  calculationError:
    'Не удалось сформировать код личности. Попробуйте ещё раз: нажмите /start и пройдите анкету заново.',
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
const PLACE_BUTTON_MAX = 60;

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

function truncateButtonLabel(label) {
  if (label.length <= PLACE_BUTTON_MAX) {
    return label;
  }
  return `${label.slice(0, PLACE_BUTTON_MAX - 1)}…`;
}

function placeOptionsKeyboard(options) {
  return Markup.inlineKeyboard(
    options.map((place, index) => [
      Markup.button.callback(truncateButtonLabel(place.label), `onboard:place:${index}`),
    ]),
  );
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Да (начинаем расчёт)', 'onboard:confirm:yes')],
    [Markup.button.callback('Нет (заполнить сначала)', 'onboard:confirm:no')],
  ]);
}

function buildSummaryText(data) {
  return [
    'Указаны данные:',
    '',
    `Ваше имя: ${data.name ?? '—'}`,
    `Пол: ${data.gender_label ?? '—'}`,
    `Дата рождения: ${data.birth_date ?? '—'}`,
    `Время рождения: ${data.birth_time ?? '—'}`,
    `Место рождения: ${data.birth_place_label ?? '—'}`,
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
  await ctx.reply(MESSAGES.askBirthPlace, dismissReplyKeyboard());
  await db.setOnboardingStep(userId, 'await_birth_place');
}

async function sendSummaryForConfirm(ctx, userId, data) {
  await delay();
  await ctx.reply(buildSummaryText(data), confirmKeyboard());
  await db.setOnboardingStep(userId, 'await_confirm');
}

async function runCalculationLoading(ctx, userId) {
  for (const [index, phrase] of LOADING_PHRASES.entries()) {
    await ctx.sendChatAction('typing');
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

  let typingActive = true;
  const typingLoop = (async () => {
    while (typingActive) {
      await ctx.sendChatAction('typing');
      await delay(4000);
    }
  })();

  try {
    const result = await generatePersonalityCode(data);
    typingActive = false;
    await typingLoop;

    const chunks = splitPersonalityCodeReply(result.content);

    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }

    await db.setOnboardingStep(userId, 'completed', {
      personality_code: result.codes.fullCode,
      astrology_code: result.codes.astrologyCode,
      human_design_code: result.codes.humanDesignCode,
      numerology_code: result.codes.numerologyCode,
      sucai_code: result.codes.sucaiCode,
      jyotish_code: result.codes.jyotishCode,
      personality_code_result: result.content,
    });
    await db.setOnboardingCompleted(userId, true);
    await sendPostOnboardingOffer(ctx);
  } catch (err) {
    typingActive = false;
    await typingLoop;
    console.error('Personality code error:', err?.message ?? err);
    await db.setOnboardingStep(userId, 'calculation_failed');
    await ctx.reply(getUserErrorMessage(err) || MESSAGES.calculationError);
  }
}

async function presentBirthPlaceOptions(ctx, userId, options) {
  await ctx.reply(MESSAGES.chooseBirthPlace, placeOptionsKeyboard(options));
  await db.setOnboardingStep(userId, 'await_birth_place_choice', {
    place_options: options,
  });
}

async function resolveBirthPlaceInput(ctx, userId, optionsPromise) {
  let options;
  try {
    options = await optionsPromise;
  } catch (err) {
    console.error('Geocoding error:', err?.message ?? err);
    await ctx.reply('Не удалось определить место. Напишите название ещё раз.');
    return;
  }

  if (!options.length) {
    await ctx.reply('Такой населённый пункт не найден. Уточните название.');
    return;
  }

  await presentBirthPlaceOptions(ctx, userId, options);
}

/** Запуск анкеты с /start */
export async function startOnboarding(ctx, userId) {
  await db.resetOnboarding(userId);
  await dismissLegacyReplyKeyboard(ctx);
  await ctx.reply(buildWelcomeText(ctx.from?.id), { parse_mode: WELCOME_MESSAGE_PARSE_MODE });
  await delay();
  await ctx.reply(MESSAGES.askName);
  await db.setOnboardingStep(userId, 'await_name');
}

/** Пропуск анкеты для админа — сразу к финальному этапу */
export async function skipOnboardingForAdmin(ctx, userId) {
  const randomData = enrichOnboardingDataWithCodes(generateRandomOnboardingData());
  const stubResult = buildAdminSkipCodeMessage(randomData);

  await db.setOnboardingStep(userId, 'completed', {
    ...randomData,
    personality_code_result: stubResult,
    skipped_by_admin: true,
  });
  await db.setOnboardingCompleted(userId, true);

  await ctx.reply(stubResult, dismissReplyKeyboard());
  await sendPostOnboardingOffer(ctx);
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

    await resolveBirthPlaceInput(ctx, userId, searchBirthPlaces(query));
    return true;
  }

  if (step === 'await_birth_place_choice') {
    await ctx.reply('Выберите вариант из списка кнопками выше 👆');
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

export async function handleOnboardingPlaceChoice(ctx, userId, index) {
  const profile = await db.getUserProfile(userId);
  if (!profile || profile.onboarding_step !== 'await_birth_place_choice') {
    await ctx.answerCbQuery('Сначала укажите место рождения');
    return;
  }

  const options = profile.onboarding_data?.place_options;
  const place = Array.isArray(options) ? options[Number(index)] : null;

  if (!place) {
    await ctx.answerCbQuery('Вариант устарел — напишите название снова');
    await db.setOnboardingStep(userId, 'await_birth_place');
    await ctx.reply(MESSAGES.askBirthPlace, dismissReplyKeyboard());
    return;
  }

  await ctx.answerCbQuery('Выбрано');
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});

  await db.setOnboardingStep(userId, 'await_confirm', {
    birth_place: place.name,
    birth_place_label: place.label,
    birth_place_lat: place.lat ?? null,
    birth_place_lon: place.lon ?? null,
    place_options: null,
  });

  await ctx.reply(`Выбрано место рождения: ${place.label}`, dismissReplyKeyboard());

  const updated = await db.getUserProfile(userId);
  await sendSummaryForConfirm(ctx, userId, updated.onboarding_data);
}

export async function handleOnboardingConfirm(ctx, userId, decision) {
  const profile = await db.getUserProfile(userId);
  if (!profile || profile.onboarding_step !== 'await_confirm') {
    await ctx.answerCbQuery('Сначала проверьте данные анкеты');
    return;
  }

  await ctx.editMessageReplyMarkup(undefined).catch(() => {});

  if (decision === 'no') {
    await ctx.answerCbQuery('Заполняем заново');
    await startOnboarding(ctx, userId);
    return;
  }

  await ctx.answerCbQuery('Начинаем расчёт');
  await db.setOnboardingStep(userId, 'calculating');
  await runCalculationLoading(ctx, userId);
}
