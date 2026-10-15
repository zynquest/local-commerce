// Generates client/public/og-image.png (1200×630) used for link previews on WhatsApp, Facebook, X, etc.
import sharp from 'sharp';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#047857"/><stop offset="1" stop-color="#022c22"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <circle cx="1050" cy="120" r="260" fill="#10b981" fill-opacity="0.18"/>
  <rect x="80" y="80" width="88" height="88" rx="22" fill="#ffffff"/>
  <path d="M104 116h40l5 40h-50z" fill="#047857"/><path d="M112 116a6 6 0 0 1 12 0M120 116a6 6 0 0 1 12 0" stroke="#047857" stroke-width="5" fill="none"/>
  <text x="190" y="140" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="700" fill="#ffffff">Vocal For Local</text>
  <text x="80" y="300" font-family="Helvetica, Arial, sans-serif" font-size="72" font-weight="800" fill="#ffffff">Free online store for</text>
  <text x="80" y="385" font-family="Helvetica, Arial, sans-serif" font-size="72" font-weight="800" fill="#6ee7b7">your local business</text>
  <text x="80" y="470" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#d1fae5">Orders on WhatsApp · Home delivery · Zero commission</text>
  <rect x="80" y="520" width="330" height="62" rx="31" fill="#25d366"/>
  <text x="245" y="561" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">Start free · 50 products</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(new URL('../public/og-image.png', import.meta.url).pathname);
console.log('wrote client/public/og-image.png');
