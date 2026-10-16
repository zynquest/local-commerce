import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { clientKey } from './clientIp.js';
import { config } from './config.js';
import { query } from './db.js';
import { errorHandler, forbidden, notFound } from './errors.js';
import { merchantRouter } from './routes/merchant.js';
import { merchantAppointmentsRouter, publicAppointmentsRouter } from './routes/appointments.js';
import { otpRouter } from './routes/otp.js';
import { platformRouter } from './routes/platform.js';
import { authRouter } from './routes/auth.js';
import { customerRouter } from './routes/customer.js';
import { publicRouter } from './routes/public.js';
import { loadTemplate, robots, seoHandler, sitemap } from './seo.js';

/** Blocks cross-site state-changing requests (defence in depth on top of SameSite=Lax cookies). */
function originGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('Origin');
  if (!origin) return next(); // non-browser clients
  let host;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    throw forbidden('Bad origin');
  }
  const sameHost = host === String(req.get('Host') || '').toLowerCase();
  if (sameHost || config.appOrigins.includes(origin.toLowerCase())) return next();
  throw forbidden('Cross-site request blocked');
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          workerSrc: ["'self'", 'blob:'],
          // Google Maps JS API (address search, map pin) loads its scripts and calls these hosts.
          scriptSrc: ["'self'", 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
          connectSrc: ["'self'", 'https://maps.googleapis.com', 'https://places.googleapis.com', 'https://*.googleapis.com', 'https://maps.gstatic.com'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: clientKey, message: { error: 'Too many attempts. Try again in a few minutes.' } });

  app.get('/api/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ ok: true });
  });
  app.use('/api', originGuard);
  app.use(
    ['/api/auth/login', '/api/auth/register', '/api/customer/login', '/api/customer/register'],
    authLimiter,
  );
  app.use('/api/auth', authRouter);
  app.use('/api/merchant', merchantRouter);
  app.use('/api/merchant', merchantAppointmentsRouter);
  app.use('/api/platform', platformRouter);
  app.use('/api/otp', otpRouter);
  app.use('/api/customer', customerRouter);
  app.use('/api', publicAppointmentsRouter);
  app.use('/api', publicRouter);
  app.use('/api', (_req, _res, next) => next(notFound('Unknown API route')));

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '365d', immutable: true, fallthrough: false }));

  app.get('/robots.txt', robots);
  app.get('/sitemap.xml', sitemap);

  // Production: serve the built PWA (same origin as the API) with SEO-rendered SPA fallback.
  if (fs.existsSync(config.clientDist)) {
    loadTemplate();
    app.use(express.static(config.clientDist, { index: false, setHeaders: (res, file) => {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    } }));
    app.get(/^\/(?!api\/|uploads\/).*/, seoHandler);
  }

  app.use(errorHandler);
  return app;
}
