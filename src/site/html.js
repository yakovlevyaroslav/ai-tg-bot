import { config } from '../shared/config.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function privacyPageUrl() {
  if (config.privacyPolicyUrl) {
    return config.privacyPolicyUrl;
  }
  if (config.publicSiteUrl) {
    return `${config.publicSiteUrl}/privacy`;
  }
  return '/privacy';
}

export function cookiesPageUrl() {
  if (config.cookiesPolicyUrl) {
    return config.cookiesPolicyUrl;
  }
  if (config.publicSiteUrl) {
    return `${config.publicSiteUrl}/cookies`;
  }
  return '/cookies';
}
