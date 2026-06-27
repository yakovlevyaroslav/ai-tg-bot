import { initSiteShell } from '../shell.js';

function initTelegramWebApp() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    return;
  }
  tg.ready();
  tg.expand();
}

export async function initOnboardingPage() {
  const loading = document.getElementById('onboarding-loading');
  const error = document.getElementById('onboarding-error');
  const page = document.getElementById('onboarding-page');

  initTelegramWebApp();

  try {
    const config = await initSiteShell({ activeNav: '' });
    const botLabel = config.botUsername ? `@${config.botUsername}` : 'Telegram-боте';

    document.getElementById('onboarding-lead').textContent =
      `Пройдите короткую анкету в ${botLabel} — и получите персональный код по астрологии, Human Design, нумерологии, Сюцай и ведической астрологии.`;

    if (config.botLink) {
      const cta = document.getElementById('onboarding-cta');
      cta.href = config.botLink;
      cta.classList.remove('is-hidden');
    }

    document.title = `Пройдите анкету — ${config.siteName}`;
    loading?.classList.add('is-hidden');
    page?.classList.remove('is-hidden');
  } catch (err) {
    loading?.classList.add('is-hidden');
    if (error) {
      error.textContent = err?.message ?? 'Ошибка загрузки';
      error.classList.remove('is-hidden');
    }
  }
}
