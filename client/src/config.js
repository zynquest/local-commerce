export const PLATFORM = {
  name: 'Vocal For Local',
  tagline: 'Your shop. Your customers. Your WhatsApp.',
  // Company WhatsApp: merchant onboarding, custom-domain / custom-plan enquiries.
  whatsappNumber: '919353095481',
  instagramHandle: 'sonsariofficial',
  instagramUrl: 'https://www.instagram.com/sonsariofficial/',
  // Hostnames that render the platform. Any other hostname is treated as a store's custom domain.
  hosts: [
    'localhost',
    '127.0.0.1',
    'sonsari.in',
    'www.sonsari.in',
    ...(import.meta.env?.VITE_PLATFORM_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  ],
  hostSuffixes: [],
  aggregatorCommission: 0.25,
  freeSkuLimit: 50,
};

// A cached catalog is usable (including fully offline) for this long, then hard-expires.
export const CATALOG_TTL_MS = 30 * 60 * 1000;
