/** Команды в ?start= — не записываем как источник привлечения */
export const START_COMMANDS = new Set(['questions']);

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

/** Метка источника из ?start= для сохранения в БД */
export function getAcquirableStartPayload(raw) {
  const payload = normalizeStartPayload(raw);
  if (!payload || isStartCommand(payload)) {
    return '';
  }
  return payload;
}
