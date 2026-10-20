// Meta WhatsApp Cloud API webhook (used by OTP_PROVIDER=whatsapp_reply).
//   GET  /api/whatsapp/webhook  — Meta's one-time verification handshake (hub.verify_token)
//   POST /api/whatsapp/webhook  — incoming messages; signature-checked with the app secret (raw body)
import express, { Router } from 'express';
import { config } from '../config.js';
import { handleIncomingText, usesWhatsAppReply } from '../otp/whatsappReply.js';
import { incomingTexts, validSignature } from '../whatsapp/cloud.js';

export const whatsappRouter = Router();

whatsappRouter.get('/webhook', (req, res) => {
  const ok = req.query['hub.mode'] === 'subscribe' && config.whatsapp.verifyToken && req.query['hub.verify_token'] === config.whatsapp.verifyToken;
  if (!ok) return res.sendStatus(403);
  res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
});

whatsappRouter.post('/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!validSignature(raw, req.get('X-Hub-Signature-256'))) return res.sendStatus(401);
  // Acknowledge at once: Meta retries slow or failed webhooks.
  res.sendStatus(200);
  // The webhook can be connected in Meta before switching OTP_PROVIDER; until then, messages are just ignored.
  if (!usesWhatsAppReply()) return;
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return;
  }
  for (const msg of incomingTexts(payload)) {
    try {
      const result = await handleIncomingText(msg);
      if (result !== 'ignored') console.log(`[otp] whatsapp reply ${result} for …${msg.from.slice(-4)}`);
    } catch (err) {
      console.error('[otp] whatsapp webhook:', err.message);
    }
  }
});
