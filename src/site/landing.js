import { config } from '../shared/config.js';
import { formatPackagesLine } from '../shared/pricing.js';
import { formatQuestions } from '../shared/requests-format.js';
import { escapeHtml, renderSitePage } from './html.js';

export function renderLandingPage() {
  const tagline =
    config.publicSiteTagline ||
    'Персональный код личности в Telegram: астрология, Human Design, нумерология, Сюцай и ведическая астрология — и ответы на ваши вопросы.';

  const bonusLine =
    config.welcomeBonusRequests > 0
      ? `<p class="lead" style="margin-top:-12px;margin-bottom:28px;">🎁 При первом запуске — ${formatQuestions(config.welcomeBonusRequests)} бесплатно.</p>`
      : '';

  const bodyHtml = `
    <div class="badge">Telegram · Код личности</div>
    <h1>${escapeHtml(config.publicSiteName)}</h1>
    <p class="lead">${escapeHtml(tagline)}</p>
    ${bonusLine}

    <h2>Как это работает</h2>
    <div class="steps">
      <div class="step">
        <strong>Короткая анкета</strong>
        <span>Имя, пол, дата, время и место рождения — чтобы собрать вашу индивидуальную карту.</span>
      </div>
      <div class="step">
        <strong>Код личности</strong>
        <span>Бот сводит пять направлений в единый 10-значный код и даёт базовый разбор.</span>
      </div>
      <div class="step">
        <strong>Вопросы и ответы</strong>
        <span>Задавайте свои вопросы или выбирайте из популярных — каждый ответ опирается на ваш код.</span>
      </div>
    </div>

    <h2>Пять направлений в одном коде</h2>
    <div class="cards">
      <div class="card"><strong>🌙 Астрология</strong><span>Классический взгляд на характер и жизненные циклы</span></div>
      <div class="card"><strong>💫 Human Design</strong><span>Энергетический тип и стратегия принятия решений</span></div>
      <div class="card"><strong>🔢 Нумерология</strong><span>Числа судьбы и скрытые закономерности даты рождения</span></div>
      <div class="card"><strong>☯️ Сюцай</strong><span>Восточная система чисел и жизненных качеств</span></div>
      <div class="card"><strong>🕉 Джойтиш</strong><span>Ведическая астрология — карма, путь и предназначение</span></div>
    </div>

    <h2>Тарифы</h2>
    <div class="tariffs">${escapeHtml(formatPackagesLine(null))}</div>

    <div class="cta-row">
      <a class="cta" href="${escapeHtml(config.publicBotLink)}" target="_blank" rel="noopener">Открыть бота в Telegram</a>
      <a class="cta-secondary" href="${escapeHtml(config.publicBotLink)}" target="_blank" rel="noopener">Команды: /start · /balance · /restart</a>
    </div>
  `;

  return renderSitePage({
    title: config.publicSiteName,
    description: tagline,
    activeNav: 'home',
    bodyHtml,
  });
}
