/** Часовой пояс для админки, отчётов и календарных фильтров (по умолчанию — Москва). */
export const APP_TIMEZONE = process.env.APP_TIMEZONE?.trim() || 'Europe/Moscow';

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
