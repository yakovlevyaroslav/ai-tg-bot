/** Часовой пояс для админки, отчётов и календарных фильтров (по умолчанию — Москва). */
export const APP_TIMEZONE = process.env.APP_TIMEZONE?.trim() || 'Europe/Moscow';

/** Часовой пояс отложенной рассылки — всегда Москва. */
export const BROADCAST_SCHEDULE_TIMEZONE = 'Europe/Moscow';

const DATE_TIME_FORMAT = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: APP_TIMEZONE,
};

export function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleString('ru-RU', DATE_TIME_FORMAT);
}

/** SQL для SET TIME ZONE — экранируем кавычки. */
export function sqlTimeZoneLiteral() {
  return APP_TIMEZONE.replace(/'/g, "''");
}

function getTimeZoneOffsetMs(timeZone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Локальные дата/время в IANA-зоне → Date (UTC-момент). */
export function zonedLocalToDate(year, month, day, hour, minute, second = 0, timeZone = APP_TIMEZONE) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = getTimeZoneOffsetMs(timeZone, new Date(utcGuess));
  const utc2 = utcGuess - offset1;
  const offset2 = getTimeZoneOffsetMs(timeZone, new Date(utc2));
  return new Date(utcGuess - offset2);
}

/**
 * Парсит значение datetime-local («2026-07-20T15:30») как стену в timeZone.
 * @returns {Date|null}
 */
export function parseDateTimeLocalInTimeZone(value, timeZone = BROADCAST_SCHEDULE_TIMEZONE) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);

  if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
    return null;
  }

  return zonedLocalToDate(year, month, day, hour, minute, second, timeZone);
}

/** Для value у input[type=datetime-local] в указанной зоне. */
export function formatDateTimeLocalInput(value, timeZone = BROADCAST_SCHEDULE_TIMEZONE) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
