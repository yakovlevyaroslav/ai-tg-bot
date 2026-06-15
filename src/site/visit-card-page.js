import { escapeHtml, renderSitePage } from './html.js';
import { config } from '../shared/config.js';
import { buildVisitCardCodeBreakdown } from '../shared/visit-card.js';

function telegramHtmlToWeb(content) {
  let html = escapeHtml(content);
  html = html.replace(/&lt;b&gt;/gi, '<strong>').replace(/&lt;\/b&gt;/gi, '</strong>');
  html = html.replace(/&lt;i&gt;/gi, '<em>').replace(/&lt;\/i&gt;/gi, '</em>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function visitCardStyles() {
  return `
    .code-hero {
      text-align: center;
      margin: 12px 0 32px;
      padding: 28px 20px;
      border-radius: 18px;
      background: linear-gradient(145deg, rgba(124,92,255,.18), rgba(196,163,90,.12));
      border: 1px solid rgba(196,163,90,.25);
    }
    .code-label {
      font-size: .85rem;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--accent2);
      margin-bottom: 12px;
    }
    .code-value {
      font-size: clamp(2rem, 8vw, 3rem);
      font-weight: 800;
      letter-spacing: .18em;
      font-variant-numeric: tabular-nums;
      color: #fff;
      text-shadow: 0 0 24px rgba(124,92,255,.35);
    }
    .code-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      grid-template-rows: repeat(2, 1fr);
      gap: 10px;
      margin-bottom: 28px;
    }
    .code-part {
      background: var(--card);
      border: 1px solid rgba(255,255,255,.06);
      border-radius: 12px;
      padding: 14px 16px;
      text-align: center;
    }
    .code-part:nth-child(1) {
        grid-column: span 3 / span 3;
    }
    .code-part:nth-child(2) {
        grid-column: span 3 / span 3;
      grid-column-start: 4;
    }
    .code-part:nth-child(3) {
        grid-column: span 2 / span 2;
        grid-row-start: 2;
    }
    .code-part:nth-child(4) {
        grid-column: span 2 / span 2;
        grid-column-start: 3;
        grid-row-start: 2;
    }
    .code-part:nth-child(5) {
        grid-column: span 2 / span 2;
        grid-column-start: 5;
        grid-row-start: 2;
    }

    .code-part span {
      display: block;
      color: var(--muted);
      font-size: .8rem;
      margin-bottom: 6px;
    }
    .code-part strong {
      font-size: 1.35rem;
      letter-spacing: .08em;
      color: var(--accent2);
    }
    .visit-content {
      background: var(--card);
      border: 1px solid rgba(255,255,255,.06);
      border-radius: 16px;
      padding: 24px 22px;
      line-height: 1.7;
    }
    .visit-content strong { color: var(--text); }
    .visit-content em { color: #cfc4ff; }
    .share-note {
      margin-top: 24px;
      color: var(--muted);
      font-size: .95rem;
      text-align: center;
    }
  `;
}

export function renderVisitCardPage(card) {
  const code = card.personality_code;
  const breakdown = buildVisitCardCodeBreakdown(card.onboarding_data ?? {});
  const contentHtml = telegramHtmlToWeb(card.visit_card_content ?? '');

  const breakdownHtml = breakdown
    .map(
      (item) =>
        `<div class="code-part"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`,
    )
    .join('');

  const botLink = config.publicBotLink;
  const botLabel = config.publicBotUsername
    ? `@${config.publicBotUsername}`
    : 'нашем боте';

  const bodyHtml = `
    <style>${visitCardStyles()}</style>
    <p class="badge">Визитка</p>
    <h1>Твой личный <br> Код личности</h1>
    <p class="lead">Публичная страница с разбором — без имени, даты и места рождения.</p>
    <div class="code-hero">
      <div class="code-label">Код личности</div>
      <div class="code-value">${escapeHtml(code)}</div>
    </div>
    ${
      breakdownHtml
        ? `<div class="code-grid">${breakdownHtml}</div>`
        : ''
    }
    <div class="visit-content prose">${contentHtml}</div>
    <p class="share-note">
      Хотите свой код? Пройдите анкету в ${escapeHtml(botLabel)}.
      ${botLink ? `<a href="${escapeHtml(botLink)}">Открыть бота</a>` : ''}
    </p>
  `;

  return renderSitePage({
    title: `Код ${code}`,
    description: `Код личности ${code} — разбор по астрологии, Human Design, нумерологии, Сюцаю и Джойтиш.`,
    activeNav: '',
    bodyHtml,
  });
}

export function renderVisitCardNotFoundPage() {
  const bodyHtml = `
    <p class="badge">Визитка</p>
    <h1>Страница не найдена</h1>
    <p class="lead">
      Такой код личности не опубликован или ссылка указана неверно.
      Получить свой код можно в ${escapeHtml(config.publicBotUsername ? `@${config.publicBotUsername}` : 'Telegram-боте')}.
    </p>
    <div class="cta-row">
      <a class="cta" href="${escapeHtml(config.publicBotLink)}">Открыть бота</a>
      <a class="cta-secondary" href="/">На главную</a>
    </div>
  `;

  return renderSitePage({
    title: 'Визитка не найдена',
    description: 'Публичная визитка кода личности не найдена.',
    activeNav: '',
    bodyHtml,
  });
}
