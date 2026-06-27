import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config } from '../shared/config.js';
import { createAdminRouter } from './admin/routes.js';
import { createYookassaWebhookHandler } from '../shared/yookassa/webhook.js';
import { createPublicApiRouter } from './public-api.js';

const distPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../dist',
);

const publicPages = {
  '/': 'landing/landing.html',
  '/privacy': 'privacy/privacy.html',
  '/cookies': 'cookies/cookies.html',
  '/onboarding': 'onboarding/onboarding.html',
};

function sendBuiltPage(res, pagePath) {
  const absolute = path.join(distPath, pagePath);
  if (!existsSync(absolute)) {
    res
      .status(503)
      .type('html')
      .send(
        'Frontend не собран. Запустите: npm run build:frontend',
      );
    return;
  }
  res.sendFile(absolute);
}

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

export function startSiteServer() {
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

  app.use('/api', createPublicApiRouter());

  app.post(
    config.yookassaWebhookPath,
    createYookassaWebhookHandler(),
  );

  if (config.adminWebEnabled) {
    app.use('/admin', basicAuth, createAdminRouter());
  }

  if (existsSync(distPath)) {
    app.use(express.static(distPath, { index: false }));
  }

  for (const [route, pagePath] of Object.entries(publicPages)) {
    app.get(route, (_req, res) => sendBuiltPage(res, pagePath));
  }

  app.get('/code/:code', (_req, res) => {
    sendBuiltPage(res, 'visit-card/visit-card.html');
  });

  const server = app.listen(config.adminWebPort, config.adminWebHost, () => {
    const host = config.adminWebHost === '0.0.0.0' ? 'localhost' : config.adminWebHost;
    console.log(`Site: http://${host}:${config.adminWebPort}/`);
    if (!existsSync(distPath)) {
      console.warn('[site] dist/ not found — run npm run build:frontend');
    }
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
