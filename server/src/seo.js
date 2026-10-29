// Server-side SEO for the SPA: per-route <title>/meta/Open Graph/canonical/JSON-LD, a crawlable HTML snapshot
// inside #root (React replaces it on load), sitemap.xml and robots.txt.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { query } from './db.js';
import { CLOSED_NOW_SQL, isUnclaimedSeed } from './serialize.js';
import { RTL, availableLanguages, makeServerT, pickLanguage } from './i18n.js';

const BRAND = config.platformName;
const PRIVATE_PATHS = /^\/(merchant|motiveboss|account|login)(\/|$)/;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// JSON-LD inside <script>: prevent "</script>" breakouts.
const ldJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
const trim = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s || ''));

export const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;
const abs = (base, url) => (!url ? '' : /^https?:\/\//.test(url) ? url : `${base}${url.startsWith('/') ? '' : '/'}${url}`);

/** og:image for link previews: our uploads are WebP, so prefer the JPEG twin saved next to them; skip SVG. */
function shareImage(base, url) {
  if (!url) return '';
  const m = url.match(/^\/uploads\/([\w-]+)\/([\w-]+)\.(webp|svg)$/);
  if (m) {
    const jpg = path.join(config.uploadDir, m[1], `${m[2]}.jpg`);
    if (fs.existsSync(jpg)) return abs(base, `/uploads/${m[1]}/${m[2]}.jpg`);
    if (m[3] === 'svg') return '';
  }
  return abs(base, url);
}

let template = null;
export function loadTemplate(file = path.join(config.clientDist, 'index.html')) {
  template = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  return template;
}

/** Canonical/alternate URL for a path in a language (English = no ?lang). */
const langUrl = (base, p, code) => `${base}${p}${code === 'en' ? '' : `${p.includes('?') ? '&' : '?'}lang=${code}`}`;

const ogLocale = (code) => `${code === 'en' ? 'en' : code}_IN`;

/**
 * Head tags for a page. Beyond title/description/canonical: Open Graph + Twitter cards (with image alt/size),
 * keywords, geo tags for a shop's location, extra og:* properties (business contact data, product price), and
 * hreflang alternates for translated pages.
 */
function render({
  title, description, canonical, image, imageAlt, imageSize, noindex, jsonLd = [], body = '', type = 'website', lang = 'en', alternates = null,
  keywords = [], geo = null, og = [],
}) {
  const kw = [...new Set(keywords.filter(Boolean).map((k) => String(k).trim()).filter(Boolean))].slice(0, 20).join(', ');
  const head = [
    // Search Console / Bing Webmaster ownership (optional; DNS verification works too).
    !noindex && config.googleSiteVerification && `<meta name="google-site-verification" content="${esc(config.googleSiteVerification)}" />`,
    !noindex && config.bingSiteVerification && `<meta name="msvalidate.01" content="${esc(config.bingSiteVerification)}" />`,
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}" />`,
    !noindex && kw && `<meta name="keywords" content="${esc(kw)}" />`,
    `<meta name="application-name" content="${esc(BRAND)}" />`,
    `<meta name="apple-mobile-web-app-title" content="${esc(BRAND)}" />`,
    `<meta name="author" content="${esc(BRAND)}" />`,
    canonical && `<link rel="canonical" href="${esc(canonical)}" />`,
    // A shop's location (local search; Bing and regional engines still read these).
    geo && `<meta name="geo.region" content="${esc(geo.region || 'IN')}" />`,
    geo?.place && `<meta name="geo.placename" content="${esc(geo.place)}" />`,
    geo && `<meta name="geo.position" content="${geo.lat};${geo.lng}" />`,
    geo && `<meta name="ICBM" content="${geo.lat}, ${geo.lng}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="${esc(BRAND)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    canonical && `<meta property="og:url" content="${esc(canonical)}" />`,
    image && `<meta property="og:image" content="${esc(image)}" />`,
    image && /^https:/.test(image) && `<meta property="og:image:secure_url" content="${esc(image)}" />`,
    image && imageSize && `<meta property="og:image:width" content="${imageSize[0]}" />`,
    image && imageSize && `<meta property="og:image:height" content="${imageSize[1]}" />`,
    image && `<meta property="og:image:alt" content="${esc(imageAlt || title)}" />`,
    `<meta property="og:locale" content="${ogLocale(lang)}" />`,
    ...(alternates && !noindex ? availableLanguages().filter((c) => c !== lang).map((c) => `<meta property="og:locale:alternate" content="${ogLocale(c)}" />`) : []),
    ...og.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<meta property="${esc(k)}" content="${esc(v)}" />`),
    ...(alternates && !noindex
      ? [
          ...availableLanguages().map((c) => `<link rel="alternate" hreflang="${c === 'en' ? 'en-IN' : c}" href="${esc(langUrl(alternates.base, alternates.path, c))}" />`),
          `<link rel="alternate" hreflang="x-default" href="${esc(langUrl(alternates.base, alternates.path, 'en'))}" />`,
        ]
      : []),
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    image && `<meta name="twitter:image" content="${esc(image)}" />`,
    image && `<meta name="twitter:image:alt" content="${esc(imageAlt || title)}" />`,
    ...jsonLd.map((o) => `<script type="application/ld+json">${ldJson(o)}</script>`),
  ]
    .filter(Boolean)
    .join('\n    ');

  return template
    .replace(/<html lang="[^"]*"( dir="[^"]*")?>/, `<html lang="${lang === 'en' ? 'en-IN' : lang}" dir="${RTL.has(lang) ? 'rtl' : 'ltr'}">`)
    .replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, `<!--seo:start-->\n    ${head}\n    <!--seo:end-->`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

// ---------------------------------------------------------------------------
// Route renderers
// ---------------------------------------------------------------------------

// Where the platform was built: Sonsari village, Janjgir-Champa district, Chhattisgarh (home-page story + Organization JSON-LD).
const SONSARI_PLACE = {
  '@type': 'Place',
  name: 'Sonsari',
  address: { '@type': 'PostalAddress', addressLocality: 'Sonsari', addressRegion: 'Chhattisgarh', postalCode: '495553', addressCountry: 'IN' },
  geo: { '@type': 'GeoCoordinates', latitude: 21.9415764, longitude: 82.3926376 },
};

function homeLd(base, t) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${base}/#organization`,
      name: BRAND,
      alternateName: 'Sonsari',
      url: base,
      logo: { '@type': 'ImageObject', url: `${base}/icons/icon-512.png`, width: 512, height: 512 },
      image: `${base}/og-image.png`,
      description: t('seo.homeDesc'),
      sameAs: ['https://www.instagram.com/sonsariofficial/'],
      slogan: t('landing.story.title'),
      foundingLocation: SONSARI_PLACE,
      location: SONSARI_PLACE,
      areaServed: 'IN',
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        telephone: `+${config.otpHelpWhatsApp}`,
        url: `https://wa.me/${config.otpHelpWhatsApp}`,
        areaServed: 'IN',
        availableLanguage: availableLanguages().map((c) => (c === 'en' ? 'en-IN' : c)),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${base}/#website`,
      name: BRAND,
      url: base,
      description: t('seo.homeDesc'),
      publisher: { '@id': `${base}/#organization` },
      inLanguage: availableLanguages().map((c) => (c === 'en' ? 'en-IN' : c)),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: `${BRAND} — free online store builder for local businesses`,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Online store and appointment booking',
      operatingSystem: 'Web, Android, iOS',
      url: base,
      image: `${base}/og-image.png`,
      isAccessibleForFree: true,
      inLanguage: availableLanguages().map((c) => (c === 'en' ? 'en-IN' : c)),
      publisher: { '@id': `${base}/#organization` },
      audience: { '@type': 'BusinessAudience', name: 'Local shops, home businesses and appointment-based services in India' },
      offers: [
        { '@type': 'Offer', name: 'Free plan (up to 50 products)', price: '0', priceCurrency: 'INR' },
        { '@type': 'Offer', name: 'Paid plan (50+ products, own domain)', priceCurrency: 'INR', description: 'Contact us for pricing' },
      ],
      featureList: [
        'Free online store for local shops',
        'Online appointment booking for salons, clinics and services',
        'Orders and bookings on WhatsApp',
        'Zero commission',
        'Customers order without an app or login',
        'Works offline once the menu is loaded',
        'Find shops near me',
        'Store QR code to print and share',
        'Order and booking notifications',
        'Available in 23 Indian languages',
      ].join(', '),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq(t).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ];
}

// Search phrases for the two audiences: owners looking for a free online store, customers looking for shops nearby.
const OWNER_KEYWORDS = [
  'free online store', 'online store for local shops', 'WhatsApp ordering', 'WhatsApp store', 'zero commission',
  'sell online free', 'online appointment booking', 'salon booking app', 'digital catalog for shop', 'store QR code',
  'kirana store online', 'home business online', 'vocal for local', 'small business India',
];
const CUSTOMER_KEYWORDS = ['shops near me', 'local stores near me', 'order on WhatsApp', 'home delivery near me', 'book appointment near me', 'vocal for local'];

const FAQ_COUNT = 9;
const faq = (t) => Array.from({ length: FAQ_COUNT }, (_, i) => [t(`landing.faq.q${i + 1}`), t(`landing.faq.a${i + 1}`)]);

/** Internal link that keeps the current language (so crawlers discover each language version). */
const href = (p, lang) => (lang === 'en' ? p : `${p}?lang=${lang}`);

function homeBody(t, lang) {
  const limit = config.freeSkuLimit;
  return `<main><h1>${esc(t('landing.hero.line1'))} ${esc(t('landing.hero.line2'))} ${esc(t('landing.hero.line3'))}</h1>
<p>${esc(t('seo.homeDesc'))}</p>
<h2>${esc(t('landing.seo.t2'))}</h2><p>${esc(t('landing.seo.d2', { limit }))}</p>
<h2>${esc(t('landing.seo.t1'))}</h2><p>${esc(t('landing.seo.d1'))}</p>
<h2>${esc(t('landing.seo.t3'))}</h2><p>${esc(t('landing.seo.d3'))}</p>
<h2>${esc(t('landing.story.title'))}</h2><p>${esc(t('landing.story.p1'))}</p><p>${esc(t('landing.story.p2'))}</p><p>${esc(t('landing.story.p3'))}</p><address>${esc(t('landing.story.place'))}</address>
<h2>${esc(t('landing.faq.title'))}</h2>${faq(t).map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}
<p><a href="${href('/stores', lang)}">${esc(t('nav.shopStores'))}</a> · <a href="${href('/register', lang)}">${esc(t('nav.register'))}</a></p></main>`;
}

function registerPage(base, t, lang) {
  const limit = config.freeSkuLimit;
  return {
    title: t('owner.seoRegister', { brand: BRAND }),
    description: t('owner.seoDesc'),
    canonical: langUrl(base, '/register', lang),
    image: `${base}/og-image.png`,
    imageSize: [1200, 630],
    localized: true,
    keywords: OWNER_KEYWORDS,
    jsonLd: [
      breadcrumbs(base, t, [[t('nav.register'), '/register']]),
      {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: t('owner.seoRegister', { brand: BRAND }),
        description: t('owner.seoDesc'),
        serviceType: 'Free online store and appointment booking for local businesses',
        url: langUrl(base, '/register', lang),
        provider: { '@id': `${base}/#organization`, '@type': 'Organization', name: BRAND, url: base },
        areaServed: { '@type': 'Country', name: 'India' },
        audience: { '@type': 'BusinessAudience', name: 'Local shop owners, home entrepreneurs and appointment-based businesses' },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR', description: `Free for up to ${limit} products, zero commission` },
      },
    ],
    body: `<main><h1>${esc(t('owner.registerTitle'))}</h1>
<p>${esc(t('owner.registerSubtitle', { limit }))}</p>
<p>${esc(t('owner.seoDesc'))}</p>
<h2>${esc(t('landing.seo.t1'))}</h2><p>${esc(t('landing.seo.d1'))}</p>
<h2>${esc(t('landing.seo.t2'))}</h2><p>${esc(t('landing.seo.d2', { limit }))}</p>
<h2>${esc(t('landing.seo.t3'))}</h2><p>${esc(t('landing.seo.d3'))}</p>
<p><a href="${href('/', lang)}">${esc(BRAND)}</a> · <a href="${href('/stores', lang)}">${esc(t('nav.shopStores'))}</a></p></main>`,
  };
}

/** BreadcrumbList JSON-LD: Home › … (items are [name, path]). */
function breadcrumbs(base, t, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [[BRAND, '/'], ...items].map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${base}${p}` })),
  };
}

async function storesPage(base, t, lang) {
  const { rows } = await query(
    `SELECT slug, name, category, city, is_demo FROM stores WHERE status = 'approved' AND whatsapp_number IS NOT NULL
      ORDER BY is_demo, verified DESC, created_at DESC LIMIT 200`,
  );
  return {
    title: t('seo.storesTitle', { brand: BRAND }),
    description: t('seo.storesDesc'),
    canonical: langUrl(base, '/stores', lang),
    image: `${base}/og-image.png`,
    imageSize: [1200, 630],
    localized: true,
    keywords: [...CUSTOMER_KEYWORDS, ...new Set(rows.filter((s) => !s.is_demo).flatMap((s) => [s.category, s.city]).filter(Boolean))],
    jsonLd: [
      breadcrumbs(base, t, [[t('stores.title'), '/stores']]),
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        '@id': `${base}/stores#page`,
        name: t('seo.storesTitle', { brand: BRAND }),
        description: t('seo.storesDesc'),
        url: langUrl(base, '/stores', lang),
        isPartOf: { '@id': `${base}/#website` },
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: rows.filter((s) => !s.is_demo).length,
          itemListElement: rows.filter((s) => !s.is_demo).map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}/s/${s.slug}`, name: s.name })),
        },
      },
    ],
    body: `<main><h1>${esc(t('stores.title'))}</h1><ul>${rows
      .map((s) => `<li><a href="/s/${esc(s.slug)}">${esc(s.name)}</a>${s.category ? ` — ${esc(s.category)}` : ''}${s.city ? `, ${esc(s.city)}` : ''}</li>`)
      .join('')}</ul></main>`,
  };
}

const OPENING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function openingSpec(store) {
  const m = String(store.opening_hours || '').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const closed = String(store.closed_days || '').toLowerCase();
  const days = OPENING_DAYS.filter((d) => !closed.includes(d.slice(0, 3).toLowerCase()));
  const pad = (h, mm) => `${h.padStart(2, '0')}:${mm}`;
  return [{ '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens: pad(m[1], m[2]), closes: pad(m[3], m[4]) }];
}

async function loadApprovedStore(slug) {
  const { rows } = await query(`SELECT s.*, ${CLOSED_NOW_SQL} AS closed_now FROM stores s WHERE s.slug = $1 AND s.status = 'approved'`, [slug]);
  return rows[0] || null;
}

/** schema.org type for a shop, from its store type (businessCategories.js and free text); Store otherwise. */
const SHOP_TYPES = [
  [/supermarket/, 'GroceryStore'],
  [/grocery|kirana|provision|general store|fruit|vegetable|sabzi|dairy|milk|organic|dry fruit|spice|flour|mill|water/, 'GroceryStore'],
  [/bakery|bake|cake/, 'Bakery'],
  [/restaurant|tiffin|meal|dhaba|mess|home-?made|biryani|thali/, 'Restaurant'],
  [/cafe|coffee|tea|juice|ice cream|snack/, 'CafeOrCoffeeShop'],
  [/sweet|mithai|confection/, 'Store'],
  [/flower|florist/, 'Florist'],
  [/medical|pharma|chemist/, 'Pharmacy'],
  [/hardware|plumbing|sanitary|building|paint/, 'HardwareStore'],
  [/mobile|phone/, 'MobilePhoneStore'],
  [/electronic|electrical|computer/, 'ElectronicsStore'],
  [/stationery|book/, 'BookStore'],
  [/toy|gift/, 'ToyStore'],
  [/footwear|shoe/, 'ShoeStore'],
  [/jewel|bangle/, 'JewelryStore'],
  [/cloth|garment|saree|ethnic|kids wear|boutique|tailor/, 'ClothingStore'],
  [/furniture/, 'FurnitureStore'],
  [/furnishing|decor|kitchen|utensil|plastic|household/, 'HomeGoodsStore'],
  [/sport|fitness/, 'SportingGoodsStore'],
  [/pet/, 'PetStore'],
  [/seed|fertili|agri|nursery|garden|cattle/, 'GardenStore'],
  [/auto|tyre|spare/, 'AutoPartsStore'],
  [/cycle|bike/, 'BikeStore'],
  [/laundry|dry clean/, 'DryCleaningOrLaundry'],
  [/optical|watch/, 'Store'],
];
const shopType = (category = '') => SHOP_TYPES.find(([re]) => re.test(String(category).toLowerCase()))?.[1] || 'Store';

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * schema.org fields every business page shares: identity, contact, address (with PIN code when the address has
 * one), map pin, the area it serves (shoppers within NEARBY_RADIUS_KM see it), hours (and a holiday closure),
 * Instagram, the order/booking action and payment details.
 */
function businessLd(base, store, type) {
  const url = `${base}/s/${store.slug}`;
  const pin = String(store.address_text || '').match(/\b[1-9]\d{5}\b/)?.[0];
  const hasGeo = store.lat != null && store.lng != null;
  const appt = store.business_type === 'appointments';
  const closure = store.closed_now
    ? [{ '@type': 'OpeningHoursSpecification', opens: '00:00', closes: '00:00', validFrom: istToday(), ...(store.reopens_on ? { validThrough: dayBefore(store.reopens_on) } : {}) }]
    : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': type,
    '@id': `${url}#business`,
    name: store.name,
    url,
    mainEntityOfPage: url,
    image: abs(base, store.banner_url || store.logo_url) || undefined,
    logo: abs(base, store.logo_url) || undefined,
    description: store.description || undefined,
    ...(store.category ? { additionalType: store.category, keywords: [store.category, store.city, store.locality].filter(Boolean).join(', ') } : {}),
    telephone: store.is_demo ? `+${config.demoWhatsApp}` : store.whatsapp_number ? `+${store.whatsapp_number}` : undefined,
    address:
      store.address_text || store.city
        ? {
            '@type': 'PostalAddress',
            streetAddress: store.address_text || undefined,
            addressLocality: store.city || store.locality || undefined,
            postalCode: pin,
            addressCountry: 'IN',
          }
        : undefined,
    geo: hasGeo ? { '@type': 'GeoCoordinates', latitude: store.lat, longitude: store.lng } : undefined,
    hasMap: store.maps_url || (hasGeo ? `https://www.google.com/maps/search/?api=1&query=${store.lat},${store.lng}` : undefined),
    areaServed: hasGeo
      ? {
          '@type': 'GeoCircle',
          geoMidpoint: { '@type': 'GeoCoordinates', latitude: store.lat, longitude: store.lng },
          geoRadius: config.nearbyRadiusKm * 1000,
        }
      : undefined,
    openingHoursSpecification: openingSpec(store),
    specialOpeningHoursSpecification: closure,
    sameAs: store.instagram_handle ? [`https://www.instagram.com/${store.instagram_handle}/`] : undefined,
    priceRange: '₹',
    currenciesAccepted: 'INR',
    paymentAccepted: 'Cash, UPI',
    isPartOf: { '@type': 'WebSite', '@id': `${base}/#website`, name: BRAND, url: base },
    potentialAction: {
      '@type': appt ? 'ReserveAction' : 'OrderAction',
      target: { '@type': 'EntryPoint', urlTemplate: url, inLanguage: 'en-IN', actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'] },
      ...(appt ? {} : { deliveryMethod: 'http://purl.org/goodrelations/v1#DeliveryModeOwnFleet' }),
    },
  };
}

/** Search keywords for a business page (name, store type, area, how customers order). */
const businessKeywords = (store, extra = []) => {
  const appt = store.business_type === 'appointments';
  const area = store.locality || store.city;
  return [
    store.name,
    store.category,
    area && store.category && `${store.category} in ${area}`,
    area && store.category && `${store.category} near me`,
    store.city,
    store.locality,
    appt ? 'book appointment online' : 'order online',
    appt ? 'book on WhatsApp' : 'order on WhatsApp',
    !appt && 'home delivery',
    ...extra,
    BRAND,
  ];
};

/** og:* contact and location data for a business page (Facebook / WhatsApp previews, local search). */
const businessOg = (base, store) => [
  ['business:contact_data:street_address', store.address_text],
  ['business:contact_data:locality', store.city || store.locality],
  ['business:contact_data:postal_code', String(store.address_text || '').match(/\b[1-9]\d{5}\b/)?.[0]],
  ['business:contact_data:country_name', 'India'],
  ['business:contact_data:phone_number', store.is_demo ? `+${config.demoWhatsApp}` : store.whatsapp_number ? `+${store.whatsapp_number}` : ''],
  ['business:contact_data:website', `${base}/s/${store.slug}`],
  ['place:location:latitude', store.lat],
  ['place:location:longitude', store.lng],
];
const businessGeo = (store) => (store.lat != null && store.lng != null ? { lat: store.lat, lng: store.lng, place: [store.locality, store.city].filter(Boolean).join(', ') || undefined } : null);

/** schema.org type for an appointment business, from its category text. */
function bookingBusinessType(category = '') {
  const c = category.toLowerCase();
  if (/dent/.test(c)) return 'Dentist';
  if (/physio/.test(c)) return 'Physiotherapy';
  if (/clinic|doctor|medical|hospital/.test(c)) return 'MedicalClinic';
  if (/spa/.test(c) && !/hair/.test(c)) return 'DaySpa';
  if (/beauty|parlou?r|makeup|nail/.test(c)) return 'BeautySalon';
  if (/hair|salon|barber/.test(c)) return 'HairSalon';
  return 'HealthAndBeautyBusiness';
}

async function bookingPage(base, store, t) {
  const { rows: services } = await query(
    `SELECT name, category, description, duration_min, price FROM services WHERE store_id = $1 AND active ORDER BY position LIMIT 100`,
    [store.id],
  );
  const url = `${base}/s/${store.slug}`;
  const title = store.city
    ? t('seo.bookTitleCity', { name: store.name, category: store.category || t('seo.storeWord'), city: store.city })
    : t('seo.bookTitle', { name: store.name });
  const ld = {
    ...businessLd(base, store, bookingBusinessType(store.category || '')),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `${store.name} services`,
      itemListElement: services.map((sv) => ({
        '@type': 'Offer',
        price: sv.price,
        priceCurrency: 'INR',
        itemOffered: {
          '@type': 'Service',
          name: sv.name,
          description: sv.description || undefined,
          serviceType: sv.category && sv.category !== 'Other' ? sv.category : store.category || undefined,
          provider: { '@id': `${url}#business` },
          areaServed: store.city || undefined,
        },
      })),
    },
  };
  const body = `<main><h1>${esc(store.name)}</h1>
${store.description ? `<p>${esc(store.description)}</p>` : ''}
${store.address_text ? `<address>${esc(store.address_text)}</address>` : ''}
<h2>${esc(t('book.services'))}</h2><ul>${services
    .map((sv) => `<li>${esc(sv.name)} — ${esc(t('appt.minutes', { count: sv.duration_min }))} — ₹${Number(sv.price)}</li>`)
    .join('')}</ul></main>`;
  return {
    title,
    description: trim(store.description || t('book.seoDesc', { name: store.name }), 160),
    canonical: url,
    image: shareImage(base, store.banner_url) || shareImage(base, store.logo_url) || `${base}/og-image.png`,
    noindex: store.is_demo || isUnclaimedSeed(store),
    type: 'business.business',
    imageAlt: store.name,
    keywords: businessKeywords(store, services.slice(0, 8).map((sv) => sv.name)),
    geo: businessGeo(store),
    og: businessOg(base, store),
    jsonLd: [ld, breadcrumbs(base, t, [[t('stores.title'), '/stores'], [store.name, `/s/${store.slug}`]])],
    body,
  };
}

async function storePage(base, slug, t) {
  const store = await loadApprovedStore(slug);
  if (!store) return null;
  if (store.business_type === 'appointments') return bookingPage(base, store, t);
  const { rows: products } = await query(
    `SELECT sku_id, name, category, mrp, offer_price, images, description, in_stock FROM products
      WHERE store_id = $1 AND status = 'active' ORDER BY position LIMIT 100`,
    [store.id],
  );
  const url = `${base}/s/${store.slug}`;
  const title = store.city
    ? t('seo.storeTitleCity', { name: store.name, category: store.category || t('seo.storeWord'), city: store.city })
    : t('seo.storeTitle', { name: store.name });
  const description = trim(store.description || t('seo.storeDesc', { name: store.name }), 160);
  const type = shopType(store.category || '');
  const food = type === 'Restaurant' || type === 'CafeOrCoffeeShop';
  const ld = {
    ...businessLd(base, store, type),
    ...(food ? { hasMenu: url, acceptsReservations: false, servesCuisine: 'Indian' } : {}),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `${store.name} products`,
      numberOfItems: products.length,
      itemListElement: products.slice(0, 50).map((p) => ({
        '@type': 'Offer',
        price: p.offer_price,
        priceCurrency: 'INR',
        availability: p.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: `${url}/p/${encodeURIComponent(p.sku_id)}`,
        itemOffered: {
          '@type': 'Product',
          name: p.name,
          url: `${url}/p/${encodeURIComponent(p.sku_id)}`,
          image: p.images?.[0] ? abs(base, p.images[0]) : undefined,
          description: p.description ? trim(p.description, 120) : undefined,
          category: p.category && p.category !== 'Other' ? p.category : undefined,
        },
      })),
    },
  };
  const body = `<main><h1>${esc(store.name)}</h1>
${store.description ? `<p>${esc(store.description)}</p>` : ''}
${store.address_text ? `<address>${esc(store.address_text)}</address>` : ''}
<h2>${esc(t('merchant.tabs.products'))}</h2><ul>${products
    .map((p) => `<li><a href="/s/${esc(store.slug)}/p/${esc(encodeURIComponent(p.sku_id))}">${esc(p.name)}</a> — ₹${p.offer_price}${p.mrp > p.offer_price ? ` (MRP ₹${p.mrp})` : ''}</li>`)
    .join('')}</ul></main>`;
  // Store pages are merchant-written, so every ?lang= variant has the same content: one canonical URL, no hreflang.
  return {
    title,
    description,
    canonical: `${url}`,
    image: shareImage(base, store.banner_url) || shareImage(base, store.logo_url) || `${base}/og-image.png`,
    noindex: store.is_demo || isUnclaimedSeed(store), // demo stores are for trying the app; unclaimed seeds aren't the owner's yet
    type: 'business.business',
    imageAlt: store.name,
    keywords: businessKeywords(store, [...new Set(products.map((p) => p.category).filter((c) => c && c !== 'Other'))].slice(0, 6)),
    geo: businessGeo(store),
    og: businessOg(base, store),
    jsonLd: [ld, breadcrumbs(base, t, [[t('stores.title'), '/stores'], [store.name, `/s/${store.slug}`]])],
    body,
  };
}

async function productPage(base, slug, sku, t) {
  const store = await loadApprovedStore(slug);
  if (!store) return null;
  const { rows } = await query(
    `SELECT sku_id, name, category, mrp, offer_price, images, description, in_stock, rating, review_count
       FROM products WHERE store_id = $1 AND sku_id = $2 AND status = 'active'`,
    [store.id, sku],
  );
  const p = rows[0];
  if (!p) return null;
  const url = `${base}/s/${store.slug}/p/${encodeURIComponent(p.sku_id)}`;
  const images = p.images.map((i) => abs(base, i));
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    image: images.length ? images : undefined,
    description: p.description || undefined,
    sku: p.sku_id,
    category: p.category || undefined,
    url,
    offers: {
      '@type': 'Offer',
      url,
      itemCondition: 'https://schema.org/NewCondition',
      price: p.offer_price,
      priceCurrency: 'INR',
      availability: p.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@type': shopType(store.category || ''), '@id': `${base}/s/${store.slug}#business`, name: store.name, url: `${base}/s/${store.slug}` },
      // Local delivery by the shop: the fee (or free) to addresses in its area.
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: Number(store.delivery_fee) > 0 ? Number(store.delivery_fee) : 0, currency: 'INR' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'IN', ...(store.city ? { addressRegion: store.city } : {}) },
      },
      ...(Number(p.mrp) > Number(p.offer_price)
        ? { priceSpecification: [{ '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/ListPrice', price: p.mrp, priceCurrency: 'INR' }] }
        : {}),
    },
    // Owner-typed star ratings are not real customer reviews, so they are left out (search engines penalise them).
  };
  return {
    title: `${p.name} — ₹${p.offer_price} | ${store.name}`,
    description: trim(p.description || t('seo.productDesc', { name: p.name, store: store.name }), 160),
    canonical: url,
    image: shareImage(base, p.images[0]) || shareImage(base, store.logo_url) || `${base}/og-image.png`,
    type: 'product',
    imageAlt: p.name,
    keywords: [p.name, p.category !== 'Other' && p.category, store.name, store.category, store.locality || store.city, 'price', 'order on WhatsApp', 'home delivery', BRAND],
    geo: businessGeo(store),
    og: [
      ['product:price:amount', p.offer_price],
      ['product:price:currency', 'INR'],
      ['product:availability', p.in_stock ? 'in stock' : 'out of stock'],
      ['product:condition', 'new'],
      ['product:retailer_item_id', p.sku_id],
      ['product:category', p.category !== 'Other' ? p.category : ''],
      ['og:price:amount', p.offer_price],
      ['og:price:currency', 'INR'],
    ],
    noindex: store.is_demo || isUnclaimedSeed(store),
    jsonLd: [
      ld,
      breadcrumbs(base, t, [[t('stores.title'), '/stores'], [store.name, `/s/${store.slug}`], [p.name, `/s/${store.slug}/p/${encodeURIComponent(p.sku_id)}`]]),
    ],
    body: `<main><h1>${esc(p.name)}</h1><p>₹${p.offer_price}${p.mrp > p.offer_price ? ` (MRP ₹${p.mrp})` : ''}</p>${p.description ? `<p>${esc(p.description)}</p>` : ''}<p>Sold by <a href="/s/${esc(store.slug)}">${esc(store.name)}</a></p></main>`,
  };
}

/** Express handler for every non-API GET: returns index.html with route-specific SEO tags. */
export async function seoHandler(req, res) {
  if (!template) loadTemplate();
  if (!template) return res.status(503).send('Client build missing');
  const base = baseUrl(req);
  const p = req.path;
  const lang = pickLanguage(req.query.lang);
  const t = makeServerT(lang);
  const homeTitle = t('seo.homeTitle', { brand: BRAND });
  const homeDesc = t('seo.homeDesc');
  let page = null;
  let status = 200;
  try {
    if (p === '/' || p === '') {
      page = {
        title: homeTitle,
        description: homeDesc,
        canonical: langUrl(base, '/', lang),
        image: `${base}/og-image.png`,
        imageSize: [1200, 630],
        localized: true,
        keywords: [...OWNER_KEYWORDS, ...CUSTOMER_KEYWORDS],
        jsonLd: homeLd(base, t),
        body: homeBody(t, lang),
      };
    } else if (p === '/register') {
      page = registerPage(base, t, lang);
    } else if (p === '/stores') {
      page = await storesPage(base, t, lang);
    } else if (PRIVATE_PATHS.test(p)) {
      page = { title: BRAND, description: homeDesc, noindex: true };
    } else {
      const m = p.match(/^\/s\/([^/]+)(?:\/p\/([^/]+))?\/?$/);
      if (m) page = m[2] ? await productPage(base, m[1], decodeURIComponent(m[2]), t) : await storePage(base, m[1], t);
      if (!page) {
        status = 404;
        page = { title: `${t('status.pageNotFound')} | ${BRAND}`, description: homeDesc, noindex: true };
      }
    }
  } catch (err) {
    console.error('[seo]', err.message);
    page = { title: homeTitle, description: homeDesc };
  }
  // hreflang alternates only for pages whose content is translated (home, directory, register).
  const alternates = page.noindex || !page.localized ? null : { base, path: p === '' ? '/' : p };
  res.status(status).set('Cache-Control', 'no-cache').type('html').send(render({ ...page, lang, alternates }));
}

export async function sitemap(req, res) {
  const base = baseUrl(req);
  const { rows: stores } = await query(`SELECT id, slug, name, logo_url, banner_url, updated_at FROM stores WHERE status = 'approved' AND NOT is_demo AND NOT (origin = 'seed' AND claimed_at IS NULL) ORDER BY created_at`);
  const { rows: products } = await query(
    `SELECT s.slug, p.sku_id, p.name, p.images, p.updated_at FROM products p JOIN stores s ON s.id = p.store_id
      WHERE s.status = 'approved' AND NOT s.is_demo AND NOT (s.origin = 'seed' AND s.claimed_at IS NULL) AND p.status = 'active'
      ORDER BY s.created_at, p.position LIMIT 45000`,
  );
  const langs = availableLanguages();
  const url = (loc, lastmod, priority, alts = '', images = []) =>
    `<url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ''}<priority>${priority}</priority>${alts}${images
      .map((i) => abs(base, i))
      .filter(Boolean)
      .slice(0, 5)
      .map((i) => `<image:image><image:loc>${esc(i)}</image:loc></image:image>`)
      .join('')}</url>`;
  // Every language version of a page is listed, each with links to all its alternates (Google hreflang rules).
  const localized = (p, lastmod, priority) => {
    const alts =
      langs.map((c) => `<xhtml:link rel="alternate" hreflang="${c === 'en' ? 'en-IN' : c}" href="${esc(langUrl(base, p, c))}"/>`).join('') +
      `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(langUrl(base, p, 'en'))}"/>`;
    return langs.map((c) => url(langUrl(base, p, c), lastmod, priority, alts));
  };
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...localized('/', null, '1.0'),
    ...localized('/stores', stores.reduce((m, s) => (!m || s.updated_at > m ? s.updated_at : m), null), '0.9'),
    ...localized('/register', null, '0.8'),
    url(`${base}/privacy`, null, '0.3'),
    ...stores.map((s) => url(`${base}/s/${s.slug}`, s.updated_at, '0.8', '', [s.banner_url, s.logo_url])),
    ...products.map((p) => url(`${base}/s/${p.slug}/p/${encodeURIComponent(p.sku_id)}`, p.updated_at, '0.6', '', p.images || [])),
    '</urlset>',
  ].join('\n');
  res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(xml);
}

export function robots(req, res) {
  res
    .type('text/plain')
    .send(
      ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /merchant', 'Disallow: /account', 'Disallow: /login', 'Disallow: /q/', '', `Sitemap: ${baseUrl(req)}/sitemap.xml`, ''].join('\n'),
    );
}
