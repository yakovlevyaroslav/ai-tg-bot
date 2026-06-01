import express, { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as billing from '../../shared/billing.js';
import * as payments from '../../shared/payments.js';
import { config } from '../../shared/config.js';
import * as queries from './queries.js';
import { formatSpecialistLine } from '../../bot/specialists.js';
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
    return `<div class="flash flash-success">Кредиты начислены. Новый баланс: ${esc(formatCredits(query.balance))}</div>`;
  }
  if (query.ok === 'confirm') {
    return `<div class="flash flash-success">Оплата ${esc(query.code)} подтверждена.</div>`;
  }
  if (query.error) {
    return `<div class="flash flash-error">${esc(query.error)}</div>`;
  }
  return '';
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
    const pending = await queries.listPendingPayments(8);

    const pendingRows = pending.length
      ? pending
          .map(
            (p) => `<tr>
          <td><code>${esc(p.payment_code)}</code></td>
          <td>${esc(userLabel(p))}</td>
          <td>${esc(p.rub_amount)} ₽ → ${formatCredits(p.credits_amount)}</td>
          <td>${formatDate(p.created_at)}</td>
          <td>
            <form method="post" action="/admin/payments/${esc(p.payment_code)}/confirm" style="display:inline">
              <button type="submit" class="btn btn-sm btn-success">Подтвердить</button>
            </form>
          </td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="5" class="empty">Нет ожидающих заявок</td></tr>`;

    const body = `
      ${flashMessage(req.query)}
      <h1 class="page-title">Обзор</h1>
      <p class="page-subtitle">AI_PROVIDER: ${esc(config.aiProvider)} · ${esc(formatCredits(config.creditsPerMessage))} кредитов за ответ</p>
      <div class="stats-grid">
        ${statCard('Пользователей', stats.users_count)}
        ${statCard('Кредитов в системе', formatCredits(stats.total_credits))}
        ${statCard('Ожидают оплаты', stats.pending_payments, 'заявок pending')}
        ${statCard('Сообщений за 24ч', stats.messages_24h)}
        ${statCard('Запросов AI за 24ч', stats.requests_24h)}
        ${statCard('Транзакций за 24ч', stats.transactions_24h)}
      </div>
      <div class="card">
        <div class="card-header">Последние заявки на пополнение</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Код</th><th>Пользователь</th><th>Сумма</th><th>Создана</th><th></th></tr>
            </thead>
            <tbody>${pendingRows}</tbody>
          </table>
        </div>
        <p style="padding:0.75rem 1rem;margin:0"><a href="/admin/payments">Все пополнения →</a></p>
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
          <td>${esc(formatSpecialistLine(u.specialist))}</td>
          <td><strong>${formatCredits(u.credits)}</strong></td>
          <td>${esc(u.messages_count)}</td>
          <td>${u.pending_payments > 0 ? `<span class="badge badge-pending">${u.pending_payments}</span>` : '—'}</td>
          <td>${u.welcome_bonus_granted ? '<span class="badge badge-success">да</span>' : '<span class="badge badge-muted">нет</span>'}</td>
          <td>${formatDate(u.created_at)}</td>
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
        <input type="search" name="search" placeholder="ID, telegram, username, имя…" value="${esc(search)}" style="min-width:240px">
        <button type="submit" class="btn">Найти</button>
        ${search ? `<a href="/admin/users" class="btn btn-ghost">Сбросить</a>` : ''}
      </form>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Telegram</th><th>Имя</th><th>Специалист</th><th>Баланс</th>
                <th>Сообщ.</th><th>Pending</th><th>Бонус</th><th>Регистрация</th>
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
    const grantError = req.query.error ? flashMessage(req.query) : '';

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
            <td>−${formatCredits(u.credits_charged)}</td>
          </tr>`,
          )
          .join('')
      : `<tr><td colspan="4" class="empty">Нет запросов к AI</td></tr>`;

    const body = `
      ${grantError}
      <p><a href="/admin/users">← Все пользователи</a></p>
      <h1 class="page-title">${esc(userLabel(user))}</h1>
      <p class="page-subtitle">Telegram ID: <code>${esc(user.telegram_id)}</code></p>

      <div class="detail-grid">
        <div class="detail-item"><label>Специалист</label><span>${esc(formatSpecialistLine(user.specialist))}</span></div>
        <div class="detail-item"><label>Баланс</label><span>${formatCredits(user.credits)} кредитов</span></div>
        <div class="detail-item"><label>Сообщений</label><span>${esc(user.messages_count)}</span></div>
        <div class="detail-item"><label>Регистрация</label><span>${formatDate(user.created_at)}</span></div>
        <div class="detail-item"><label>Стартовый бонус</label><span>${user.welcome_bonus_granted ? 'получен' : 'нет'}</span></div>
      </div>

      <div class="card">
        <div class="card-header">Начислить кредиты</div>
        <form method="post" action="/admin/users/${user.id}/grant" class="toolbar" style="padding:1rem">
          <input type="number" name="amount" min="1" placeholder="Количество" required style="width:140px">
          <button type="submit" class="btn">Начислить</button>
        </form>
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
            <thead><tr><th>Дата</th><th>Модель</th><th>Токены in/out</th><th>Кредиты</th></tr></thead>
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

    const result = await billing.grant(userId, amount, 'grant', { source: 'admin_web' });
    res.redirect(`/admin/users/${userId}?ok=grant&balance=${result.balanceAfter}`);
  });

  router.get('/payments', async (req, res) => {
    const status = req.query.status === 'all' ? 'all' : 'pending';
    const pending = await queries.listPendingPayments(100);
    const completed =
      status === 'all' ? await queries.listPaymentsByStatus('completed', 30) : [];

    const renderPaymentRows = (list, withAction = false) =>
      list.length
        ? list
            .map((p) => {
              const action = withAction
                ? `<form method="post" action="/admin/payments/${esc(p.payment_code)}/confirm" style="display:inline">
                 <button type="submit" class="btn btn-sm btn-success">Подтвердить</button>
               </form>`
                : `<span class="badge badge-success">завершена</span>`;
              return `<tr>
              <td><code>${esc(p.payment_code)}</code></td>
              <td><a href="/admin/users/${p.user_id}">${esc(userLabel(p))}</a></td>
              <td>${esc(p.rub_amount)} ₽</td>
              <td>${formatCredits(p.credits_amount)}</td>
              <td><span class="badge badge-${p.status === 'pending' ? 'pending' : 'success'}">${esc(p.status)}</span></td>
              <td>${formatDate(p.created_at)}</td>
              <td>${action}</td>
            </tr>`;
            })
            .join('')
        : `<tr><td colspan="7" class="empty">Нет записей</td></tr>`;

    const body = `
      ${flashMessage(req.query)}
      <h1 class="page-title">Пополнения</h1>
      <p class="page-subtitle">Курс: 100 ₽ = ${formatCredits(100 * config.creditsPerRub)} кредитов</p>
      <div class="toolbar">
        <a href="/admin/payments" class="btn${status !== 'all' ? '' : ' btn-ghost'}">Ожидающие</a>
        <a href="/admin/payments?status=all" class="btn${status === 'all' ? '' : ' btn-ghost'}">+ завершённые</a>
      </div>
      <div class="card">
        <div class="card-header">Ожидают подтверждения (${pending.length})</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Код</th><th>Пользователь</th><th>₽</th><th>Кредиты</th><th>Статус</th><th>Создана</th><th></th></tr>
            </thead>
            <tbody>${renderPaymentRows(pending, true)}</tbody>
          </table>
        </div>
      </div>
      ${
        status === 'all'
          ? `<div class="card">
        <div class="card-header">Недавно завершённые</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Код</th><th>Пользователь</th><th>₽</th><th>Кредиты</th><th>Статус</th><th>Создана</th><th></th></tr>
            </thead>
            <tbody>${renderPaymentRows(completed)}</tbody>
          </table>
        </div>
      </div>`
          : ''
      }
    `;

    res.type('html').send(layout('Пополнения', 'payments', body));
  });

  router.post('/payments/:code/confirm', async (req, res) => {
    const code = req.params.code;
    const result = await payments.confirmPayment(code, 'web-admin');

    if (!result.ok) {
      const errors = {
        not_found: 'Заявка не найдена',
        already_completed: 'Уже подтверждена',
        cancelled: 'Заявка отменена',
      };
      res.redirect(`/admin/payments?error=${encodeURIComponent(errors[result.reason] || 'Ошибка')}`);
      return;
    }

    res.redirect(`/admin/payments?ok=confirm&code=${encodeURIComponent(code)}`);
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
