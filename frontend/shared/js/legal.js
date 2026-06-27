import { initSiteShell } from './shell.js';

export async function loadLegalPage(kind) {
  const response = await fetch(`/api/legal/${kind}`);
  if (!response.ok) {
    throw new Error('Не удалось загрузить страницу');
  }
  return response.json();
}

export async function renderLegalPage(kind, { activeNav }) {
  const page = document.getElementById('legal-page');
  const loading = document.getElementById('legal-loading');
  const error = document.getElementById('legal-error');

  try {
    await initSiteShell({ activeNav });
    const data = await loadLegalPage(kind);
    document.title =
      data.title === data.siteName ? data.title : `${data.title} — ${data.siteName}`;

    const descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) {
      descriptionMeta.setAttribute('content', data.description);
    }

    page.innerHTML = data.bodyHtml;
    page.classList.remove('is-hidden');
    loading?.classList.add('is-hidden');
  } catch (err) {
    loading?.classList.add('is-hidden');
    if (error) {
      error.textContent = err?.message ?? 'Ошибка загрузки';
      error.classList.remove('is-hidden');
    }
  }
}
