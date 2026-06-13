import { config } from '../shared/config.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function siteStyles() {
  return `
    :root {
      --bg: #0f0e17;
      --card: #1a1829;
      --text: #eae9f0;
      --muted: #9b98b0;
      --accent: #7c5cff;
      --accent2: #c4a35a;
      --line: rgba(255,255,255,.08);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(ellipse at top, #1e1635 0%, var(--bg) 55%);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.65;
    }
    a { color: var(--accent2); }
    .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
    .topbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 20px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 36px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--line);
    }
    .brand {
      color: var(--text);
      text-decoration: none;
      font-weight: 700;
      font-size: 1.05rem;
    }
    .nav { display: flex; flex-wrap: wrap; gap: 16px; font-size: .95rem; }
    .nav a { text-decoration: none; color: var(--muted); }
    .nav a:hover, .nav a.active { color: var(--accent2); }
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
    h2 {
      font-size: 1.25rem;
      margin: 28px 0 12px;
    }
    .lead { color: var(--muted); font-size: 1.125rem; margin-bottom: 28px; }
    .cards {
      display: grid;
      gap: 12px;
      margin-bottom: 28px;
    }
    .card {
      background: var(--card);
      border: 1px solid rgba(255,255,255,.06);
      border-radius: 14px;
      padding: 16px 18px;
    }
    .card strong { display: block; margin-bottom: 4px; }
    .card span, .card p { color: var(--muted); font-size: .95rem; }
    .steps { counter-reset: step; display: grid; gap: 12px; margin-bottom: 28px; }
    .step {
      background: var(--card);
      border: 1px solid rgba(255,255,255,.06);
      border-radius: 14px;
      padding: 16px 18px 16px 56px;
      position: relative;
    }
    .step::before {
      counter-increment: step;
      content: counter(step);
      position: absolute;
      left: 18px;
      top: 16px;
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: rgba(124,92,255,.2);
      color: #cfc4ff;
      display: grid;
      place-items: center;
      font-size: .85rem;
      font-weight: 700;
    }
    .step strong { display: block; margin-bottom: 4px; }
    .step span { color: var(--muted); font-size: .95rem; }
    .cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin: 28px 0; }
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
    .cta-secondary {
      display: inline-block;
      color: var(--text);
      text-decoration: none;
      font-weight: 600;
      padding: 14px 22px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,.03);
    }
    .cta-secondary:hover { border-color: rgba(196,163,90,.35); }
    .tariffs {
      background: var(--card);
      border: 1px solid rgba(255,255,255,.06);
      border-radius: 14px;
      padding: 18px 20px;
      margin-bottom: 8px;
      white-space: pre-line;
      color: var(--muted);
    }
    .prose p, .prose li { color: var(--muted); margin-bottom: 12px; }
    .prose ul { padding-left: 1.25rem; margin-bottom: 12px; }
    .prose h2 { color: var(--text); }
    .prose strong { color: var(--text); }
    .foot {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: .9rem;
    }
    .foot p + p { margin-top: 8px; }
  `;
}

export function privacyPageUrl() {
  if (config.privacyPolicyUrl) {
    return config.privacyPolicyUrl;
  }
  if (config.publicSiteUrl) {
    return `${config.publicSiteUrl}/privacy`;
  }
  return '/privacy';
}

export function cookiesPageUrl() {
  if (config.cookiesPolicyUrl) {
    return config.cookiesPolicyUrl;
  }
  if (config.publicSiteUrl) {
    return `${config.publicSiteUrl}/cookies`;
  }
  return '/cookies';
}

export function renderSitePage({ title, description, activeNav, bodyHtml }) {
  const siteName = config.publicSiteName;
  const homeActive = activeNav === 'home' ? 'active' : '';
  const privacyActive = activeNav === 'privacy' ? 'active' : '';
  const cookiesActive = activeNav === 'cookies' ? 'active' : '';
  const pageTitle = title === siteName ? siteName : `${title} — ${siteName}`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <style>${siteStyles()}</style>
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <a class="brand" href="/">${escapeHtml(siteName)}</a>
      <nav class="nav">
        <a href="/" class="${homeActive}">Главная</a>
        <a href="/privacy" class="${privacyActive}">Персональные данные</a>
        <a href="/cookies" class="${cookiesActive}">Cookie</a>
      </nav>
    </header>
    ${bodyHtml}
    <footer class="foot">
      <p>Оплата через ЮKassa · 1 вопрос = 1 развёрнутый ответ</p>
      <p>
        <a href="/privacy">Персональные данные</a>
        ·
        <a href="/cookies">Cookie</a>
      </p>
      ${
        config.paymentSupportUsername
          ? `<p>Поддержка: <a href="https://t.me/${escapeHtml(config.paymentSupportUsername.replace(/^@/, ''))}">${escapeHtml(config.paymentSupportUsername)}</a></p>`
          : ''
      }
    </footer>
  </div>
</body>
</html>`;
}
