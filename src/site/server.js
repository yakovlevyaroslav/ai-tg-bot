import express from 'express';
import { config } from '../shared/config.js';
import { createAdminRouter } from './admin/routes.js';
import { createYookassaWebhookHandler } from '../shared/yookassa/webhook.js';
import { renderLandingPage } from './landing.js';
import { renderPrivacyPage } from './privacy.js';
import { renderCookiesPage } from './cookies.js';
import { renderVisitCardPage, renderVisitCardNotFoundPage } from './visit-card-page.js';
import { renderOnboardingStubPage } from './onboarding-page.js';
import { getPublishedVisitCard } from '../shared/db.js';

function basicAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="AI Bot Admin"');
    res.status(401).send('Требуется авторизация');
    return;
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);

  if (user === config.adminWebUser && pass === config.adminWebPassword) {
    next();
    return;
  }

  res.set('WWW-Authenticate', 'Basic realm="AI Bot Admin"');
  res.status(401).send('Неверный логин или пароль');
}

export function startSiteServer({ onPaymentSuccess } = {}) {
  if (!config.webServerEnabled) {
    console.log('Site server disabled');
    return null;
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.get('/', (_req, res) => {
    res.type('html').send(renderLandingPage());
  });

  app.get('/privacy', (_req, res) => {
    res.type('html').send(renderPrivacyPage());
  });

  app.get('/cookies', (_req, res) => {
    res.type('html').send(renderCookiesPage());
  });

  app.get('/onboarding', (_req, res) => {
    res.type('html').send(renderOnboardingStubPage());
  });

  app.get('/code/:code', async (req, res) => {
    try {
      const card = await getPublishedVisitCard(req.params.code);
      if (!card) {
        res.status(404).type('html').send(renderVisitCardNotFoundPage());
        return;
      }
      res.type('html').send(renderVisitCardPage(card));
    } catch (err) {
      console.error('[site] visit card error:', err?.message ?? err);
      res.status(500).send('Ошибка загрузки страницы');
    }
  });

  app.post(
    config.yookassaWebhookPath,
    createYookassaWebhookHandler({ notifyUser: onPaymentSuccess }),
  );

  if (config.adminWebEnabled) {
    app.use('/admin', basicAuth, createAdminRouter());
  }

  const server = app.listen(config.adminWebPort, config.adminWebHost, () => {
    const host = config.adminWebHost === '0.0.0.0' ? 'localhost' : config.adminWebHost;
    console.log(`Site: http://${host}:${config.adminWebPort}/`);
    if (config.adminWebEnabled) {
      console.log(`Admin panel: http://${host}:${config.adminWebPort}/admin`);
    }
    const webhookUrl = config.publicSiteUrl
      ? `${config.publicSiteUrl}${config.yookassaWebhookPath}`
      : `http://${host}:${config.adminWebPort}${config.yookassaWebhookPath}`;
    console.log(`YooKassa webhook: POST ${webhookUrl}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${config.adminWebPort} is busy. Change ADMIN_WEB_PORT in .env`,
      );
    } else {
      console.error('Site server error:', err);
    }
  });

  return server;
}

export function stopSiteServer(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

/** @deprecated use startSiteServer */
export const startAdminServer = startSiteServer;
export const stopAdminServer = stopSiteServer;
