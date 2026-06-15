import { config } from '../shared/config.js';
import { escapeHtml, renderSitePage } from './html.js';

function webAppScript() {
  return `
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <script>
      (function () {
        const tg = window.Telegram && window.Telegram.WebApp;
        if (!tg) return;
        tg.ready();
        tg.expand();
      })();
    </script>
  `;
}

export function renderOnboardingStubPage() {
  const botLink = config.publicBotLink;
  const botLabel = config.publicBotUsername
    ? `@${config.publicBotUsername}`
    : 'Telegram-боте';

  const bodyHtml = `
    ${webAppScript()}
    <p class="badge">Код личности</p>
    <h1>Ваш код ждёт</h1>
    <p class="lead">
      Пройдите короткую анкету в ${escapeHtml(botLabel)} — и получите персональный код
      по астрологии, Human Design, нумерологии, Сюцай и ведической астрологии.
    </p>

    <div class="steps">
      <div class="step">
        <strong>Анкета</strong>
        <span>Имя, пол, дата, время и место рождения — пара минут.</span>
      </div>
      <div class="step">
        <strong>Код личности</strong>
        <span>Единый 10-значный код и базовый разбор вашей карты.</span>
      </div>
      <div class="step">
        <strong>Вопросы</strong>
        <span>Задавайте свои вопросы — ответы опираются на ваш код.</span>
      </div>
    </div>

    <div class="cta-row">
      ${
        botLink
          ? `<a class="cta" href="${escapeHtml(botLink)}">▶️ Пройти анкету</a>`
          : ''
      }
      <a class="cta-secondary" href="/">На главную</a>
    </div>
  `;

  return renderSitePage({
    title: 'Пройдите анкету',
    description: `Получите код личности в ${config.publicSiteName}.`,
    activeNav: '',
    bodyHtml,
  });
}
