export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

export function layout(title, activeNav, body) {
  const nav = [
    { href: '/admin', label: 'Обзор', key: 'dashboard' },
    { href: '/admin/analytics', label: 'Воронка', key: 'analytics' },
    { href: '/admin/users', label: 'Пользователи', key: 'users' },
    { href: '/admin/payments', label: 'Оплаты', key: 'payments' },
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
  <link rel="stylesheet" href="/admin/static/admin.css">
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
