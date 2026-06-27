import { formatQuestions, initSiteShell } from '../shell.js';

export async function initLandingPage() {
  const loading = document.getElementById('landing-loading');
  const error = document.getElementById('landing-error');
  const page = document.getElementById('landing-page');

  try {
    const config = await initSiteShell({ activeNav: 'home' });

    const tagline =
      config.tagline ||
      'Персональный код личности в Telegram: астрология, Human Design, нумерология, Сюцай и ведическая астрология — и ответы на ваши вопросы.';

    document.getElementById('landing-tagline').textContent = tagline;
    document.getElementById('landing-tariffs').textContent = config.packagesLine;

    if (config.welcomeBonusRequests > 0) {
      const bonus = document.getElementById('landing-bonus');
      bonus.textContent = `🎁 При первом запуске — ${formatQuestions(config.welcomeBonusRequests)} бесплатно.`;
      bonus.classList.remove('is-hidden');
    }

    const primaryCta = document.getElementById('landing-cta-primary');
    const secondaryCta = document.getElementById('landing-cta-secondary');
    if (config.botLink) {
      primaryCta.href = config.botLink;
      secondaryCta.href = config.botLink;
    }

    const descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) {
      descriptionMeta.setAttribute('content', tagline);
    }

    document.title = config.siteName;
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
