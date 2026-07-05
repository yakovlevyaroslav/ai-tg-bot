import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDateTime } from '../../shared/datetime.js';

const ADMIN_CSS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/admin/admin.css',
);

/** Версия по mtime — после деплоя браузер подтянет новый CSS (не залипнет на старом кэше). */
export function adminStylesheetHref() {
  try {
    const { mtimeMs } = statSync(ADMIN_CSS_PATH);
    return `/admin/static/admin.css?v=${Math.floor(mtimeMs)}`;
  } catch {
    return '/admin/static/admin.css';
  }
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDate(value) {
  return formatDateTime(value);
}

export function formatCredits(n) {
  return Number(n).toLocaleString('ru-RU');
}

export function userLabel(user) {
  if (!user) return '—';
  const name = [user.first_name, user.username ? `@${user.username}` : null]
    .filter(Boolean)
    .join(' ');
  return name || `ID ${user.telegram_id}`;
}

/** Имя в таблице пользователей: из анкеты, иначе first_name Telegram */
export function userTableName(user) {
  if (!user) return '—';
  const onboardingName = String(user.onboarding_name ?? '').trim();
  if (onboardingName) {
    return onboardingName;
  }
  const telegramName = String(user.first_name ?? '').trim();
  return telegramName || '—';
}

/** @username в таблице пользователей */
export function userTableAlias(user) {
  if (!user?.username) {
    return '—';
  }
  return `@${user.username}`;
}

/** Метка ?start= в таблице пользователей, если источник неизвестен */
export const ORGANIC_START_LABEL = 'organic';

export function formatStartPayloadLabel(startPayload) {
  const value = String(startPayload ?? '').trim();
  return value || ORGANIC_START_LABEL;
}

/** Поиск пользователей без метки ?start= */
export function isOrganicStartPayloadSearch(term) {
  const normalized = String(term ?? '').trim().toLowerCase();
  return normalized === ORGANIC_START_LABEL || normalized === 'органика';
}

/** Блок полей фильтра с заголовком; `filter` — типы выгрузки через пробел (для show/hide) */
export function exportFilterSection(title, gridHtml, { filter } = {}) {
  const filterAttr = filter ? ` data-filter="${esc(filter)}"` : '';
  return `
    <div class="export-section"${filterAttr}>
      <div class="export-section-title">${esc(title)}</div>
      <div class="export-grid">${gridHtml}</div>
    </div>`;
}

export function layout(title, activeNav, body) {
  const nav = [
    { href: '/admin', label: 'Обзор', key: 'dashboard' },
    { href: '/admin/analytics', label: 'Воронка', key: 'analytics' },
    { href: '/admin/export', label: 'Выгрузка', key: 'export' },
    { href: '/admin/broadcast', label: 'Рассылка', key: 'broadcast' },
    { href: '/admin/users', label: 'Пользователи', key: 'users' },
    { href: '/admin/payments', label: 'Оплаты', key: 'payments' },
    { href: '/admin/visit-cards', label: 'Визитки', key: 'visit-cards' },
  ];

  const navHtml = nav
    .map(
      (item) =>
        `<a href="${item.href}" class="nav-link${activeNav === item.key ? ' active' : ''}">${item.label}</a>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — AI Bot Admin</title>
  <link rel="stylesheet" href="${adminStylesheetHref()}">
</head>
<body>
  <header class="header">
    <div class="header-inner">
      <a href="/admin" class="logo">AI Bot · Админ</a>
      <nav class="nav">${navHtml}</nav>
    </div>
  </header>
  <main class="main">${body}</main>
</body>
</html>`;
}

export function statCard(label, value, hint = '') {
  return `<div class="stat-card">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${esc(value)}</div>
    ${hint ? `<div class="stat-hint">${esc(hint)}</div>` : ''}
  </div>`;
}
