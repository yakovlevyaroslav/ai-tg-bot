import { telegramHtmlToWeb } from './telegram-html.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getVisitCardCodeFromPath() {
  const match = window.location.pathname.match(/^\/code\/(\d{10})\/?$/);
  return match?.[1] ?? '';
}

export async function loadVisitCard(code) {
  const response = await fetch(`/api/visit-card/${encodeURIComponent(code)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Не удалось загрузить визитку');
  }
  return response.json();
}

function renderBreakdown(breakdown) {
  if (!breakdown?.length) {
    return '';
  }

  return breakdown
    .map(
      (item) =>
        `<div class="code-part"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`,
    )
    .join('');
}

function bindShareButton(shareUrl) {
  const button = document.getElementById('share-btn');
  const status = document.getElementById('share-status');

  const setStatus = (text) => {
    if (status) {
      status.textContent = text;
    }
  };

  const copyLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setStatus('Ссылка скопирована ✓');
        return;
      }
    } catch {
      // fallback below
    }

    const input = document.createElement('textarea');
    input.value = shareUrl;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();

    try {
      document.execCommand('copy');
      setStatus('Ссылка скопирована ✓');
    } catch {
      setStatus('Не удалось скопировать — выделите ссылку вручную');
    }

    document.body.removeChild(input);
  };

  button?.addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Мой код личности',
          text: 'Посмотри мой код личности',
          url: shareUrl,
        });
        setStatus('Спасибо, что поделились ✓');
        return;
      } catch (err) {
        if (err?.name === 'AbortError') {
          return;
        }
      }
    }

    await copyLink();
  });
}

export function renderVisitCard(card) {
  const page = document.getElementById('visit-card-page');
  const notFound = document.getElementById('visit-card-not-found');
  const loading = document.getElementById('visit-card-loading');

  if (!card) {
    loading?.classList.add('is-hidden');
    notFound?.classList.remove('is-hidden');
    document.title = 'Визитка не найдена';
    return;
  }

  const botLabel = card.botUsername ? `@${card.botUsername}` : 'нашем боте';
  const breakdownHtml = renderBreakdown(card.breakdown);
  const contentHtml = telegramHtmlToWeb(card.content ?? '');

  page.innerHTML = `
    <p class="badge">Визитка</p>
    <h1>Твой личный <br> Код личности</h1>
    <p class="lead">Публичная страница с разбором — без имени, даты и места рождения.</p>
    <div class="code-hero">
      <div class="code-label">Код личности</div>
      <div class="code-value">${escapeHtml(card.personalityCode)}</div>
    </div>
    ${breakdownHtml ? `<div class="code-grid">${breakdownHtml}</div>` : ''}
    <div class="visit-content prose">${contentHtml}</div>
    <div class="share-row">
      <button type="button" class="share-btn" id="share-btn">🔗 Поделиться визиткой</button>
      ${
        card.askBotLink
          ? `<a class="ask-btn" href="${escapeHtml(card.askBotLink)}" target="_blank" rel="noopener">❓ Задать вопрос</a>`
          : ''
      }
      <div class="share-status" id="share-status"></div>
    </div>
    <p class="share-note">
      Хотите свой код? Пройдите анкету в ${escapeHtml(botLabel)}.
      ${card.botLink ? `<a href="${escapeHtml(card.botLink)}">Открыть бота</a>` : ''}
    </p>
  `;

  document.title = `Код ${card.personalityCode}`;
  loading?.classList.add('is-hidden');
  page.classList.remove('is-hidden');
  bindShareButton(card.shareUrl);
}

export function renderVisitCardNotFound(config) {
  const notFound = document.getElementById('visit-card-not-found');
  const loading = document.getElementById('visit-card-loading');
  const botLabel = config?.botUsername ? `@${config.botUsername}` : 'Telegram-боте';

  notFound.innerHTML = `
    <p class="badge">Визитка</p>
    <h1>Страница не найдена</h1>
    <p class="lead">
      Такой код личности не опубликован или ссылка указана неверно.
      Получить свой код можно в ${escapeHtml(botLabel)}.
    </p>
    <div class="cta-row">
      ${config?.botLink ? `<a class="cta" href="${escapeHtml(config.botLink)}">Открыть бота</a>` : ''}
      <a class="cta-secondary" href="/">На главную</a>
    </div>
  `;

  loading?.classList.add('is-hidden');
  notFound.classList.remove('is-hidden');
  document.title = 'Визитка не найдена';
}
