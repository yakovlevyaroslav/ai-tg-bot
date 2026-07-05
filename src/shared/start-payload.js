/** Команды в ?start= — не записываем как источник привлечения */
export const START_COMMANDS = new Set(['questions']);

/** Метки ?start= — сохраняем в БД и открываем меню вопросов после анкеты */
export const QUESTIONS_MENU_START_LABELS = new Set(['site-bottom-btn']);

const PAYLOAD_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function normalizeStartPayload(raw) {
  const payload = String(raw ?? '').trim();
  if (!payload || !PAYLOAD_RE.test(payload)) {
    return '';
  }
  return payload;
}

export function isStartCommand(raw) {
  const payload = normalizeStartPayload(raw);
  return payload !== '' && START_COMMANDS.has(payload.toLowerCase());
}

export function opensQuestionsMenuOnStart(raw) {
  const payload = normalizeStartPayload(raw);
  if (!payload) {
    return false;
  }
  const key = payload.toLowerCase();
  return START_COMMANDS.has(key) || QUESTIONS_MENU_START_LABELS.has(key);
}

/** Метка источника из ?start= для сохранения в БД */
export function getAcquirableStartPayload(raw) {
  const payload = normalizeStartPayload(raw);
  if (!payload || isStartCommand(payload)) {
    return '';
  }
  return payload;
}
