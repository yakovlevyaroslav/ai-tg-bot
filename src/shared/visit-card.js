import { config } from './config.js';

export const WEB_APP_MENU_TEXT = 'Мой код личности';

export function buildVisitCardPublicUrl(personalityCode) {
  const code = normalizePersonalityCode(personalityCode);
  if (!code) {
    return '';
  }

  const base = config.publicSiteUrl?.replace(/\/$/, '');
  return base ? `${base}/code/${code}` : `/code/${code}`;
}

export function buildOnboardingPageUrl() {
  const base = config.publicSiteUrl?.replace(/\/$/, '');
  return base ? `${base}/onboarding` : '/onboarding';
}

/** Deep link в бота: https://t.me/Bot?start=site-bottom-btn */
export function buildBotStartLink(startParam = '') {
  const base = config.publicBotLink?.replace(/\/$/, '');
  if (!base || base === 'https://t.me') {
    return '';
  }
  const param = String(startParam ?? '').trim();
  if (!param) {
    return base;
  }
  return `${base}?start=${encodeURIComponent(param)}`;
}

/** ?start= для кнопки «Задать вопрос» на публичной визитке */
export const VISIT_CARD_ASK_START_LABEL = 'site-bottom-btn';

/** Web App в Telegram требует HTTPS */
export function canOpenAsWebApp(url) {
  return String(url ?? '').startsWith('https://');
}

/** URL-кнопки inline/reply-клавиатуры — только HTTPS (http://localhost Telegram отклоняет) */
export function canOpenMenuAsUrl(url) {
  return String(url ?? '').startsWith('https://');
}

/** Ссылку можно показать текстом в сообщении (http или https) */
export function isBrowsableUrl(url) {
  const value = String(url ?? '');
  return value.startsWith('https://') || value.startsWith('http://');
}

export function normalizePersonalityCode(value) {
  const code = String(value ?? '').trim();
  return /^\d{10}$/.test(code) ? code : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Убираем персональные данные из текста разбора для публичной страницы */
export function sanitizeVisitCardContent(content, onboardingData = {}) {
  let text = String(content ?? '').trim();
  if (!text) {
    return '';
  }

  const name = onboardingData.name?.trim();
  if (name) {
    text = text.replace(new RegExp(escapeRegExp(name), 'gi'), 'ты');
  }

  const place = onboardingData.birth_place_label || onboardingData.birth_place;
  if (place) {
    text = text.replace(new RegExp(escapeRegExp(String(place)), 'gi'), 'место рождения');
  }

  for (const dateLike of [onboardingData.birth_date, onboardingData.birth_time].filter(Boolean)) {
    text = text.replace(new RegExp(escapeRegExp(String(dateLike)), 'g'), '—');
  }

  return text.trim();
}

export function buildVisitCardCodeBreakdown(data = {}) {
  const items = [
    { label: 'Астрология', value: data.astrology_code },
    { label: 'Human Design', value: data.human_design_code },
    { label: 'Нумерология', value: data.numerology_code },
    { label: 'Сюцай', value: data.sucai_code },
    { label: 'Джойтиш', value: data.jyotish_code },
  ];

  return items.filter((item) => item.value);
}
