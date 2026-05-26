import express from 'express';
import { config } from '../config.js';
import { createAdminRouter } from './routes.js';

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

export function startAdminServer() {
  if (!config.adminWebEnabled) {
    console.log('Admin panel disabled (set ADMIN_WEB_PASSWORD in .env)');
    return null;
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));

  // Браузер часто запрашивает /favicon.ico — без этого в логах «мигает» 404
  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  app.get('/', (_req, res) => {
    res.redirect('/admin');
  });

  app.use('/admin', basicAuth, createAdminRouter());

  const server = app.listen(config.adminWebPort, () => {
    console.log(`Admin panel: http://localhost:${config.adminWebPort}/admin`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Admin port ${config.adminWebPort} is busy. Change ADMIN_WEB_PORT in .env (e.g. 3080, 3001, 8080)`,
      );
    } else {
      console.error('Admin server error:', err);
    }
  });

  return server;
}

export function stopAdminServer(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}
