import express, { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as billing from '../../shared/billing.js';
import { InsufficientCreditsError } from '../../shared/billing.js';
import { config } from '../../shared/config.js';
import * as queries from './queries.js';
import * as analyticsQueries from './analytics-queries.js';
import * as visitCardQueries from './visit-card-queries.js';
import {
  publishVisitCardByCode,
  unpublishVisitCard,
  VisitCardAdminError,
} from '../../shared/db.js';
import { buildVisitCardPublicUrl, normalizePersonalityCode } from '../../shared/visit-card.js';
import { formatPackagesLine } from '../../shared/pricing.js';
import { formatRequests } from '../../shared/requests-format.js';
import * as exportQueries from './export-queries.js';
import { buildCsv, csvFilename } from './csv.js';
import {
  esc,
  formatDate,
  formatCredits,
  layout,
  statCard,
  userLabel,
} from './html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, '../../../public/admin');

const TX_LABELS = {
  bonus: 'Бонус',
  spend: 'Списание',
  refund: 'Возврат',
  grant: 'Начисление',
  purchase: 'Покупка',
};

function flashMessage(query) {
  if (query.ok === 'grant') {
    return `<div class="flash flash-success">Начислено. Осталось: ${esc(formatRequests(query.balance))}</div>`;
  }
  if (query.ok === 'deduct') {
    return `<div class="flash flash-success">Списано. Осталось: ${esc(formatRequests(query.balance))}</div>`;
  }
  if (query.ok === 'set') {
    return `<div class="flash flash-success">Баланс установлен: ${esc(formatRequests(query.balance))}</div>`;
  }
  if (query.ok === 'deleted') {
    return `<div class="flash flash-success">Пользователь удалён.</div>`;
  }
  if (query.ok === 'published') {
    const url = query.code ? buildVisitCardPublicUrl(query.code) : '';
    return `<div class="flash flash-success">Визитка опубликована${url ? `: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` : ''}.</div>`;
  }
  if (query.ok === 'unpublished') {
    return `<div class="flash flash-success">Визитка снята с публикации.</div>`;
  }
  if (query.error) {
    return `<div class="flash flash-error">${esc(query.error)}</div>`;
  }
  return '';
}

function isProtectedAdminUser(user) {
  return config.adminTelegramIds.includes(Number(user.telegram_id));
}

function funnelRows(rows) {
  if (!rows.length) {
    return `<tr><td colspan="4" class="empty">Пока нет данных — события появятся после активности пользователей</td></tr>`;
  }

  return rows
    .map((row, index) => {
      const conv =
        index === 0 ? '—' : `${row.conversion}%`;
      return `<tr>
        <td>${esc(row.label)}</td>
        <td><strong>${esc(row.users)}</strong></td>
        <td>${esc(conv)}</td>
        <td><code>${esc(row.event)}${row.step ? ` · ${row.step}` : ''}</code></td>
      </tr>`;
    })
    .join('');
}

function periodLinks(currentDays) {
  const options = [
    { days: 7, label: '7 дней' },
    { days: 30, label: '30 дней' },
    { days: 0, label: 'Всё время' },
  ];

  return options
    .map(({ days, label }) => {
      const active = currentDays === days ? ' btn' : ' btn btn-ghost';
      return `<a href="/admin/analytics?days=${days}" class="${active.trim()}">${label}</a>`;
    })
    .join(' ');
}

function exportPeriodOptions(current) {
  return [
    { value: 7, label: '7 дней' },
    { value: 30, label: '30 дней' },
    { value: 90, label: '90 дней' },
    { value: 0, label: 'Всё время' },
  ]
    .map(({ value, label }) => {
      const selected = Number(current) === value ? ' selected' : '';
      return `<option value="${value}"${selected}>${label}</option>`;
    })
    .join('');
}

function exportSelect(name, options, current = '') {
  return `<select name="${name}" id="${name}" class="export-select">
    ${options
      .map(({ value, label }) => {
        const selected = String(current) === String(value) ? ' selected' : '';
        return `<option value="${esc(value)}"${selected}>${esc(label)}</option>`;
      })
      .join('')}
  </select>`;
}

function exportTypeOptions(current) {
  return Object.entries(exportQueries.EXPORT_TYPES)
    .map(([value, meta]) => {
      const selected = current === value ? ' selected' : '';
      return `<option value="${esc(value)}"${selected}>${esc(meta.label)}</option>`;
    })
    .join('');
}

function buildExportQueryString(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== '') {
      params.set(key, String(value).trim());
    }
  }
  return params.toString();
}

export function createAdminRouter() {
  const router = Router();

  // express.static надёжнее ручного sendFile (меньше ложных 404 при перезапуске)
  router.use(
    '/static',
    express.static(staticDir, {
      maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
      fallthrough: false,
    }),
  );

  router.use((req, res, next) => {
    if (req.method !== 'GET' || !req.originalUrl.endsWith('/')) {
      next();
      return;
    }
    const base = req.originalUrl.split('?')[0];
    if (base.length > 1 && base.endsWith('/')) {
      const query = req.originalUrl.includes('?') ? `?${req.originalUrl.split('?')[1]}` : '';
      res.redirect(301, base.slice(0, -1) + query);
      return;
    }
    next();
  });

  router.get('/', async (req, res) => {
    const stats = await queries.getDashboardStats();
    const recent = await queries.listRecentCompletedPayments(8);

    const paymentRows = recent.length
      ? recent
          .map(
            (p) => `<tr>
          <td>${formatDate(p.completed_at || p.created_at)}</td>
          <td><a href="/admin/users/${p.user_id}">${esc(userLabel(p))}</a></td>
          <td>${esc(p.rub_amount)} ₽ → ${esc(formatRequests(p.credits_amount))}</td>
          <td><code>${esc(p.payment_code)}</code></td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="4" class="empty">Пока нет успешных оплат</td></tr>`;

    const body = `
      ${flashMessage(req.query)}
      <h1 class="page-title">Обзор</h1>
      <p class="page-subtitle">AI_PROVIDER: ${esc(config.aiProvider)} · ${esc(formatRequests(config.requestsPerMessage))} за ответ · оплата через ЮKassa</p>
      <div class="stats-grid">
        ${statCard('Пользователей', stats.users_count)}
        ${statCard('Вопросов в системе', formatCredits(stats.total_credits))}
        ${statCard('Оплат за 24ч', stats.purchases_24h, `${formatCredits(stats.revenue_rub_24h)} ₽`)}
        ${statCard('Сообщений за 24ч', stats.messages_24h)}
        ${statCard('Запросов AI за 24ч', stats.requests_24h)}
        ${statCard('Транзакций за 24ч', stats.transactions_24h)}
      </div>
      <div class="card">
        <div class="card-header">Последние оплаты</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Дата</th><th>Пользователь</th><th>Сумма</th><th>Код</th></tr>
            </thead>
            <tbody>${paymentRows}</tbody>
          </table>
        </div>
        <p style="padding:0.75rem 1rem;margin:0">
          <a href="/admin/payments">Вся история оплат →</a>
          ·
          <a href="/admin/analytics">Воронка и отвалы →</a>
          ·
          <a href="/admin/export">Выгрузка метрик →</a>
          ·
          <a href="/admin/visit-cards">Визитки →</a>
        </p>
      </div>
    `;

    res.type('html').send(layout('Обзор', 'dashboard', body));
  });

  router.get('/users', async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const search = String(req.query.search || '');
    const { users, total, pages } = await queries.listUsers({ page, search });

    const rows = users.length
      ? users
          .map(
            (u) => `<tr>
          <td><a href="/admin/users/${u.id}">#${u.id}</a></td>
          <td><code>${esc(u.telegram_id)}</code></td>
          <td>${esc(userLabel(u))}</td>
          <td>${esc(u.personality_code || '—')}</td>
          <td><strong>${formatCredits(u.credits)}</strong></td>
          <td>${esc(u.messages_count)}</td>
          <td>${u.welcome_bonus_granted ? '<span class="badge badge-success">да</span>' : '<span class="badge badge-muted">нет</span>'}</td>
          <td>${formatDate(u.created_at)}</td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="8" class="empty">Пользователи не найдены</td></tr>`;

    const prev = page > 1 ? `/admin/users?page=${page - 1}&search=${encodeURIComponent(search)}` : null;
    const next = page < pages ? `/admin/users?page=${page + 1}&search=${encodeURIComponent(search)}` : null;

    const body = `
      ${flashMessage(req.query)}
      <h1 class="page-title">Пользователи</h1>
      <p class="page-subtitle">Всего: ${total}</p>
      <form class="toolbar" method="get" action="/admin/users">
        <input type="search" name="search" placeholder="ID, telegram, username, имя…" value="${esc(search)}" style="min-width:240px">
        <button type="submit" class="btn">Найти</button>
        ${search ? `<a href="/admin/users" class="btn btn-ghost">Сбросить</a>` : ''}
      </form>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Telegram</th><th>Имя</th><th>Код личности</th><th>Вопросов</th>
                <th>Сообщ.</th><th>Бонус</th><th>Регистрация</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
      <div class="pagination">
        ${prev ? `<a href="${prev}" class="btn btn-ghost btn-sm">← Назад</a>` : ''}
        <span>Стр. ${page} из ${pages}</span>
        ${next ? `<a href="${next}" class="btn btn-ghost btn-sm">Вперёд →</a>` : ''}
      </div>
    `;

    res.type('html').send(layout('Пользователи', 'users', body));
  });

  router.get('/users/:id', async (req, res) => {
    const userId = Number(req.params.id);
    const user = await queries.getUserById(userId);

    if (!user) {
      res.status(404).type('html').send(layout('Не найден', 'users', '<p class="empty">Пользователь не найден</p>'));
      return;
    }

    const transactions = await queries.getUserTransactions(userId);
    const usage = await queries.getUserUsage(userId);
    const pageFlash = req.query.error || req.query.ok ? flashMessage(req.query) : '';
    const canDelete = !isProtectedAdminUser(user);

    const txRows = transactions.length
      ? transactions
          .map((t) => {
            const cls = Number(t.amount) >= 0 ? 'amount-plus' : 'amount-minus';
            const sign = Number(t.amount) >= 0 ? '+' : '';
            return `<tr>
            <td>${formatDate(t.created_at)}</td>
            <td><span class="badge badge-muted">${esc(TX_LABELS[t.type] || t.type)}</span></td>
            <td class="${cls}">${sign}${formatCredits(t.amount)}</td>
          </tr>`;
          })
          .join('')
      : `<tr><td colspan="3" class="empty">Нет транзакций</td></tr>`;

    const usageRows = usage.length
      ? usage
          .map(
            (u) => `<tr>
            <td>${formatDate(u.created_at)}</td>
            <td>${esc(u.model || '—')}</td>
            <td>${esc(u.prompt_tokens)} / ${esc(u.completion_tokens)}</td>
            <td>−${formatCredits(u.credits_charged)} вопр.</td>
          </tr>`,
          )
          .join('')
      : `<tr><td colspan="4" class="empty">Нет запросов к AI</td></tr>`;

    const body = `
      ${pageFlash}
      <p><a href="/admin/users">← Все пользователи</a></p>
      <h1 class="page-title">${esc(userLabel(user))}</h1>
      <p class="page-subtitle">Telegram ID: <code>${esc(user.telegram_id)}</code> · внутр. ID: #${user.id}</p>

      <div class="detail-grid">
        <div class="detail-item"><label>Код личности</label><span>${esc(user.personality_code || '—')}</span></div>
        <div class="detail-item"><label>Осталось вопросов</label><span>${formatCredits(user.credits)}</span></div>
        <div class="detail-item"><label>Сообщений</label><span>${esc(user.messages_count)}</span></div>
        <div class="detail-item"><label>Регистрация</label><span>${formatDate(user.created_at)}</span></div>
        <div class="detail-item"><label>Стартовый бонус</label><span>${user.welcome_bonus_granted ? 'получен' : 'нет'}</span></div>
      </div>

      <div class="card">
        <div class="card-header">Управление балансом</div>
        <div class="balance-actions">
          <form method="post" action="/admin/users/${user.id}/grant" class="balance-form">
            <span class="balance-form-label">+ Начислить</span>
            <input type="number" name="amount" min="1" placeholder="Кол-во" required>
            <button type="submit" class="btn btn-success btn-sm">Начислить</button>
          </form>
          <form method="post" action="/admin/users/${user.id}/deduct" class="balance-form">
            <span class="balance-form-label">− Списать</span>
            <input type="number" name="amount" min="1" placeholder="Кол-во" required>
            <button type="submit" class="btn btn-sm">Списать</button>
          </form>
          <form method="post" action="/admin/users/${user.id}/set-balance" class="balance-form">
            <span class="balance-form-label">= Установить</span>
            <input type="number" name="balance" min="0" placeholder="Новый баланс" required>
            <button type="submit" class="btn btn-sm">Установить</button>
          </form>
        </div>
      </div>

      <div class="card card-danger">
        <div class="card-header">Удаление пользователя</div>
        <div style="padding:1rem">
          ${
            canDelete
              ? `<p class="muted-text">Будут удалены все данные: баланс, сообщения, история, платежи.</p>
          <form method="post" action="/admin/users/${user.id}/delete"
                onsubmit="return confirm('Удалить пользователя и все его данные? Это необратимо.');">
            <button type="submit" class="btn btn-danger btn-sm">Удалить пользователя</button>
          </form>`
              : `<p class="muted-text">Этот пользователь в ADMIN_TELEGRAM_IDS — удаление запрещено.</p>`
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header">История транзакций</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Дата</th><th>Тип</th><th>Сумма</th></tr></thead>
            <tbody>${txRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Запросы к AI (последние)</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Дата</th><th>Модель</th><th>Токены in/out</th><th>Списано</th></tr></thead>
            <tbody>${usageRows}</tbody>
          </table>
        </div>
      </div>
    `;

    res.type('html').send(layout(userLabel(user), 'users', body));
  });

  router.post('/users/:id/grant', async (req, res) => {
    const userId = Number(req.params.id);
    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      res.redirect(`/admin/users/${userId}?error=${encodeURIComponent('Укажите положительное число')}`);
      return;
    }

    const user = await queries.getUserById(userId);
    if (!user) {
      res.redirect('/admin/users?error=' + encodeURIComponent('Пользователь не найден'));
      return;
    }

    const result = await billing.grant(userId, amount, 'grant', { source: 'admin_web' });
    res.redirect(`/admin/users/${userId}?ok=grant&balance=${result.balanceAfter}`);
  });

  router.post('/users/:id/deduct', async (req, res) => {
    const userId = Number(req.params.id);
    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      res.redirect(`/admin/users/${userId}?error=${encodeURIComponent('Укажите положительное число')}`);
      return;
    }

    const user = await queries.getUserById(userId);
    if (!user) {
      res.redirect('/admin/users?error=' + encodeURIComponent('Пользователь не найден'));
      return;
    }

    try {
      const result = await billing.adminDeduct(userId, amount);
      res.redirect(`/admin/users/${userId}?ok=deduct&balance=${result.balanceAfter}`);
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        res.redirect(
          `/admin/users/${userId}?error=${encodeURIComponent(
            `Недостаточно вопросов: есть ${err.balance}, нужно списать ${err.required}`,
          )}`,
        );
        return;
      }
      throw err;
    }
  });

  router.post('/users/:id/set-balance', async (req, res) => {
    const userId = Number(req.params.id);
    const balance = Number(req.body.balance);

    if (!Number.isFinite(balance) || balance < 0) {
      res.redirect(`/admin/users/${userId}?error=${encodeURIComponent('Баланс не может быть отрицательным')}`);
      return;
    }

    const user = await queries.getUserById(userId);
    if (!user) {
      res.redirect('/admin/users?error=' + encodeURIComponent('Пользователь не найден'));
      return;
    }

    const result = await billing.setBalance(userId, balance);
    res.redirect(`/admin/users/${userId}?ok=set&balance=${result.balanceAfter}`);
  });

  router.post('/users/:id/delete', async (req, res) => {
    const userId = Number(req.params.id);
    const user = await queries.getUserById(userId);

    if (!user) {
      res.redirect('/admin/users?error=' + encodeURIComponent('Пользователь не найден'));
      return;
    }

    if (isProtectedAdminUser(user)) {
      res.redirect(
        `/admin/users/${userId}?error=${encodeURIComponent('Нельзя удалить пользователя из ADMIN_TELEGRAM_IDS')}`,
      );
      return;
    }

    await queries.deleteUserById(userId);
    res.redirect('/admin/users?ok=deleted');
  });

  router.get('/payments', async (req, res) => {
    const completed = await queries.listPaymentsByStatus('completed', 50);
    const incomplete = await queries.listIncompletePayments(20);

    const completedRows = completed.length
      ? completed
          .map(
            (p) => `<tr>
              <td>${formatDate(p.completed_at || p.created_at)}</td>
              <td><a href="/admin/users/${p.user_id}">${esc(userLabel(p))}</a></td>
              <td>${esc(p.rub_amount)} ₽</td>
              <td>${formatCredits(p.credits_amount)}</td>
              <td><code>${esc(p.payment_code)}</code></td>
            </tr>`,
          )
          .join('')
      : `<tr><td colspan="5" class="empty">Пока нет успешных оплат</td></tr>`;

    const incompleteBlock = incomplete.length
      ? `<div class="card">
        <div class="card-header">Не завершены (${incomplete.length})</div>
        <p class="muted-text" style="padding:0 1rem">Пользователь открыл оплату, но не завершил её на стороне ЮKassa.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Создана</th><th>Пользователь</th><th>₽</th><th>Вопросов</th><th>Код</th></tr>
            </thead>
            <tbody>${incomplete
              .map(
                (p) => `<tr>
              <td>${formatDate(p.created_at)}</td>
              <td><a href="/admin/users/${p.user_id}">${esc(userLabel(p))}</a></td>
              <td>${esc(p.rub_amount)} ₽</td>
              <td>${formatCredits(p.credits_amount)}</td>
              <td><code>${esc(p.payment_code)}</code></td>
            </tr>`,
              )
              .join('')}</tbody>
          </table>
        </div>
      </div>`
      : '';

    const body = `
      ${flashMessage(req.query)}
      <h1 class="page-title">Оплаты</h1>
      <p class="page-subtitle">Автоначисление через ЮKassa · ${esc(formatPackagesLine().replace(/\n/g, ' · '))}</p>
      <div class="card">
        <div class="card-header">Успешные оплаты (${completed.length})</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Дата</th><th>Пользователь</th><th>₽</th><th>Вопросов</th><th>Код</th></tr>
            </thead>
            <tbody>${completedRows}</tbody>
          </table>
        </div>
      </div>
      ${incompleteBlock}
    `;

    res.type('html').send(layout('Оплаты', 'payments', body));
  });

  router.get('/visit-cards', async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const search = String(req.query.search || '');
    const [{ visitCards, total, pages }, publishedTotal] = await Promise.all([
      visitCardQueries.listPublishedVisitCards({ page, search }),
      visitCardQueries.countPublishedVisitCards(),
    ]);

    const rows = visitCards.length
      ? visitCards
          .map((card) => {
            const url = buildVisitCardPublicUrl(card.personality_code);
            return `<tr>
          <td><code>${esc(card.personality_code)}</code></td>
          <td><a href="/admin/users/${card.id}">${esc(userLabel(card))}</a></td>
          <td>${formatDate(card.visit_card_published_at)}</td>
          <td>${card.content_length > 0 ? `${esc(card.content_length)} симв.` : '<span class="badge badge-muted">пусто</span>'}</td>
          <td><a href="${esc(url)}" target="_blank" rel="noopener">Открыть</a></td>
          <td>
            <form method="post" action="/admin/visit-cards/${card.id}/unpublish" style="display:inline"
                  onsubmit="return confirm('Снять визитку ${esc(card.personality_code)} с публикации?');">
              <button type="submit" class="btn btn-danger btn-sm">Удалить</button>
            </form>
          </td>
        </tr>`;
          })
          .join('')
      : `<tr><td colspan="6" class="empty">Опубликованных визиток пока нет</td></tr>`;

    const prev =
      page > 1 ? `/admin/visit-cards?page=${page - 1}&search=${encodeURIComponent(search)}` : null;
    const next =
      page < pages ? `/admin/visit-cards?page=${page + 1}&search=${encodeURIComponent(search)}` : null;

    const body = `
      ${flashMessage(req.query)}
      <h1 class="page-title">Визитки</h1>
      <p class="page-subtitle">Опубликовано: ${publishedTotal} · данные берутся из профиля пользователя по коду личности</p>

      <div class="card" style="margin-bottom:1rem">
        <div class="card-header">Опубликовать визитку по коду</div>
        <div style="padding:1rem">
          <p class="muted-text" style="margin-bottom:0.75rem">
            Укажите 10-значный код личности. Если пользователь есть в базе и у него есть разбор —
            визитка будет создана из его данных (имя и дата рождения на странице не показываются).
          </p>
          <form method="post" action="/admin/visit-cards/publish" class="toolbar">
            <input
              type="text"
              name="personality_code"
              inputmode="numeric"
              pattern="\\d{10}"
              maxlength="10"
              placeholder="1234567890"
              required
              style="min-width:180px;font-family:monospace"
            >
            <button type="submit" class="btn btn-success">Опубликовать</button>
          </form>
        </div>
      </div>

      <form class="toolbar" method="get" action="/admin/visit-cards">
        <input type="search" name="search" placeholder="Код, ID, telegram, имя…" value="${esc(search)}" style="min-width:240px">
        <button type="submit" class="btn">Найти</button>
        ${search ? `<a href="/admin/visit-cards" class="btn btn-ghost">Сбросить</a>` : ''}
      </form>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Код</th><th>Пользователь</th><th>Опубликована</th><th>Контент</th><th>Страница</th><th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
      <div class="pagination">
        ${prev ? `<a href="${prev}" class="btn btn-ghost btn-sm">← Назад</a>` : ''}
        <span>Стр. ${page} из ${pages}${search ? ` · найдено: ${total}` : ''}</span>
        ${next ? `<a href="${next}" class="btn btn-ghost btn-sm">Вперёд →</a>` : ''}
      </div>
    `;

    res.type('html').send(layout('Визитки', 'visit-cards', body));
  });

  router.post('/visit-cards/publish', async (req, res) => {
    const code = normalizePersonalityCode(req.body.personality_code);

    if (!code) {
      res.redirect(
        `/admin/visit-cards?error=${encodeURIComponent('Код личности должен содержать 10 цифр')}`,
      );
      return;
    }

    try {
      const result = await publishVisitCardByCode(code);
      res.redirect(
        `/admin/visit-cards?ok=published&code=${encodeURIComponent(result.personalityCode)}`,
      );
    } catch (err) {
      const message =
        err instanceof VisitCardAdminError
          ? err.message
          : err?.code === 'PERSONALITY_CODE_CONFLICT'
            ? 'Этот код личности уже закреплён за другим пользователем'
            : err?.message ?? 'Не удалось опубликовать визитку';
      res.redirect(`/admin/visit-cards?error=${encodeURIComponent(message)}`);
    }
  });

  router.post('/visit-cards/:userId/unpublish', async (req, res) => {
    const userId = Number(req.params.userId);
    const card = await visitCardQueries.getVisitCardByUserId(userId);

    if (!card) {
      res.redirect('/admin/visit-cards?error=' + encodeURIComponent('Визитка не найдена'));
      return;
    }

    await unpublishVisitCard(userId);
    res.redirect('/admin/visit-cards?ok=unpublished');
  });

  router.get('/analytics', async (req, res) => {
    const daysRaw = Number(req.query.days);
    const days = daysRaw === 0 ? 0 : [7, 30].includes(daysRaw) ? daysRaw : 30;

    const [summary, onboardingFunnel, paymentFunnel, stuckUsers, recentEvents] =
      await Promise.all([
        analyticsQueries.getAnalyticsSummary(days),
        analyticsQueries.getOnboardingFunnel(days),
        analyticsQueries.getPaymentFunnel(days),
        analyticsQueries.getStuckOnboardingUsers({ hours: 24, limit: 20 }),
        analyticsQueries.getRecentAnalyticsEvents(25),
      ]);

    const stuckRows = stuckUsers.length
      ? stuckUsers
          .map(
            (u) => `<tr>
          <td><a href="/admin/users/${u.id}">#${u.id}</a></td>
          <td>${esc(userLabel(u))}</td>
          <td><code>${esc(u.onboarding_step)}</code></td>
          <td>${formatDate(u.last_activity)}</td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="4" class="empty">Застрявших пользователей нет</td></tr>`;

    const recentRows = recentEvents.length
      ? recentEvents
          .map(
            (e) => `<tr>
          <td>${formatDate(e.created_at)}</td>
          <td><a href="/admin/users/${e.user_id}">${esc(userLabel(e))}</a></td>
          <td><code>${esc(e.event_name)}</code></td>
          <td>${esc(e.step || '—')}</td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="4" class="empty">Событий пока нет</td></tr>`;

    const periodLabel = days === 0 ? 'за всё время' : `за ${days} дн.`;

    const body = `
      <h1 class="page-title">Воронка</h1>
      <p class="page-subtitle">
        ${esc(periodLabel)} · событий: ${esc(summary.events_total)} · активных пользователей: ${esc(summary.active_users)}
        · админы исключены из статистики
      </p>
      <div class="toolbar">${periodLinks(days)} · <a href="/admin/export?type=funnel_onboarding&period=${days}" class="btn btn-ghost btn-sm">Скачать воронку CSV</a></div>

      <div class="card" style="margin-bottom:1rem">
        <div class="card-header">Анкета и первый вопрос</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Шаг</th><th>Пользователей</th><th>Конверсия</th><th>Событие</th></tr>
            </thead>
            <tbody>${funnelRows(onboardingFunnel)}</tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-bottom:1rem">
        <div class="card-header">Оплата</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Шаг</th><th>Пользователей</th><th>Конверсия</th><th>Событие</th></tr>
            </thead>
            <tbody>${funnelRows(paymentFunnel)}</tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-bottom:1rem">
        <div class="card-header">Застряли в анкете (&gt; 24 ч без активности)</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>ID</th><th>Пользователь</th><th>Шаг</th><th>Последняя активность</th></tr>
            </thead>
            <tbody>${stuckRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">Последние события</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Дата</th><th>Пользователь</th><th>Событие</th><th>Шаг</th></tr>
            </thead>
            <tbody>${recentRows}</tbody>
          </table>
        </div>
      </div>
    `;

    res.type('html').send(layout('Воронка', 'analytics', body));
  });

  router.get('/export', async (req, res) => {
    const filters = exportQueries.parseExportFilters(req.query);
    const [models, eventSteps] = await Promise.all([
      exportQueries.listDistinctModels(),
      exportQueries.listDistinctEventSteps(),
    ]);

    const typeMeta = exportQueries.EXPORT_TYPES[filters.type];
    const downloadQs = buildExportQueryString(req.query);
    const eventOptions = [
      { value: '', label: 'Все события' },
      ...exportQueries.EVENT_NAME_OPTIONS.map((name) => ({ value: name, label: name })),
    ];
    const stepOptions = [
      { value: '', label: 'Любой шаг' },
      ...eventSteps.map((step) => ({ value: step, label: step })),
    ];
    const modelOptions = [
      { value: '', label: 'Все модели' },
      ...models.map((model) => ({ value: model, label: model })),
    ];

    const body = `
      <h1 class="page-title">Выгрузка метрик</h1>
      <p class="page-subtitle">
        CSV с UTF-8 для Excel · до 50 000 строк · ${esc(typeMeta.description)}
      </p>

      <div class="card">
        <div class="card-header">Параметры выгрузки</div>
        <form class="export-form" method="get" action="/admin/export/download" id="export-form">
          <div class="export-grid">
            <label class="export-field export-field-wide">
              <span>Тип данных</span>
              <select name="type" id="export-type" class="export-select">${exportTypeOptions(filters.type)}</select>
            </label>

            <label class="export-field">
              <span>Период</span>
              <select name="period" class="export-select">${exportPeriodOptions(filters.days ?? 30)}</select>
            </label>

            <label class="export-field">
              <span>Дата с</span>
              <input type="date" name="date_from" value="${esc(filters.dateFrom ?? '')}">
            </label>

            <label class="export-field">
              <span>Дата по</span>
              <input type="date" name="date_to" value="${esc(filters.dateTo ?? '')}">
            </label>

            <label class="export-field export-field-check">
              <input type="checkbox" name="exclude_admins" value="1"${filters.excludeAdmins ? ' checked' : ''}>
              <span>Исключить ADMIN_TELEGRAM_IDS</span>
            </label>

            <label class="export-field" data-filter="users visit_cards">
              <span>Поиск</span>
              <input type="search" name="search" value="${esc(filters.search)}" placeholder="ID, telegram, имя, код…">
            </label>

            <label class="export-field" data-filter="users">
              <span>Анкета завершена</span>
              ${exportSelect('onboarding', [
                { value: '', label: 'Все' },
                { value: 'yes', label: 'Да' },
                { value: 'no', label: 'Нет' },
              ], filters.onboarding)}
            </label>

            <label class="export-field" data-filter="users">
              <span>Есть код личности</span>
              ${exportSelect('has_code', [
                { value: '', label: 'Все' },
                { value: 'yes', label: 'Да' },
                { value: 'no', label: 'Нет' },
              ], filters.hasCode)}
            </label>

            <label class="export-field" data-filter="users">
              <span>Визитка опубликована</span>
              ${exportSelect('visit_card', [
                { value: '', label: 'Все' },
                { value: 'yes', label: 'Да' },
                { value: 'no', label: 'Нет' },
              ], filters.visitCard)}
            </label>

            <label class="export-field" data-filter="payments">
              <span>Статус оплаты</span>
              ${exportSelect('payment_status', [
                { value: '', label: 'Все' },
                { value: 'completed', label: 'Завершена' },
                { value: 'pending', label: 'Ожидает' },
                { value: 'cancelled', label: 'Отменена' },
              ], filters.paymentStatus)}
            </label>

            <label class="export-field" data-filter="payments">
              <span>Тип продукта</span>
              ${exportSelect('product_type', [
                { value: '', label: 'Все' },
                { value: 'topup', label: 'Пакет вопросов' },
                { value: 'visit_card', label: 'Визитка' },
              ], filters.productType)}
            </label>

            <label class="export-field" data-filter="payments">
              <span>Провайдер</span>
              ${exportSelect('provider', [
                { value: '', label: 'Все' },
                { value: 'yookassa', label: 'ЮKassa' },
                { value: 'manual', label: 'Ручной' },
              ], filters.provider)}
            </label>

            <label class="export-field" data-filter="payments">
              <span>Фильтр по дате</span>
              ${exportSelect('payment_date', [
                { value: 'created_at', label: 'Дата создания' },
                { value: 'completed_at', label: 'Дата завершения' },
              ], filters.paymentDateField)}
            </label>

            <label class="export-field" data-filter="events">
              <span>Событие</span>
              ${exportSelect('event_name', eventOptions, filters.eventName)}
            </label>

            <label class="export-field" data-filter="events">
              <span>Шаг анкеты</span>
              ${exportSelect('event_step', stepOptions, filters.eventStep)}
            </label>

            <label class="export-field" data-filter="usage">
              <span>Модель AI</span>
              ${exportSelect('model', modelOptions, filters.model)}
            </label>

            <label class="export-field" data-filter="transactions">
              <span>Тип транзакции</span>
              ${exportSelect('tx_type', [
                { value: '', label: 'Все' },
                { value: 'bonus', label: 'Бонус' },
                { value: 'spend', label: 'Списание' },
                { value: 'refund', label: 'Возврат' },
                { value: 'grant', label: 'Начисление' },
                { value: 'purchase', label: 'Покупка' },
              ], filters.txType)}
            </label>
          </div>

          <p class="muted-text export-hint">
            Если указаны «Дата с/по», они перекрывают пресет периода.
            Для воронок используйте только пресет периода (7 / 30 / 90 / всё время).
          </p>

          <div class="export-actions">
            <button type="submit" class="btn btn-success">Скачать CSV</button>
            <a href="/admin/export/download?${esc(downloadQs)}" class="btn btn-ghost">Прямая ссылка на файл</a>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-header">Что в каждой выгрузке</div>
        <div class="export-help">
          <dl>
            <dt>Пользователи</dt><dd>регистрация, анкета, код, баланс, сообщения, вопросы, последняя активность</dd>
            <dt>Оплаты</dt><dd>суммы, статусы, тип продукта, провайдер, код платежа</dd>
            <dt>События аналитики</dt><dd>сырые события воронки с meta JSON</dd>
            <dt>Запросы к AI</dt><dd>модель, токены, списанные вопросы</dd>
            <dt>Транзакции баланса</dt><dd>начисления, списания, покупки</dd>
            <dt>Визитки</dt><dd>опубликованные коды и даты</dd>
            <dt>Воронки</dt><dd>конверсия по шагам (как на странице «Воронка»)</dd>
            <dt>Сводка по дням</dt><dd>регистрации, AI-запросы, оплаты и выручка по календарным дням</dd>
          </dl>
        </div>
      </div>

      <script>
        (function () {
          const form = document.getElementById('export-form');
          const typeSelect = document.getElementById('export-type');
          const fields = form.querySelectorAll('[data-filter]');

          function syncFilters() {
            const type = typeSelect.value;
            fields.forEach((el) => {
              const types = (el.getAttribute('data-filter') || '').split(/\\s+/);
              el.hidden = !types.includes(type);
            });
          }

          typeSelect.addEventListener('change', syncFilters);
          syncFilters();
        })();
      </script>
    `;

    res.type('html').send(layout('Выгрузка', 'export', body));
  });

  router.get('/export/download', async (req, res) => {
    const filters = exportQueries.parseExportFilters(req.query);
    const columns = exportQueries.getExportColumns(filters.type);
    const rows = await exportQueries.runExport(filters);
    const csv = buildCsv(columns, rows);
    const filename = csvFilename(filters.type, filters);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  });

  router.use((req, res) => {
    console.warn(`[admin] 404 ${req.method} ${req.originalUrl}`);
    res
      .status(404)
      .type('html')
      .send(
        layout(
          'Не найдено',
          '',
          '<p class="empty">Страница не найдена.</p><p><a href="/admin">← На главную</a></p>',
        ),
      );
  });

  return router;
}
