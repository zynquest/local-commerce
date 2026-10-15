// Row → API shapes. Public responses never include owner/plan internals beyond what the UI needs.
import { config } from './config.js';

export const slugify = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'store';

export const PUBLIC_STORE_COLUMNS = `s.id, s.slug, s.name, s.whatsapp_number, s.instagram_handle, s.logo_url, s.banner_url,
  s.address_text, s.maps_url, s.description, s.category, s.city, s.currency_symbol, s.minimum_order,
  s.delivery_fee, s.opening_hours, s.closed_days, s.theme_color, s.verified, s.order_language, s.is_demo, s.updated_at`;

export const PRODUCT_COLUMNS = `p.id, p.sku_id, p.name, p.category, p.mrp, p.offer_price, p.images, p.description,
  p.specs, p.tags, p.rating, p.review_count, p.in_stock, p.status, p.position, p.updated_at`;

export const publicStore = (s) => ({
  slug: s.slug,
  name: s.name,
  // Demo stores: orders always go to the company WhatsApp, whatever is stored.
  whatsapp_number: s.is_demo ? config.demoWhatsApp : s.whatsapp_number,
  instagram_handle: s.instagram_handle,
  logo_url: s.logo_url,
  banner_url: s.banner_url,
  address_text: s.address_text,
  maps_url: s.maps_url,
  description: s.description,
  category: s.category,
  city: s.city,
  currency_symbol: s.currency_symbol,
  minimum_order: s.minimum_order,
  delivery_fee: s.delivery_fee,
  opening_hours: s.opening_hours,
  closed_days: s.closed_days,
  theme_color: s.theme_color,
  verified: s.verified,
  is_demo: Boolean(s.is_demo),
  order_language: s.order_language || 'en',
  accepting_orders: Boolean(s.is_demo || s.whatsapp_number),
});

export const product = (p) => ({
  id: p.id,
  sku_id: p.sku_id, // internal item code (used for cart/order matching; not displayed to shoppers)
  name: p.name,
  category: p.category,
  mrp: p.mrp,
  offer_price: p.offer_price,
  images: p.images,
  description: p.description,
  specs: p.specs,
  tags: p.tags,
  rating: p.rating,
  review_count: p.review_count,
  in_stock: p.in_stock,
  status: p.status,
  position: p.position,
});

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
