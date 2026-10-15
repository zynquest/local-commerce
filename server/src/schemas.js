import { z } from 'zod';

// Keep in sync with client/src/i18n/languages.js and migration 003.
export const LANGUAGE_CODES = ['en', 'hi', 'bn', 'mr', 'te', 'ta', 'gu', 'ur', 'kn', 'or', 'ml', 'pa', 'as', 'mai', 'sat', 'ks', 'ne', 'sd', 'kok', 'doi', 'mni', 'brx', 'sa'];

/** Digits only; bare 10-digit Indian mobiles get the 91 country code. */
export const normalizePhone = (v) => {
  let d = String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10) d = `91${d}`;
  return d;
};

// Strip control / bidi-override / zero-width-space characters (keep ZWJ/ZWNJ for emoji + Indic scripts).
export const cleanText = (v) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200E\u200F\u2028-\u202E\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();

const text = (max) => z.preprocess(cleanText, z.string().max(max, `Max ${max} characters`));
const optText = (max) =>
  z.preprocess((v) => (v == null ? null : cleanText(v) || null), z.string().max(max, `Max ${max} characters`).nullable());
const money = z.coerce.number({ error: 'Enter a valid amount' }).min(0, 'Must be 0 or more').max(10_000_000);
const httpsUrl = z.string().trim().max(2000).regex(/^(https:\/\/|\/uploads\/)/i, 'Must be an https:// URL');
const optUrl = z.preprocess((v) => (v ? v : null), httpsUrl.nullable());

export const username = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]{3,32}$/, 'Username: 3–32 letters, numbers, dot, dash or underscore');

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((s) => Buffer.byteLength(s) <= 72, 'Password is too long');

export const phone = z.preprocess(normalizePhone, z.string().regex(/^[1-9]\d{9,14}$/, 'Enter a valid mobile number'));
/** Login identity: a 10-digit Indian mobile number (6–9 start), stored as 91XXXXXXXXXX. */
export const mobile10 = z.preprocess(normalizePhone, z.string().regex(/^91[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'));

const storeName = z.preprocess(cleanText, z.string().min(2, 'Store name is too short').max(60, 'Max 60 characters'));
const otpCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const registerOwner = z.object({ storeName, phone: mobile10, code: otpCode });
export const phoneLogin = z.object({ phone: mobile10, code: otpCode });
export const otpRequest = z.object({
  phone: mobile10,
  name: optText(80).optional(), // store / customer name, shown to the team relaying codes
  purpose: z.enum(['owner_login', 'owner_register', 'customer_login', 'customer_register', 'whatsapp_change']),
});
export const whatsappVerify = z.object({ phone: mobile10, code: otpCode });
export const registerCustomer = z.object({
  name: z.preprocess(cleanText, z.string().min(1, 'Enter your name').max(80)),
  phone: mobile10,
  code: otpCode,
});
export const submitForReview = z.object({ note: optText(500).optional() });
export const reviewDecision = z.object({ remarks: optText(1000).optional() });
export const reviewRemarksRequired = z.object({
  remarks: z.preprocess(cleanText, z.string().min(5, 'Please explain the reason (min 5 characters)').max(1000)),
});
export const planChange = z
  .object({
    plan: z.enum(['free', 'paid']),
    sku_limit: z.coerce.number().int().min(1).max(100000).optional(),
  })
  .transform((p) => ({ plan: p.plan, sku_limit: p.plan === 'free' ? 50 : Math.max(p.sku_limit ?? 500, 51) }));

// Platform admin only (store owners and customers log in with mobile + OTP).
export const login = z.object({
  username: z.string().trim().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});


export const storeSettings = z
  .object({
    name: z.preprocess(cleanText, z.string().min(2).max(60)),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and single hyphens only')
      .max(60),
    instagram_handle: z.preprocess(
      (v) => (v ? String(v).trim().replace(/^@/, '') : null),
      z.string().regex(/^[A-Za-z0-9._]{1,30}$/, 'Invalid Instagram handle').nullable(),
    ),
    logo_url: optUrl,
    banner_url: optUrl,
    address_text: optText(300),
    maps_url: optUrl,
    description: optText(500),
    category: optText(40),
    city: optText(60),
    currency_symbol: z.string().trim().min(1).max(4).default('₹'),
    minimum_order: money,
    delivery_fee: money,
    opening_hours: z.preprocess(
      (v) => (v ? String(v).trim() : null),
      z.string().regex(/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/, 'Use HH:MM-HH:MM, e.g. 09:00-21:00').nullable(),
    ),
    closed_days: optText(40),
    theme_color: z.preprocess((v) => (v ? v : null), z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable()),
    order_language: z.enum(LANGUAGE_CODES),
  })
  .partial();

// "List price" is the selling price shown to shoppers (stored as offer_price). Only name, MRP and list price
// are required; the SKU code is optional and auto-assigned when missing.
const productAliases = (v) => {
  if (!v || typeof v !== 'object') return v;
  const o = { ...v };
  if (o.list_price !== undefined && (o.offer_price === undefined || o.offer_price === '')) o.offer_price = o.list_price;
  if (o.sku_id === '') delete o.sku_id;
  return o;
};

/** Accepts 1299, "1299.50", "₹1,299", "Rs. 99" (Excel/CSV formats); blank means missing. */
const requiredPrice = (label) =>
  z.any().transform((v, ctx) => {
    const raw = typeof v === 'string' ? v.replace(/[₹,\s]|rs\.?/gi, '') : v;
    if (raw === '' || raw == null) {
      ctx.addIssue({ code: 'custom', message: `${label} is required` });
      return z.NEVER;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) ctx.addIssue({ code: 'custom', message: `${label} must be a number` });
    else if (n < 0) ctx.addIssue({ code: 'custom', message: `${label} must be 0 or more` });
    else if (n > 10_000_000) ctx.addIssue({ code: 'custom', message: `${label} is too large` });
    else return Math.round(n * 100) / 100;
    return z.NEVER;
  });

const productObject = z
  .object({
    sku_id: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/, 'Item code: letters, numbers, - or _ (max 40)').optional(),
    name: z.preprocess(cleanText, z.string().min(1, 'Name is required').max(100)),
    category: z.preprocess((v) => cleanText(v) || 'Other', z.string().max(60)),
    mrp: requiredPrice('MRP'),
    offer_price: requiredPrice('List price'),
    images: z
      .preprocess(
        (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((s) => String(s).trim()).filter(Boolean),
        z.array(httpsUrl).max(8, 'Max 8 images'),
      )
      .default([]),
    description: text(5000).default(''),
    specs: z
      .preprocess((v) => {
        if (!v) return {};
        if (typeof v !== 'string') return v;
        const str = v.trim();
        if (!str) return {};
        if (str.startsWith('{')) {
          try {
            return JSON.parse(str);
          } catch {
            return str; // fails the record check below with a clear message
          }
        }
        // Spreadsheet-friendly form: "Weight: 5 kg; Shelf life: 3 months"
        const pairs = str.split(/[;\n|]/).map((p) => p.trim()).filter(Boolean);
        if (!pairs.every((p) => p.includes(':'))) return str;
        return Object.fromEntries(pairs.map((p) => [p.slice(0, p.indexOf(':')).trim(), p.slice(p.indexOf(':') + 1).trim()]));
      }, z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean()]), { error: 'Details must look like "Weight: 5 kg; Shelf life: 3 months"' }))
      .default({}),
    tags: z
      .preprocess(
        (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((s) => cleanText(s)).filter(Boolean),
        z.array(z.string().max(30)).max(10),
      )
      .default([]),
    rating: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().min(1).max(5).nullable()).default(null),
    review_count: z.preprocess((v) => (v === '' || v == null ? 0 : v), z.coerce.number().int().min(0)).default(0),
    in_stock: z
      .preprocess((v) => (typeof v === 'string' ? !/^(false|no|0|n|off)$/i.test(v.trim()) : v ?? true), z.boolean())
      .default(true),
  })
  .refine((p) => p.offer_price <= p.mrp, { message: 'List price cannot be more than MRP', path: ['offer_price'] });

export const product = z.preprocess(productAliases, productObject);

export const productImport = z.object({ products: z.array(z.unknown()).min(1).max(500) });

/** Product list pasted from a WhatsApp message (see src/catalog/messageParser.js). */
export const messageImport = z.object({
  text: z.string().trim().min(1, 'Paste your product list first').max(20_000, 'Message is too long (max 20,000 characters). Send it in parts.'),
  dryRun: z.boolean().optional().default(false),
});

export const placeOrder = z.object({
  order_code: z.string().regex(/^ORD-[A-Z0-9]{6,12}$/, 'Invalid order code'),
  items: z
    .array(
      z.object({
        sku_id: z.string().max(40),
        name: optText(100).optional(), // fallback if the product was deleted since the device cached it
        mrp: money.optional(),
        quantity: z.coerce.number().int().min(1).max(99),
        unit_price: money, // price shown on the device (may be stale when ordering offline)
      }),
    )
    .max(200),
  notes: optText(1000),
  customer_name: optText(80),
  customer_phone: z.preprocess((v) => (v ? normalizePhone(v) : null), z.string().max(15).nullable()),
  delivery_address: optText(300),
  placed_offline: z.boolean().default(false),
  client_created_at: z.coerce.date().optional(),
});



export const customerProfile = z.object({
  name: z.preprocess(cleanText, z.string().min(1).max(80)).optional(),
  default_address: optText(300).optional(),
});

export const orderStatus = z.object({
  status: z.enum(['placed', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled']),
});
