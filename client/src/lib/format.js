export const formatMoney = (amount, symbol = '₹') => {
  const n = Number(amount) || 0;
  const hasPaise = Math.round(n * 100) % 100 !== 0;
  return `${symbol}${n.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
};

export const discountPercent = (mrp, offer) =>
  mrp > 0 && offer < mrp ? Math.round(((mrp - offer) / mrp) * 100) : 0;

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Digits only, with India's country code added to bare 10-digit mobiles.
export const cleanPhone = (phone) => {
  let d = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10) d = `91${d}`;
  return d;
};

// Strip control, bidi-override and zero-width-space characters (keeps ZWJ/ZWNJ for emoji + Indic scripts) and cap length for free text sent to WhatsApp.
export const sanitizeText = (text, max = 1000) =>
  String(text || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200E\u200F\u2028-\u202E\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const toMinutes = (hhmm) => {
  const m = String(hhmm).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + min;
};

/**
 * Open/closed status (an i18n key + vars) from `opening_hours` ("09:00-21:00", supports overnight "18:00-02:00")
 * and `closed_days` ("Sun" or "Sat,Sun"), evaluated on the shopper's device clock.
 */
export function getOpenStatus(openingHours, closedDays, now = new Date()) {
  if (!openingHours) return null;
  const today = DAY_NAMES[now.getDay()];
  const closed = String(closedDays || '')
    .toLowerCase()
    .split(/[,\s]+/)
    .map((d) => d.slice(0, 3));
  if (closed.includes(today)) return { open: false, key: 'hours.closedToday', vars: {} };

  const [a, b] = String(openingHours).split(/\s*[-–to]+\s*/i);
  const start = toMinutes(a);
  const end = toMinutes(b);
  if (start === null || end === null) return null;
  const cur = now.getHours() * 60 + now.getMinutes();
  const open = start <= end ? cur >= start && cur < end : cur >= start || cur < end;
  return open
    ? { open, key: 'hours.openUntil', vars: { time: b.trim() } }
    : { open, key: 'hours.closedOpens', vars: { time: a.trim() } };
}

export const mapsLink = (url, address) => {
  if (url && /^https?:\/\//i.test(url)) return url;
  if (url && /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(url.trim()))
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(url.trim())}`;
  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return '';
};
