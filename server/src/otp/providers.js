// OTP delivery providers, selected with OTP_PROVIDER. Each provider has:
//   delivery: 'sms'     → code reaches the user's phone directly (real gateway)
//             'manual'  → code goes to the platform team, who relay it on WhatsApp (temporary setup)
//             'dev'     → local development only (fixed code / console log)
//             'whatsapp'       → code pushed to the user's WhatsApp (Meta authentication template, paid)
//             'whatsapp_reply' → user messages our WhatsApp first; the code comes back as a reply (free)
//   code():   optional, returns the code to use (default: random 6 digits)
//   send(phone, code, purpose, meta)
//
//             'sms'            → real SMS via Fast2SMS's OTP route (no DLT registration needed, paid per SMS)
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { makeServerT } from '../i18n.js';
import { sendOtpTemplate, sendText } from '../whatsapp/cloud.js';
import { sendOtpSms } from './fast2sms.js';

export const PURPOSE_LABELS = {
  owner_login: 'Store owner login',
  owner_register: 'New store registration',
  customer_login: 'Customer login',
  customer_register: 'Customer sign-up',
  whatsapp_change: 'WhatsApp number change',
};

const national = (phone) => String(phone).replace(/^91/, '');
const pretty = (phone) => `+91 ${national(phone).slice(0, 5)} ${national(phone).slice(5)}`;

let transporter;
function smtp() {
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transporter;
}

export const providers = {
  /** Local development: every code is OTP_FIXED_CODE (default 898989). Refused in production (see config.js). */
  fixed: {
    delivery: 'dev',
    code: () => config.otpFixedCode,
    async send(phone, code, purpose) {
      console.log(`[otp] (fixed) ${PURPOSE_LABELS[purpose] || purpose} for ${pretty(phone)}: ${code}`);
    },
  },

  /** Logs a random code to the server console. Development only. */
  console: {
    delivery: 'dev',
    async send(phone, code, purpose) {
      console.log(`[otp] ${PURPOSE_LABELS[purpose] || purpose} code for ${pretty(phone)}: ${code}`);
    },
  },

  /**
   * Temporary production setup until an SMS gateway is available: each code is emailed to the platform
   * team (OTP_EMAIL_TO) via SMTP (Google). The user WhatsApps the support number and the team replies with
   * the code — the email includes a one-tap WhatsApp link to that user's number with the message prefilled.
   */
  email: {
    delivery: 'manual',
    async send(phone, code, purpose, meta = {}) {
      const label = PURPOSE_LABELS[purpose] || purpose;
      const replyText = `Your ${config.platformName} OTP is ${code}. It expires in 10 minutes. Do not share it with anyone.`;
      const waLink = `https://wa.me/${phone}?text=${encodeURIComponent(replyText)}`;
      const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
      const rows = [
        ['Mobile', pretty(phone)],
        ['Purpose', label],
        ...(meta.name ? [['Name', meta.name]] : []),
        ['OTP', code],
        ['Expires', 'in 10 minutes'],
        ['Requested', `${when} IST`],
        ...(meta.ip ? [['IP', meta.ip]] : []),
      ];
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      await smtp().sendMail({
        from: config.smtp.from,
        to: config.otpEmailTo,
        subject: `OTP ${code} · ${pretty(phone)} · ${label}`,
        text: `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nForward on WhatsApp: ${waLink}\n\nMessage to send:\n${replyText}\n`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px">
<p style="margin:0 0 12px">${esc(label)} — relay this code to the user on WhatsApp.</p>
<table cellpadding="6" style="border-collapse:collapse">${rows
          .map(([k, v]) => `<tr><td style="color:#666">${esc(k)}</td><td><b style="${k === 'OTP' ? 'font-size:22px;letter-spacing:4px' : ''}">${esc(v)}</b></td></tr>`)
          .join('')}</table>
<p style="margin:16px 0"><a href="${esc(waLink)}" style="background:#25d366;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Send OTP to ${esc(pretty(phone))} on WhatsApp</a></p>
<p style="color:#666;font-size:13px">Only send this code to the WhatsApp number shown above.</p></div>`,
      });
    },
  },

  /**
   * WhatsApp, business-initiated: an approved AUTHENTICATION template via Meta's Cloud API. Instant, like SMS,
   * but charged per delivered message (≈ ₹0.115 + GST in India, 2026).
   */
  whatsapp: {
    delivery: 'whatsapp',
    async send(phone, code) {
      await sendOtpTemplate(phone, code);
    },
  },

  /**
   * WhatsApp, user-initiated (free): the user taps "Get code on WhatsApp", sends us a pre-filled message with a
   * request token, and our webhook (routes/whatsapp.js) replies with the code. Replies inside the 24-hour
   * customer service window are free on Meta's Cloud API. The message also proves they control that number.
   */
  whatsapp_reply: {
    delivery: 'whatsapp_reply',
    async send(phone, code, purpose, meta = {}) {
      const t = makeServerT(meta.language || 'en');
      await sendText(phone, t('otp.waCode', { code, brand: config.platformName }));
    },
  },

  /**
   * Real SMS through Fast2SMS's OTP route (Deployment.md §B14). Fast2SMS sends "Your OTP: 123456" from its own
   * DLT-registered template and sender ID, so the platform needs no DLT registration. Prepaid, a few paise per SMS.
   * Needs FAST2SMS_API_KEY. To use another gateway, swap sendOtpSms for its API: nothing else in the app changes.
   */
  sms: {
    delivery: 'sms',
    async send(phone, code) {
      await sendOtpSms(phone, code);
    },
  },
};

export function getProvider(name = config.otpProvider) {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown OTP_PROVIDER "${name}"`);
  return provider;
}
