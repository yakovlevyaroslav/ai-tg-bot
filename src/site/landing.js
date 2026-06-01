import { config } from '../shared/config.js';

export function renderLandingPage() {
  const botLink = config.publicBotLink;
  const siteName = config.publicSiteName;
  const tagline = config.publicSiteTagline;
  const support = config.paymentSupportUsername;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(siteName)}</title>
  <meta name="description" content="${escapeHtml(tagline)}">
  <style>
    :root {
      --bg: #0f0e17;
      --card: #1a1829;
      --text: #eae9f0;
      --muted: #9b98b0;
      --accent: #7c5cff;
      --accent2: #c4a35a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(ellipse at top, #1e1635 0%, var(--bg) 55%);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.6;
    }
    .wrap { max-width: 720px; margin: 0 auto; padding: 48px 20px 64px; }
    .badge {
      display: inline-block;
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--accent2);
      border: 1px solid rgba(196,163,90,.35);
      border-radius: 999px;
      padding: 6px 12px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: clamp(2rem, 5vw, 2.75rem);
      line-height: 1.15;
      margin-bottom: 16px;
    }
    .lead { color: var(--muted); font-size: 1.125rem; margin-bottom: 32px; }
    .cards {
      display: grid;
      gap: 12px;
      margin-bottom: 36px;
    }
    .card {
      background: var(--card);
      border: 1px solid rgba(255,255,255,.06);
      border-radius: 14px;
      padding: 16px 18px;
    }
    .card strong { display: block; margin-bottom: 4px; }
    .card span { color: var(--muted); font-size: .95rem; }
    .cta {
      display: inline-block;
      background: linear-gradient(135deg, var(--accent), #5a3fd4);
      color: #fff;
      text-decoration: none;
      font-weight: 600;
      padding: 14px 28px;
      border-radius: 12px;
      font-size: 1.05rem;
      box-shadow: 0 8px 24px rgba(124,92,255,.35);
    }
    .cta:hover { filter: brightness(1.08); }
    .foot {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid rgba(255,255,255,.08);
      color: var(--muted);
      font-size: .9rem;
    }
    .foot a { color: var(--accent2); text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="badge">Telegram · AI</div>
    <h1>${escapeHtml(siteName)}</h1>
    <p class="lead">${escapeHtml(tagline)}</p>

    <div class="cards">
      <div class="card"><strong>🔮 Таролог</strong><span>Расклады и интуитивные подсказки</span></div>
      <div class="card"><strong>🔢 Нумеролог</strong><span>Числа судьбы и даты</span></div>
      <div class="card"><strong>🌿 Родолог</strong><span>Родовые сценарии и опора</span></div>
    </div>

    <a class="cta" href="${escapeHtml(botLink)}" target="_blank" rel="noopener">Открыть бота в Telegram</a>

    <div class="foot">
      <p>Оплата через ЮKassa · баланс в кредитах</p>
      ${support ? `<p>Вопросы: <a href="https://t.me/${escapeHtml(support.replace(/^@/, ''))}">${escapeHtml(support)}</a></p>` : ''}
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
