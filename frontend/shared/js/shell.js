export async function loadPublicConfig() {
  const response = await fetch('/api/public-config');
  if (!response.ok) {
    throw new Error('Не удалось загрузить настройки сайта');
  }
  return response.json();
}

export function setActiveNav(activeNav) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === activeNav);
  });
}

export function applyPublicConfig(config) {
  document.querySelectorAll('[data-site-name]').forEach((element) => {
    element.textContent = config.siteName;
  });

  const support = document.getElementById('support-link');
  if (support && config.paymentSupportUsername) {
    const username = config.paymentSupportUsername.replace(/^@/, '');
    support.href = `https://t.me/${username}`;
    support.textContent = config.paymentSupportUsername;
    support.closest('[data-support-row]')?.classList.remove('is-hidden');
  }
}

export async function initSiteShell({ activeNav = '', title = null, description = null } = {}) {
  const config = await loadPublicConfig();
  applyPublicConfig(config);
  setActiveNav(activeNav);

  if (title) {
    document.title = title === config.siteName ? config.siteName : `${title} — ${config.siteName}`;
  }

  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (description && descriptionMeta) {
    descriptionMeta.setAttribute('content', description);
  }

  return config;
}

export function formatQuestions(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 вопросов';
  }

  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${value} вопрос`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${value} вопроса`;
  }
  return `${value} вопросов`;
}
