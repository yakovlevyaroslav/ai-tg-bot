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
  getUserProfileByTelegramId,
} from '../../shared/db.js';
import { buildVisitCardPublicUrl, normalizePersonalityCode } from '../../shared/visit-card.js';
import { formatPackagesLine } from '../../shared/pricing.js';
import { formatRequests } from '../../shared/requests-format.js';
import * as exportQueries from './export-queries.js';
import { buildCsv, csvFilename } from './csv.js';
import * as broadcastQueries from './broadcast-queries.js';
import {
  renderBroadcastFormPage,
  renderBroadcastStatusPage,
} from './broadcast-page.js';
import { parseBroadcastButtons, sendTelegramBroadcast } from '../../shared/telegram-api.js';
import { applyUserMessagePlaceholders } from '../../shared/user-display-name.js';
import { resolveBroadcastButtons } from '../../shared/broadcast/button-questions.js';
import {
  appendUtmToBroadcastMarkup,
  parseBroadcastUtm,
} from '../../shared/broadcast-utm.js';
import {
  cancelBroadcastCampaign,
  pauseBroadcastCampaign,
  resumeBroadcastCampaign,
} from '../../shared/broadcast/worker.js';
import {
  broadcastUploadMiddleware,
  getUploadErrorMessage,
  resolveBroadcastPhoto,
  resolveLocalPhotoPath,
  getMediaContentType,
  isLocalPhotoRef,
} from './broadcast-media.js';
import {
  esc,
  exportFilterSection,
  formatDate,
  formatCredits,
  formatStartPayloadLabel,
  layout,
  statCard,
  userLabel,
  userTableAlias,
  userTableName,
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
      maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
      etag: true,
      fallthrough: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith('admin.css')) {
          res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
        }
      },
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
          <td>${esc(userTableName(u))}</td>
          <td>${esc(userTableAlias(u))}</td>
          <td>${esc(u.personality_code || '—')}</td>
          <td><strong>${formatCredits(u.credits)}</strong></td>
          <td>${formatCredits(u.questions_spent)}</td>
          <td>${formatDate(u.created_at)}</td>
          <td>${esc(formatStartPayloadLabel(u.start_payload))}</td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="9" class="empty">Пользователи не найдены</td></tr>`;

    const prev = page > 1 ? `/admin/users?page=${page - 1}&search=${encodeURIComponent(search)}` : null;
    const next = page < pages ? `/admin/users?page=${page + 1}&search=${encodeURIComponent(search)}` : null;

    const body = `
      ${flashMessage(req.query)}
      <h1 class="page-title">Пользователи</h1>
      <p class="page-subtitle">Всего: ${total}</p>
      <form class="toolbar" method="get" action="/admin/users">
        <input type="search" name="search" placeholder="ID, telegram, имя, метка, organic…" value="${esc(search)}" style="min-width:240px">
        <button type="submit" class="btn">Найти</button>
        ${search ? `<a href="/admin/users" class="btn btn-ghost">Сбросить</a>` : ''}
      </form>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Telegram id</th><th>Имя</th><th>Alias</th><th>Код личности</th><th>Баланс</th>
                <th>Вопросы</th><th>Регистрация</th><th>Метка</th>
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
        <div class="detail-item"><label>Потрачено вопросов</label><span>${formatCredits(user.questions_spent)}</span></div>
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
          ${exportFilterSection(
            'Тип выгрузки',
            `
            <label class="export-field export-field-wide">
              <span>Тип данных</span>
              <select name="type" id="export-type" class="export-select">${exportTypeOptions(filters.type)}</select>
            </label>
          `,
          )}
          ${exportFilterSection(
            'Период и охват',
            `
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
          `,
          )}
          ${exportFilterSection(
            'Пользователи',
            `
            <label class="export-field export-field-wide">
              <span>Поиск</span>
              <input type="search" name="search" value="${esc(filters.search)}" placeholder="ID, telegram, имя, код…">
            </label>
            <label class="export-field">
              <span>Анкета завершена</span>
              ${exportSelect('onboarding', [
                { value: '', label: 'Все' },
                { value: 'yes', label: 'Да' },
                { value: 'no', label: 'Нет' },
              ], filters.onboarding)}
            </label>
            <label class="export-field">
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
            <label class="export-field" data-filter="users">
              <span>Метка ?start=</span>
              <input type="search" name="start_payload" value="${esc(filters.startPayload)}" placeholder="vk_march, site_main…">
            </label>
            <label class="export-field" data-filter="users">
              <span>Есть метку</span>
              ${exportSelect('has_start_payload', [
                { value: '', label: 'Все' },
                { value: 'yes', label: 'Да (любая из истории)' },
                { value: 'no', label: 'Нет (органика)' },
              ], filters.hasStartPayload)}
            </label>
            <label class="export-field" data-filter="users">
              <span>Сортировка</span>
              ${exportSelect('user_sort', exportQueries.USER_EXPORT_SORT_OPTIONS, filters.userSortOrder)}
            </label>
          `,
            { filter: 'users visit_cards' },
          )}
          ${exportFilterSection(
            'Оплаты',
            `
            <label class="export-field">
              <span>Статус оплаты</span>
              ${exportSelect('payment_status', [
                { value: '', label: 'Все' },
                { value: 'completed', label: 'Завершена' },
                { value: 'pending', label: 'Ожидает' },
                { value: 'cancelled', label: 'Отменена' },
              ], filters.paymentStatus)}
            </label>
            <label class="export-field">
              <span>Тип продукта</span>
              ${exportSelect('product_type', [
                { value: '', label: 'Все' },
                { value: 'topup', label: 'Пакет вопросов' },
                { value: 'visit_card', label: 'Визитка' },
              ], filters.productType)}
            </label>
            <label class="export-field">
              <span>Провайдер</span>
              ${exportSelect('provider', [
                { value: '', label: 'Все' },
                { value: 'yookassa', label: 'ЮKassa' },
                { value: 'manual', label: 'Ручной' },
              ], filters.provider)}
            </label>
            <label class="export-field">
              <span>Фильтр по дате</span>
              ${exportSelect('payment_date', [
                { value: 'created_at', label: 'Дата создания' },
                { value: 'completed_at', label: 'Дата завершения' },
              ], filters.paymentDateField)}
            </label>
          `,
            { filter: 'payments' },
          )}
          ${exportFilterSection(
            'События аналитики',
            `
            <label class="export-field">
              <span>Событие</span>
              ${exportSelect('event_name', eventOptions, filters.eventName)}
            </label>
            <label class="export-field">
              <span>Шаг анкеты</span>
              ${exportSelect('event_step', stepOptions, filters.eventStep)}
            </label>
          `,
            { filter: 'events' },
          )}
          ${exportFilterSection(
            'Запросы к AI',
            `
            <label class="export-field">
              <span>Модель AI</span>
              ${exportSelect('model', modelOptions, filters.model)}
            </label>
          `,
            { filter: 'usage' },
          )}
          ${exportFilterSection(
            'Транзакции баланса',
            `
            <label class="export-field">
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
          `,
            { filter: 'transactions' },
          )}

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
          const sections = form.querySelectorAll('.export-section[data-filter]');

          function syncFilters() {
            const type = typeSelect.value;
            sections.forEach((el) => {
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

  function broadcastFlash(type, message) {
    const cls = type === 'error' ? 'flash-error' : 'flash-success';
    return `<div class="flash ${cls}">${esc(message)}</div>`;
  }

  async function parseBroadcastFormBody(body, file = null) {
    const photoRef = resolveBroadcastPhoto(body, file);
    const buttonUtm = parseBroadcastUtm(body);
    const replyMarkup = appendUtmToBroadcastMarkup(
      await resolveBroadcastButtons(body.buttons_text),
      buttonUtm,
    );

    return {
      name: String(body.name ?? '').trim(),
      messageText: String(body.message_text ?? '').trim(),
      photoUrl: photoRef,
      photoLocal: isLocalPhotoRef(photoRef) ? photoRef : String(body.photo_local ?? '').trim(),
      buttonsText: String(body.buttons_text ?? ''),
      buttonUtm,
      replyMarkup,
      filters: broadcastQueries.parseAudienceFilters(body),
    };
  }

  function formBodyToQuery(body, parsed) {
    return {
      ...body,
      photo_url: parsed.photoUrl || '',
      photo_local: parsed.photoLocal || '',
      utm_source: parsed.buttonUtm?.utm_source ?? '',
      utm_medium: parsed.buttonUtm?.utm_medium ?? '',
      utm_campaign: parsed.buttonUtm?.utm_campaign ?? '',
      utm_content: parsed.buttonUtm?.utm_content ?? '',
      utm_term: parsed.buttonUtm?.utm_term ?? '',
    };
  }

  router.get('/broadcast/media/:filename', (req, res) => {
    const filePath = resolveLocalPhotoPath(`local:${req.params.filename}`);

    if (!filePath) {
      res.status(404).send('Not found');
      return;
    }

    res.type(getMediaContentType(req.params.filename)).sendFile(filePath);
  });

  router.get('/broadcast', async (req, res) => {
    const campaigns = await broadcastQueries.listBroadcastCampaigns(15);
    const body = renderBroadcastFormPage({ query: req.query, campaigns });
    res.type('html').send(layout('Рассылка', 'broadcast', body));
  });

  router.get('/broadcast/:id', async (req, res) => {
    const id = Number(req.params.id);
    const campaign = await broadcastQueries.getBroadcastCampaign(id);

    if (!campaign) {
      res.status(404).type('html').send(layout('Не найдено', 'broadcast', '<p class="empty">Кампания не найдена</p>'));
      return;
    }

    await broadcastQueries.refreshBroadcastCampaignCounters(id);
    const updated = await broadcastQueries.getBroadcastCampaign(id);
    const deliveryStatus = String(req.query.delivery_status ?? '').trim();
    const deliveryPage = Math.max(1, Number(req.query.delivery_page) || 1);
    const deliveryLimit = broadcastQueries.BROADCAST_DELIVERIES_PER_PAGE;

    const statsRows = await broadcastQueries.getBroadcastCampaignStats(id);
    const deliveryStats = Object.fromEntries(statsRows.map((row) => [row.status, row.count]));

    const deliveryTotal = await broadcastQueries.countBroadcastDeliveries(id, deliveryStatus);
    const deliveryPages = Math.max(1, Math.ceil(deliveryTotal / deliveryLimit));
    const safeDeliveryPage = Math.min(deliveryPage, deliveryPages);
    const deliveries = await broadcastQueries.listBroadcastDeliveries({
      campaignId: id,
      status: deliveryStatus,
      page: safeDeliveryPage,
      limit: deliveryLimit,
    });

    const filters = broadcastQueries.normalizeCampaignFilters(updated.filters);
    const filtersDescription = broadcastQueries.describeAudienceFilters(filters);
    const flash = req.query.ok ? broadcastFlash('success', 'Статус обновлён') : '';

    const body = renderBroadcastStatusPage({
      campaign: updated,
      filtersDescription,
      deliveryStats,
      deliveries,
      deliveryPage: safeDeliveryPage,
      deliveryPages,
      deliveryTotal,
      deliveryStatus,
      flash,
    });
    res.type('html').send(layout(updated.name, 'broadcast', body));
  });

  router.post('/broadcast', broadcastUploadMiddleware, async (req, res) => {
    const uploadError = getUploadErrorMessage(req);
    const action = String(req.body.action ?? '');
    const parsed = await parseBroadcastFormBody(req.body, req.file ?? null);
    const campaigns = await broadcastQueries.listBroadcastCampaigns(15);
    const formQuery = formBodyToQuery(req.body, parsed);

    if (uploadError) {
      const body = renderBroadcastFormPage({
        query: formQuery,
        campaigns,
        flash: broadcastFlash('error', uploadError),
      });
      res.type('html').send(layout('Рассылка', 'broadcast', body));
      return;
    }

    const redirectQuery = new URLSearchParams();

    for (const [key, value] of Object.entries(formQuery)) {
      if (typeof value === 'string' && key !== 'action') {
        redirectQuery.set(key, value);
      }
    }

    if (!parsed.messageText && action === 'start') {
      const body = renderBroadcastFormPage({
        query: formQuery,
        campaigns,
        flash: broadcastFlash('error', 'Введите текст сообщения'),
      });
      res.type('html').send(layout('Рассылка', 'broadcast', body));
      return;
    }

    if (action === 'test') {
      const adminIds = config.adminTelegramIds.filter(Number.isFinite);
      if (!adminIds.length) {
        const body = renderBroadcastFormPage({
          query: formQuery,
          campaigns,
          flash: broadcastFlash('error', 'Задайте ADMIN_TELEGRAM_IDS в .env'),
        });
        res.type('html').send(layout('Рассылка', 'broadcast', body));
        return;
      }

      let okCount = 0;
      let lastError = '';

      try {
        for (const chatId of adminIds) {
          const profile = await getUserProfileByTelegramId(chatId);
          const result = await sendTelegramBroadcast({
            chatId,
            text: applyUserMessagePlaceholders(parsed.messageText, profile ?? {}, { html: true }),
            photoUrl: parsed.photoUrl,
            replyMarkup: parsed.replyMarkup,
          });

          if (result.ok) {
            okCount += 1;
          } else {
            lastError = result.description ?? 'ошибка отправки';
          }
        }
      } catch (err) {
        lastError = err?.message ?? 'ошибка отправки';
      }

      const body = renderBroadcastFormPage({
        query: formQuery,
        campaigns,
        flash: broadcastFlash(
          okCount ? 'success' : 'error',
          okCount
            ? `Тест отправлен (${okCount} админ${okCount > 1 ? 'ам' : ''})`
            : `Тест не отправлен: ${lastError}`,
        ),
      });
      res.type('html').send(layout('Рассылка', 'broadcast', body));
      return;
    }

    if (action === 'start') {
      if (!parsed.name) {
        const body = renderBroadcastFormPage({
          query: formQuery,
          campaigns,
          flash: broadcastFlash('error', 'Укажите название кампании'),
        });
        res.type('html').send(layout('Рассылка', 'broadcast', body));
        return;
      }

      try {
        const campaign = await broadcastQueries.createBroadcastCampaign({
          name: parsed.name,
          messageText: parsed.messageText,
          photoUrl: parsed.photoUrl,
          photoFileId: null,
          replyMarkup: parsed.replyMarkup,
          filters: parsed.filters,
          sortOrder: parsed.filters.sortOrder,
        });

        res.redirect(`/admin/broadcast/${campaign.id}?ok=1`);
        return;
      } catch (err) {
        const message =
          err instanceof broadcastQueries.BroadcastError
            ? err.message
            : err?.message ?? 'Не удалось создать рассылку';
        const body = renderBroadcastFormPage({
          query: formQuery,
          campaigns,
          flash: broadcastFlash('error', message),
        });
        res.type('html').send(layout('Рассылка', 'broadcast', body));
        return;
      }
    }

    res.redirect(`/admin/broadcast?${redirectQuery.toString()}`);
  });

  router.post('/broadcast/:id/pause', async (req, res) => {
    const id = Number(req.params.id);
    await pauseBroadcastCampaign(id);
    res.redirect(`/admin/broadcast/${id}`);
  });

  router.post('/broadcast/:id/resume', async (req, res) => {
    const id = Number(req.params.id);
    await resumeBroadcastCampaign(id);
    res.redirect(`/admin/broadcast/${id}`);
  });

  router.post('/broadcast/:id/cancel', async (req, res) => {
    const id = Number(req.params.id);
    await cancelBroadcastCampaign(id);
    res.redirect(`/admin/broadcast/${id}`);
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
