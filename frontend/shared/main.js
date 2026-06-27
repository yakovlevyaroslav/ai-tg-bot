import 'reset-css/reset.css';
import './main.scss';

const PAGE_BOOTSTRAP = {
  landing: () => import('./js/pages/landing.js').then((m) => m.initLandingPage()),
  privacy: () => import('./js/legal.js').then((m) => m.renderLegalPage('privacy', { activeNav: 'privacy' })),
  cookies: () => import('./js/legal.js').then((m) => m.renderLegalPage('cookies', { activeNav: 'cookies' })),
  onboarding: () => import('./js/pages/onboarding.js').then((m) => m.initOnboardingPage()),
  'visit-card': () => import('./js/pages/visit-card-page.js').then((m) => m.initVisitCardPage()),
};

const page = document.body.dataset.page;
const boot = PAGE_BOOTSTRAP[page];

if (boot) {
  boot();
} else {
  console.warn('[site] unknown page:', page);
}
