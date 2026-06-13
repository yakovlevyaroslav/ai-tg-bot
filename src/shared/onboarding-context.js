import { computePersonalityCodes } from './personality-code-math.js';

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

function truncateText(text, maxLength = 1800) {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

/** Текстовый блок с данными анкеты для system prompt */
export function buildOnboardingSystemContext(data) {
  if (!data?.name || !data?.birth_date) {
    return '';
  }

  const codes = data.personality_code
    ? {
        fullCode: data.personality_code,
        numerologyCode: data.numerology_code,
        socionicsCode: data.socionics_code,
        synthesisCode: data.synthesis_code,
      }
    : computePersonalityCodes(data);

  const lines = [
    'ДАННЫЕ АНКЕТЫ ПОЛЬЗОВАТЕЛЯ (обязательно используй в ответе):',
    `- Имя: ${data.name}`,
    `- Пол: ${data.gender_label ?? '—'}`,
    `- Дата рождения: ${data.birth_date}`,
    `- Время рождения: ${data.birth_time ?? '—'}`,
    `- Место рождения: ${data.birth_place_label ?? data.birth_place ?? '—'}`,
    `- Код личности: ${codes.fullCode}`,
  ];

  if (codes.numerologyCode) {
    lines.push(`- Нумерологическое число: ${codes.numerologyCode}`);
  }
  if (codes.socionicsCode) {
    lines.push(`- Код соционики: ${codes.socionicsCode}`);
  }
  if (codes.synthesisCode) {
    lines.push(`- Код синтеза: ${codes.synthesisCode}`);
  }

  if (data.personality_code_result) {
    lines.push('', 'РАНЕЕ ВЫДАННЫЙ ПОРТРЕТ КОДА ЛИЧНОСТИ:', truncateText(data.personality_code_result));
  }

  lines.push(
    '',
    'Отвечай персонально этому человеку, опираясь на его анкету и код личности. Обращайся на «ты».',
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
    `${codes.numerologyCode} — нумерологическое число\n` +
    `${codes.socionicsCode} — код соционики\n` +
    `${codes.synthesisCode} — код синтеза\n\n` +
    `Ответы на вопросы будут строиться на этих данных.`
  );
}

export function enrichOnboardingDataWithCodes(data) {
  const codes = computePersonalityCodes(data);
  return {
    ...data,
    personality_code: codes.fullCode,
    numerology_code: codes.numerologyCode,
    socionics_code: codes.socionicsCode,
    synthesis_code: codes.synthesisCode,
  };
}
