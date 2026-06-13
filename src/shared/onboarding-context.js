import { computePersonalityCodes } from './personality-code-math.js';
import { getAnswerStyleLabel } from './answer-style.js';

const RANDOM_NAMES = [
  'Анна',
  'Мария',
  'Елена',
  'Ольга',
  'Дмитрий',
  'Алексей',
  'Иван',
  'Сергей',
  'Наталья',
  'Виктория',
  'Павел',
  'Кирилл',
];

const RANDOM_CITIES = [
  { place: 'Москва', label: 'Москва, Россия', lat: 55.7558, lon: 37.6173 },
  { place: 'Санкт-Петербург', label: 'Санкт-Петербург, Россия', lat: 59.9343, lon: 30.3351 },
  { place: 'Казань', label: 'Казань, Россия', lat: 55.8304, lon: 49.0661 },
  { place: 'Новосибирск', label: 'Новосибирск, Россия', lat: 55.0084, lon: 82.9357 },
  { place: 'Екатеринбург', label: 'Екатеринбург, Россия', lat: 56.8389, lon: 60.6057 },
  { place: 'Краснодар', label: 'Краснодар, Россия', lat: 45.0355, lon: 38.9753 },
  { place: 'Сочи', label: 'Сочи, Россия', lat: 43.6028, lon: 39.7342 },
  { place: 'Томск', label: 'Томск, Россия', lat: 56.4846, lon: 84.9482 },
];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

/** Случайная анкета для пропуска онбординга админом */
export function generateRandomOnboardingData() {
  const gender = Math.random() < 0.5 ? 'male' : 'female';
  const gender_label = gender === 'male' ? 'Мужской' : 'Женский';
  const year = 1975 + Math.floor(Math.random() * 31);
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  const hour = Math.floor(Math.random() * 24);
  const minute = Math.floor(Math.random() * 60);
  const city = pickRandom(RANDOM_CITIES);

  return {
    name: pickRandom(RANDOM_NAMES),
    gender,
    gender_label,
    birth_date: `${pad2(day)}.${pad2(month)}.${year}`,
    birth_time: `${pad2(hour)}:${pad2(minute)}`,
    birth_place: city.place,
    birth_place_label: city.label,
    birth_place_lat: city.lat,
    birth_place_lon: city.lon,
  };
}

function truncateText(text, maxLength = 3500) {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

/** Префикс, который бот показывает пользователю перед ответом нейросети */
export function buildAnswerIntroPrefix(data) {
  if (!data?.personality_code) {
    return '';
  }

  return `✨ Основываясь на твоём коде личности № <b>${data.personality_code}</b>:\n\n`;
}

/** Текстовый блок с данными анкеты для system prompt */
export function buildOnboardingSystemContext(data) {
  if (!data?.name || !data?.birth_date) {
    return '';
  }

  const computed = computePersonalityCodes(data);
  const codes = data.personality_code
    ? {
        fullCode: data.personality_code,
        astrologyCode: data.astrology_code ?? computed.astrologyCode,
        humanDesignCode: data.human_design_code ?? computed.humanDesignCode,
        numerologyCode: data.numerology_code ?? computed.numerologyCode,
        sucaiCode: data.sucai_code ?? computed.sucaiCode,
        jyotishCode: data.jyotish_code ?? computed.jyotishCode,
      }
    : computed;

  const lines = [
    'ДАННЫЕ АНКЕТЫ ПОЛЬЗОВАТЕЛЯ (обязательно используй в ответе):',
    `- Имя: ${data.name}`,
    `- Пол: ${data.gender_label ?? '—'}`,
    `- Дата рождения: ${data.birth_date}`,
    `- Время рождения: ${data.birth_time ?? '—'}`,
    `- Место рождения: ${data.birth_place_label ?? data.birth_place ?? '—'}`,
    `- Код личности: ${codes.fullCode}`,
    '- Направления кода: астрология, Human Design, нумерология, Сюцай, ведическая астрология (Джойтиш)',
  ];

  if (data.answer_style) {
    lines.push(`- Стиль ответов: ${getAnswerStyleLabel(data.answer_style)}`);
  }

  if (codes.astrologyCode) {
    lines.push(`- Код астрологии: ${codes.astrologyCode}`);
  }
  if (codes.humanDesignCode) {
    lines.push(`- Код Human Design: ${codes.humanDesignCode}`);
  }
  if (codes.numerologyCode) {
    lines.push(`- Нумерологическое число: ${codes.numerologyCode}`);
  }
  if (codes.sucaiCode) {
    lines.push(`- Код Сюцай: ${codes.sucaiCode}`);
  }
  if (codes.jyotishCode) {
    lines.push(`- Код Джойтиш: ${codes.jyotishCode}`);
  }

  if (data.personality_code_result) {
    lines.push(
      '',
      'БАЗОВЫЙ РАЗБОР КОДА ЛИЧНОСТИ (обязательная основа для всех ответов на вопросы):',
      truncateText(data.personality_code_result),
    );
  }

  lines.push(
    '',
    'Все ответы на вопросы пользователя строй исключительно на базовом разборе и данных анкеты выше.',
    'Если вопрос касается предназначения, отношений, работы или роста — выводи логику из портрета и кодов, а не из общих шаблонов.',
    'Пиши тепло и живо, не сухо: HTML-оформление (<b>акценты</b>), короткие абзацы, 3–6 эмодзи на ответ.',
    'Обращайся на «ты».',
  );

  return lines.join('\n');
}

export function buildAdminSkipCodeMessage(data) {
  const codes = computePersonalityCodes(data);

  return (
    `Твой Код личности № ${codes.fullCode}\n\n` +
    `Тестовые данные (случайная анкета для админа):\n` +
    `Имя: ${data.name} · ${data.gender_label}\n` +
    `Рождение: ${data.birth_date} ${data.birth_time}\n` +
    `Место: ${data.birth_place_label}\n\n` +
    `${codes.astrologyCode} — астрология\n` +
    `${codes.humanDesignCode} — Human Design\n` +
    `${codes.numerologyCode} — нумерология\n` +
    `${codes.sucaiCode} — Сюцай\n` +
    `${codes.jyotishCode} — ведическая астрология (Джойтиш)\n\n` +
    `Ответы на вопросы будут строиться на этих данных.`
  );
}

export function enrichOnboardingDataWithCodes(data) {
  const codes = computePersonalityCodes(data);
  return {
    ...data,
    personality_code: codes.fullCode,
    astrology_code: codes.astrologyCode,
    human_design_code: codes.humanDesignCode,
    numerology_code: codes.numerologyCode,
    sucai_code: codes.sucaiCode,
    jyotish_code: codes.jyotishCode,
  };
}
