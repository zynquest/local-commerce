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
  // Google Sign-In (OAuth web client ID, public). Owners and shoppers can sign in with Google; set GOOGLE_CLIENT_ID=
  // (empty) to turn it off. The client's Authorized JavaScript origins must list every site origin (Deployment.md §B22).
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '754008456964-dqo6ro2fn6hqcejvtoa7djpe1i8sq5ev.apps.googleusercontent.com',
  googleMapId: process.env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID',
  // Shoppers see businesses within this distance of their location.
  nearbyRadiusKm: Math.min(50, Math.max(1, Number(process.env.NEARBY_RADIUS_KM) || 10)),
  // Optional search-engine ownership tokens (the content="" value of the verification meta tag).
  googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION || '',
  bingSiteVerification: process.env.BING_SITE_VERIFICATION || '',

  // Login is mobile number + OTP for store owners and customers (the platform admin uses the CLI-created password).
  // OTP_PROVIDER: fixed (local, code 898989) · email (temporary prod: codes emailed to the team, relayed on
  // WhatsApp) · whatsapp (Meta Cloud API authentication template, paid per OTP) · whatsapp_reply (free: the user
  // messages us first, we reply with the code) · sms (Fast2SMS OTP route, paid per SMS, no DLT) · console (dev log).
  otpProvider: process.env.OTP_PROVIDER || (process.env.NODE_ENV === 'production' ? 'email' : 'fixed'),
  otpFixedCode: process.env.OTP_FIXED_CODE || '898989',
  // How shoppers identify themselves: 'email' (code emailed directly, needs SMTP) or 'mobile' (10-digit number,
  // code delivered by OTP_PROVIDER like owners' codes). Owners always use mobile.
  customerLogin: process.env.CUSTOMER_LOGIN || 'email',
  // How store owners register and log in: 'email' (code emailed, default) or 'mobile' (10-digit number, code via
  // OTP_PROVIDER). With email, the store's WhatsApp number is given when submitting for approval and is verified
  // when the platform approves the store.
  ownerLogin: process.env.OWNER_LOGIN || 'email',
  otpEmailTo: process.env.OTP_EMAIL_TO || 'creativebunnyofficial@gmail.com',
  // WhatsApp number users message to receive their OTP while codes are relayed manually.
  otpHelpWhatsApp: (process.env.OTP_HELP_WHATSAPP || '919353095481').replace(/\D/g, ''),
  // WhatsApp OTP through Meta's WhatsApp Cloud API (OTP_PROVIDER=whatsapp | whatsapp_reply). See Deployment.md §B20.
  whatsapp: {
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v23.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '', // verifies webhook signatures
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '', // any random string; also entered in the Meta app's webhook settings
    // The business number customers message in reply mode (digits with country code), e.g. 919353095481.
    businessNumber: (process.env.WHATSAPP_BUSINESS_NUMBER || process.env.OTP_HELP_WHATSAPP || '919353095481').replace(/\D/g, ''),
    // Template mode: an approved AUTHENTICATION template with a copy-code button.
    otpTemplate: process.env.WHATSAPP_OTP_TEMPLATE || '',
    otpTemplateLang: process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'en',
  },
  // SMS OTPs through Fast2SMS's OTP route (OTP_PROVIDER=sms). API key from fast2sms.com → Dev API. See Deployment.md §B14.
  fast2sms: {
    apiKey: process.env.FAST2SMS_API_KEY || '',
  },
  // WhatsApp OTPs through MSG91 (OTP_PROVIDER=msg91_whatsapp): auth key (Settings → API Keys), the WhatsApp number
  // connected in the MSG91 panel, and the approved authentication template's name. See Deployment.md §B20.
  msg91: {
    authKey: process.env.MSG91_AUTH_KEY || '',
    whatsappNumber: (process.env.MSG91_WHATSAPP_NUMBER || '').replace(/\D/g, ''),
    template: process.env.MSG91_WHATSAPP_TEMPLATE || '',
    templateLang: process.env.MSG91_WHATSAPP_TEMPLATE_LANG || 'en',
    namespace: process.env.MSG91_WHATSAPP_NAMESPACE || '', // optional, shown with the template in the MSG91 panel
  },
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: (process.env.SMTP_SECURE || 'true') !== 'false',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },
};


/** Fails fast on unsafe or incomplete OTP setups (called at server start). */
export function assertOtpConfig() {
  const p = config.otpProvider;
  if (!['fixed', 'console', 'email', 'sms', 'whatsapp', 'whatsapp_reply', 'msg91_whatsapp'].includes(p)) throw new Error(`Unknown OTP_PROVIDER "${p}"`);
  if (!['email', 'mobile'].includes(config.customerLogin)) throw new Error(`CUSTOMER_LOGIN must be "email" or "mobile", not "${config.customerLogin}"`);
  if (!['email', 'mobile'].includes(config.ownerLogin)) throw new Error(`OWNER_LOGIN must be "email" or "mobile", not "${config.ownerLogin}"`);
  const wa = config.whatsapp;
  if (p === 'whatsapp' || p === 'whatsapp_reply') {
    const missing = [
      ['WHATSAPP_PHONE_NUMBER_ID', wa.phoneNumberId],
      ['WHATSAPP_ACCESS_TOKEN', wa.accessToken],
      ...(p === 'whatsapp' ? [['WHATSAPP_OTP_TEMPLATE', wa.otpTemplate]] : []),
      ...(p === 'whatsapp_reply' ? [['WHATSAPP_APP_SECRET', wa.appSecret], ['WHATSAPP_VERIFY_TOKEN', wa.verifyToken]] : []),
    ].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`OTP_PROVIDER=${p} needs ${missing.join(', ')} (Deployment.md §B20).`);
  }
  if (config.isProd && (p === 'fixed' || p === 'console')) {
    throw new Error(`OTP_PROVIDER=${p} is for local development only. Use "email", "sms" or a WhatsApp provider in production.`);
  }
  if (p === 'sms' && !config.fast2sms.apiKey) {
    throw new Error('OTP_PROVIDER=sms needs FAST2SMS_API_KEY (fast2sms.com → Dev API; Deployment.md §B14).');
  }
  if (p === 'msg91_whatsapp') {
    const missing = [['MSG91_AUTH_KEY', config.msg91.authKey], ['MSG91_WHATSAPP_NUMBER', config.msg91.whatsappNumber], ['MSG91_WHATSAPP_TEMPLATE', config.msg91.template]]
      .filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`OTP_PROVIDER=msg91_whatsapp needs ${missing.join(', ')} (MSG91 panel; Deployment.md §B20).`);
  }
  const emailLogins = config.customerLogin === 'email' || config.ownerLogin === 'email';
  if ((p === 'email' || (config.isProd && emailLogins)) && (!config.smtp.user || !config.smtp.pass)) {
    throw new Error('SMTP_USER and SMTP_PASS (Gmail address + App Password) are required for OTP_PROVIDER=email, CUSTOMER_LOGIN=email and OWNER_LOGIN=email.');
  }
}
