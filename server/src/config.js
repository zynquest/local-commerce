import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const list = (v, fallback) => (v || fallback).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT) || 4000,
  isProd: process.env.NODE_ENV === 'production',
  databaseUrl: process.env.DATABASE_URL || 'postgres://vfl:vfl_local_dev@localhost:5433/vocal_for_local',
  appOrigins: list(process.env.APP_ORIGINS, 'http://localhost:5173,http://127.0.0.1:5173'),
  platformHosts: list(process.env.PLATFORM_HOSTS, 'localhost,127.0.0.1'),
  // Header carrying the real client IP when behind a CDN (e.g. CF-Connecting-IP). Only set this when the
  // origin is reachable exclusively through that CDN (firewall), otherwise clients could spoof it.
  clientIpHeader: (process.env.CLIENT_IP_HEADER || '').toLowerCase(),
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || './uploads'),
  clientDist: path.resolve(root, '../client/dist'),
  sessionDays: 30,
  adminSessionHours: 12,
  bcryptRounds: 12,
  freeSkuLimit: 50,
  minProductsForReview: 1,
  platformName: process.env.PLATFORM_NAME || 'Vocal For Local',
  // Canonical public origin for SEO (sitemap, canonical URLs, Open Graph). Falls back to the request host.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  // Demo stores (npm run demo:create) always take orders on the company WhatsApp — fixed on purpose, not configurable.
  demoWhatsApp: '919353095481',
  // Google Maps (address search for merchants, "near me" for shoppers). A browser key restricted to your domain;
  // enable Maps JavaScript API, Places API (New) and Geocoding API. Without it, addresses are typed and the pin
  // comes from the phone's GPS.
  googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
  googleMapId: process.env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID',
  // Shoppers see businesses within this distance of their location.
  nearbyRadiusKm: Math.min(50, Math.max(1, Number(process.env.NEARBY_RADIUS_KM) || 5)),
  // Optional search-engine ownership tokens (the content="" value of the verification meta tag).
  googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION || '',
  bingSiteVerification: process.env.BING_SITE_VERIFICATION || '',

  // Login is mobile number + OTP for store owners and customers (the platform admin uses the CLI-created password).
  // OTP_PROVIDER: fixed (local, code 898989) · email (temporary prod: codes emailed to the team, relayed on
  // WhatsApp) · sms (real gateway, see src/otp/providers.js) · console (dev log).
  otpProvider: process.env.OTP_PROVIDER || (process.env.NODE_ENV === 'production' ? 'email' : 'fixed'),
  otpFixedCode: process.env.OTP_FIXED_CODE || '898989',
  otpEmailTo: process.env.OTP_EMAIL_TO || 'creativebunnyofficial@gmail.com',
  // WhatsApp number users message to receive their OTP while codes are relayed manually.
  otpHelpWhatsApp: (process.env.OTP_HELP_WHATSAPP || '919353095481').replace(/\D/g, ''),
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: (process.env.SMTP_SECURE || 'true') !== 'false',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },
};

// Local development with a dev provider: the code is also returned to the UI so it can be shown as a hint.
config.exposeDevOtp = !config.isProd && ['fixed', 'console'].includes(config.otpProvider);

/** Fails fast on unsafe or incomplete OTP setups (called at server start). */
export function assertOtpConfig() {
  const p = config.otpProvider;
  if (!['fixed', 'console', 'email', 'sms'].includes(p)) throw new Error(`Unknown OTP_PROVIDER "${p}"`);
  if (config.isProd && (p === 'fixed' || p === 'console')) {
    throw new Error(`OTP_PROVIDER=${p} is for local development only. Use "email" (or "sms") in production.`);
  }
  if (p === 'email' && (!config.smtp.user || !config.smtp.pass)) {
    throw new Error('OTP_PROVIDER=email needs SMTP_USER and SMTP_PASS (Gmail address + App Password).');
  }
}
