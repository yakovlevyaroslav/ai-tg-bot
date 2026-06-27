import express from 'express';
import { config } from '../shared/config.js';
import { getPublishedVisitCard } from '../shared/db.js';
import { formatPackagesLine } from '../shared/pricing.js';
import {
  BOT_START_QUESTIONS,
  buildBotStartLink,
  buildVisitCardCodeBreakdown,
  buildVisitCardPublicUrl,
} from '../shared/visit-card.js';
import { cookiesPageUrl, privacyPageUrl } from './html.js';
import {
  baseLegalReplacements,
  buildLegalPageData,
} from './legal-page.js';

export function getPublicSiteConfig() {
  return {
    siteName: config.publicSiteName,
    tagline: config.publicSiteTagline,
    botLink: config.publicBotLink,
    botUsername: config.publicBotUsername,
    packagesLine: formatPackagesLine(null),
    welcomeBonusRequests: config.welcomeBonusRequests,
    paymentSupportUsername: config.paymentSupportUsername,
  };
}

export function getPrivacyPageData() {
  const privacyUrl = privacyPageUrl();

  return buildLegalPageData({
    title: 'Политика обработки персональных данных',
    description: `Политика обработки персональных данных сервиса ${config.publicSiteName}.`,
    customFile: config.privacyPolicyFile,
    defaultFilename: 'privacy-policy.txt',
    replacements: baseLegalReplacements({
      privacyUrl,
      cookiesUrl: cookiesPageUrl(),
      updatedDate: config.privacyPolicyUpdated,
    }),
  });
}

export function getCookiesPageData() {
  const cookiesUrl = cookiesPageUrl();

  return buildLegalPageData({
    title: 'Политика использования cookie',
    description: `Политика использования файлов cookie на сайте ${config.publicSiteName}.`,
    customFile: config.cookiesPolicyFile,
    defaultFilename: 'cookies-policy.txt',
    replacements: baseLegalReplacements({
      privacyUrl: privacyPageUrl(),
      cookiesUrl,
      updatedDate: config.cookiesPolicyUpdated,
    }),
  });
}

export async function getVisitCardApiPayload(code) {
  const card = await getPublishedVisitCard(code);
  if (!card) {
    return null;
  }

  return {
    personalityCode: card.personality_code,
    breakdown: buildVisitCardCodeBreakdown(card.onboarding_data ?? {}),
    content: card.visit_card_content ?? '',
    shareUrl: buildVisitCardPublicUrl(card.personality_code),
    askBotLink: buildBotStartLink(BOT_START_QUESTIONS),
    botLink: config.publicBotLink,
    botUsername: config.publicBotUsername,
  };
}

export function createPublicApiRouter() {
  const router = express.Router();

  router.get('/public-config', (_req, res) => {
    res.json(getPublicSiteConfig());
  });

  router.get('/legal/privacy', (_req, res) => {
    res.json(getPrivacyPageData());
  });

  router.get('/legal/cookies', (_req, res) => {
    res.json(getCookiesPageData());
  });

  router.get('/visit-card/:code', async (req, res) => {
    try {
      const payload = await getVisitCardApiPayload(req.params.code);
      if (!payload) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json(payload);
    } catch (err) {
      console.error('[site] visit card api error:', err?.message ?? err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
