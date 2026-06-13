import { config } from '../shared/config.js';
import { cookiesPageUrl, privacyPageUrl } from './html.js';
import { baseLegalReplacements, renderLegalPage } from './legal-page.js';

export function renderPrivacyPage() {
  const privacyUrl = privacyPageUrl();

  return renderLegalPage({
    title: 'Политика обработки персональных данных',
    description: `Политика обработки персональных данных сервиса ${config.publicSiteName}.`,
    activeNav: 'privacy',
    customFile: config.privacyPolicyFile,
    defaultFilename: 'privacy-policy.txt',
    replacements: baseLegalReplacements({
      privacyUrl,
      cookiesUrl: cookiesPageUrl(),
      updatedDate: config.privacyPolicyUpdated,
    }),
  });
}
