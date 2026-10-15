// Seeds a demo store owner + catalog for local development. Safe to re-run (upserts).
//   npm run db:seed            → demo owner with mobile SEED_DEMO_PHONE (default 9000000001)
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { pool, tx } from './db.js';
import { migrate } from './migrate.js';
import { demoProducts, demoStore } from './seed-data.js';

// Demo owner logs in with this mobile + OTP (898989 locally).
const DEMO_PHONE = process.env.SEED_DEMO_PHONE || '919000000001';

const art = (emoji, [from, to]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><radialGradient id="g" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></radialGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="300" cy="320" r="190" fill="#ffffff" fill-opacity="0.35"/><text x="300" y="325" font-size="230" text-anchor="middle" dominant-baseline="central">${emoji}</text></svg>`;

async function writeArt(storeId, name, svg) {
  const dir = path.join(config.uploadDir, storeId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), svg);
  return `/uploads/${storeId}/${name}`;
}

await migrate({ log: (m) => console.log(`[db] ${m}`) });

await tx(async (client) => {
  const { rows: users } = await client.query(
    `INSERT INTO users (username, phone) VALUES ('demo', $1)
     ON CONFLICT (username) DO UPDATE SET phone = coalesce(users.phone, EXCLUDED.phone) RETURNING id`,
    [DEMO_PHONE],
  );
  const cols = Object.keys(demoStore);
  const { rows: stores } = await client.query(
    `INSERT INTO stores (owner_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (owner_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()
     RETURNING id`,
    [users[0].id, ...cols.map((c) => demoStore[c])],
  );
  const storeId = stores[0].id;
  const logo = await writeArt(storeId, 'logo.svg', art('🛒', ['#dcfce7', '#16a34a']));
  await client.query('UPDATE stores SET logo_url = $2 WHERE id = $1', [storeId, logo]);

  let position = 0;
  for (const p of demoProducts) {
    const { emoji, alt, palette } = p.images;
    const images = [
      await writeArt(storeId, `${p.sku_id}-1.svg`, art(emoji, [palette[0], palette[1]])),
      await writeArt(storeId, `${p.sku_id}-2.svg`, art(alt || emoji, [palette[2], palette[0]])),
    ];
    await client.query(
      `INSERT INTO products (store_id, sku_id, name, category, mrp, offer_price, images, description, specs, tags,
                             rating, review_count, in_stock, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (store_id, sku_id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
         mrp = EXCLUDED.mrp, offer_price = EXCLUDED.offer_price, images = EXCLUDED.images,
         description = EXCLUDED.description, specs = EXCLUDED.specs, tags = EXCLUDED.tags, rating = EXCLUDED.rating,
         review_count = EXCLUDED.review_count, in_stock = EXCLUDED.in_stock, position = EXCLUDED.position,
         status = 'active', updated_at = now()`,
      [storeId, p.sku_id, p.name, p.category, p.mrp, p.offer_price, images, p.description, p.specs_json,
        p.tags ? p.tags.split(',') : [], p.rating, p.review_count, p.in_stock === 'TRUE', ++position],
    );
  }
  console.log(`[seed] demo store ready: ${demoProducts.length} products → /s/demo`);
});

console.log(`[seed] owner login → mobile: ${DEMO_PHONE.slice(2)} (OTP ${process.env.OTP_FIXED_CODE || '898989'} locally)`);
await pool.end();
