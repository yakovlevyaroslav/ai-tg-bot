import { initSiteShell } from '../shell.js';
import {
  getVisitCardCodeFromPath,
  loadVisitCard,
  renderVisitCard,
  renderVisitCardNotFound,
} from '../visit-card.js';

export async function initVisitCardPage() {
  const loading = document.getElementById('visit-card-loading');
  const error = document.getElementById('visit-card-error');
  const code = getVisitCardCodeFromPath();

  if (!code) {
    loading?.classList.add('is-hidden');
    if (error) {
      error.textContent = 'Некорректный код визитки';
      error.classList.remove('is-hidden');
    }
    return;
  }

  try {
    const config = await initSiteShell({ activeNav: '' });
    const card = await loadVisitCard(code);

    if (!card) {
      renderVisitCardNotFound(config);
      return;
    }

    renderVisitCard(card);
  } catch (err) {
    loading?.classList.add('is-hidden');
    if (error) {
      error.textContent = err?.message ?? 'Ошибка загрузки';
      error.classList.remove('is-hidden');
    }
  }
}
