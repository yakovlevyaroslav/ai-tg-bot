import { config } from '../shared/config.js';
import { cookiesPageUrl, privacyPageUrl } from './html.js';
import { baseLegalReplacements, renderLegalPage } from './legal-page.js';

export function renderCookiesPage() {
  const cookiesUrl = cookiesPageUrl();

  return renderLegalPage({
    title: 'Политика использования cookie',
    description: `Политика использования файлов cookie на сайте ${config.publicSiteName}.`,
    activeNav: 'cookies',
    customFile: config.cookiesPolicyFile,
    defaultFilename: 'cookies-policy.txt',
    replacements: baseLegalReplacements({
      privacyUrl: privacyPageUrl(),
      cookiesUrl,
      updatedDate: config.cookiesPolicyUpdated,
    }),
  });
}
