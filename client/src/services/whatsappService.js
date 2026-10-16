// WhatsApp Order Synthesis: itemised order text (WhatsApp Markdown) → wa.me deep link.
import { cleanPhone, formatMoney, round2, sanitizeText } from '../lib/format.js';
import { makeT } from '../i18n/index.jsx';
import { intlLocale } from '../i18n/languages.js';

const DIVIDER = '--------------------------------';

export function generateOrderId() {
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase();
  return `ORD-${rand.padStart(6, '0').slice(-6)}`;
}

export function computeTotals(cartItems, storeConfig) {
  let subtotal = 0;
  let savings = 0;
  for (const item of cartItems) {
    subtotal += item.offer_price * item.quantity;
    if (item.mrp > item.offer_price) savings += (item.mrp - item.offer_price) * item.quantity;
  }
  const hasItems = cartItems.length > 0;
  const deliveryFee = hasItems ? Number(storeConfig.delivery_fee) || 0 : 0;
  return {
    subtotal: round2(subtotal),
    savings: round2(savings),
    deliveryFee,
    total: round2(subtotal + deliveryFee),
  };
}

/** Language of the WhatsApp order message: the store's fixed choice, or the customer's language when 'auto'. */
export const orderMessageLanguage = (storeConfig, customerLang = 'en') =>
  !storeConfig?.order_language || storeConfig.order_language === 'auto' ? customerLang : storeConfig.order_language;

/**
 * Builds the WhatsApp message body. `t` is a translator for the store's order language (defaults to English).
 * WhatsApp Markdown (*bold*, _italic_) wraps the translated labels.
 * Returns { orderId, message, totals, itemsSummary, notes }.
 */
export function buildOrderMessage(storeConfig, cartItems, unlistedNotes, customerInfo = {}, { orderId = generateOrderId(), t = makeT('en') } = {}) {
  const lang = storeConfig.order_language || 'en';
  const cur = storeConfig.currency_symbol || '₹';
  const money = (n) => formatMoney(n, cur);
  const date = new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const totals = computeTotals(cartItems, storeConfig);
  const notes = sanitizeText(unlistedNotes);

  let m = `🛍️ *${t('wa.newOrder', { code: orderId })}*\n`;
  m += `🏪 *${t('wa.store')}:* ${storeConfig.name}\n`;
  m += `📅 *${t('wa.time')}:* ${date}\n`;
  m += `${DIVIDER}\n\n`;

  if (cartItems.length) {
    m += `📦 *${t('wa.items')}:*\n`;
    cartItems.forEach((item, idx) => {
      const lineTotal = round2(item.offer_price * item.quantity);
      const lineSavings = round2((item.mrp - item.offer_price) * item.quantity);
      m += `${idx + 1}. *${item.name}*\n`;
      m += `   ${t('wa.qty')}: ${item.quantity} × ${money(item.offer_price)} = *${money(lineTotal)}*`;
      if (item.mrp > item.offer_price) m += ` _(${t('wa.saved', { amount: money(lineSavings) })})_`;
      m += `\n\n`;
    });
    m += `${DIVIDER}\n`;
    m += `💵 *${t('wa.subtotal')}:* ${money(totals.subtotal)}\n`;
    if (totals.deliveryFee > 0) m += `🛵 *${t('wa.deliveryFee')}:* ${money(totals.deliveryFee)}\n`;
    m += `💰 *${t('wa.total')}: ${money(totals.total)}*\n`;
    if (totals.savings > 0) m += `🎉 *${t('wa.totalSavings')}: ${money(totals.savings)}*\n`;
    m += `${DIVIDER}\n\n`;
  }

  if (notes) {
    m += `📝 *${t('wa.notes')}:*\n${notes}\n\n`;
  }

  const name = sanitizeText(customerInfo.name, 80);
  const address = sanitizeText(customerInfo.address, 300);
  const phone = sanitizeText(customerInfo.phone, 20);
  if (name || address || phone) {
    m += `👤 *${t('wa.delivery')}:*\n`;
    if (name) m += `${t('wa.name')}: ${name}\n`;
    if (phone) m += `${t('wa.phone')}: ${phone}\n`;
    if (address) m += `${t('wa.address')}: ${address}\n`;
    m += `${DIVIDER}\n\n`;
  }

  m += `_${t('wa.footer', { store: storeConfig.name })}_`;

  const itemsSummary = cartItems
    .map((i) => `${i.sku_id} × ${i.quantity} = ${round2(i.offer_price * i.quantity)}`)
    .join('; ');

  return { orderId, message: m, totals, itemsSummary, notes };
}

/** Official click-to-chat link. encodeURIComponent turns "\n" into %0A for WhatsApp app + Web. */
/**
 * WhatsApp message for an appointment request (sent by the customer to the business after the slot is held).
 * `t` translates labels into the message language; `fmt` formats the date and clock times for that language.
 */
export function buildBookingMessage(storeConfig, appt, { t = makeT('en'), formatDay, formatClock } = {}) {
  const cur = storeConfig.currency_symbol || '₹';
  const day = formatDay ? formatDay(appt.date) : appt.date;
  const clock = (x) => (formatClock ? formatClock(x) : x);
  let m = `📅 *${t('wa.apptRequest', { code: appt.code })}*\n`;
  m += `🏪 *${t('wa.store')}:* ${storeConfig.name}\n`;
  m += `${DIVIDER}\n`;
  m += `✨ *${t('wa.apptService')}:* ${appt.service_name} (${t('appt.minutes', { count: appt.duration_min })}) — ${formatMoney(appt.price, cur)}\n`;
  m += `👤 *${t('wa.apptSpecialist')}:* ${appt.specialist_name}\n`;
  m += `🗓️ *${t('wa.apptDate')}:* ${day}\n`;
  m += `⏰ *${t('wa.apptTime')}:* ${clock(appt.time)} – ${clock(appt.end_time)}\n`;
  m += `${DIVIDER}\n`;
  m += `🙋 *${t('wa.name')}:* ${sanitizeText(appt.customer_name)}\n`;
  m += `📞 *${t('wa.phone')}:* +${appt.customer_phone}\n`;
  if (appt.notes) m += `📝 *${t('wa.notes')}:* ${sanitizeText(appt.notes)}\n`;
  m += `\n${t('wa.apptPleaseConfirm')}`;
  return m;
}

export const whatsappLink = (phone, message = '') =>
  `https://wa.me/${cleanPhone(phone)}${message ? `?text=${encodeURIComponent(message)}` : ''}`;

export function compileWhatsAppOrder(storeConfig, cartItems, unlistedNotes, customerInfo, t) {
  const order = buildOrderMessage(storeConfig, cartItems, unlistedNotes, customerInfo, { t });
  return { ...order, url: whatsappLink(storeConfig.whatsapp_number, order.message) };
}
