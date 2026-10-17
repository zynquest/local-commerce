// Demo businesses: five shops (Grocery, Vegetables, Flowers, Electricals, Bakery) and two appointment businesses
// (hair & beauty salon, dental & physio clinic) for showing the platform. They're approved
// and orderable (orders always go to the company WhatsApp, config.demoWhatsApp = 919353095481) but marked is_demo: labelled "Demo", listed after real stores,
// noindex and left out of the sitemap. Safe to re-run: stores and products are upserted.
//
//   npm run demo:create
//   npm run demo:remove -- --yes      deletes every demo store, its products, orders and images
//
// Demo owners have no mobile, so nobody can log in to them until you attach one:
//   npm run owner:set-phone -- demo-bakery <10-digit mobile>
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { pool, query, tx } from '../db.js';
import { migrate } from '../migrate.js';
import { DEMO_STORES } from '../demo-stores-data.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const art = (emoji, [from, to]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><radialGradient id="g" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></radialGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="300" cy="320" r="190" fill="#ffffff" fill-opacity="0.35"/><text x="300" y="325" font-size="230" text-anchor="middle" dominant-baseline="central">${emoji}</text></svg>`;

const banner = (emoji, name, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs><rect width="1200" height="400" fill="url(#g)"/><circle cx="1010" cy="200" r="250" fill="#ffffff" fill-opacity="0.08"/><circle cx="1010" cy="200" r="160" fill="#ffffff" fill-opacity="0.1"/><text x="1010" y="210" font-size="190" text-anchor="middle" dominant-baseline="central">${emoji}</text><text x="70" y="215" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="64" font-weight="800" fill="#ffffff">${esc(name)}</text></svg>`;

async function writeFile(storeId, name, content) {
  const dir = path.join(config.uploadDir, storeId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), content);
  return `/uploads/${storeId}/${name}`;
}

/** Services + specialists (with weekly hours) for a demo appointment business. Matched by name, so re-runs update. */
async function seedBooking(client, storeId, demo) {
  const ids = {};
  let position = 0;
  for (const [name, category, duration, price, description] of demo.services) {
    const found = await client.query('SELECT id FROM services WHERE store_id = $1 AND name = $2', [storeId, name]);
    if (found.rows[0]) {
      await client.query(
        `UPDATE services SET category = $2, duration_min = $3, price = $4, description = $5, active = true, position = $6, updated_at = now() WHERE id = $1`,
        [found.rows[0].id, category, duration, price, description, ++position],
      );
      ids[name] = found.rows[0].id;
    } else {
      const { rows } = await client.query(
        `INSERT INTO services (store_id, name, category, duration_min, price, description, position) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [storeId, name, category, duration, price, description, ++position],
      );
      ids[name] = rows[0].id;
    }
  }
  await client.query('DELETE FROM services WHERE store_id = $1 AND NOT (name = ANY($2))', [storeId, demo.services.map((x) => x[0])]);
  position = 0;
  for (const [name, title, schedule, serviceNames] of demo.specialists) {
    const full = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, schedule[d] || []]));
    const found = await client.query('SELECT id FROM specialists WHERE store_id = $1 AND name = $2', [storeId, name]);
    let id = found.rows[0]?.id;
    if (id) {
      await client.query(`UPDATE specialists SET title = $2, schedule = $3, active = true, position = $4, updated_at = now() WHERE id = $1`, [id, title, full, ++position]);
    } else {
      ({ rows: [{ id }] } = await client.query(
        `INSERT INTO specialists (store_id, name, title, schedule, position) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [storeId, name, title, full, ++position],
      ));
    }
    await client.query('DELETE FROM specialist_services WHERE specialist_id = $1', [id]);
    for (const sn of serviceNames) await client.query('INSERT INTO specialist_services (specialist_id, service_id) VALUES ($1, $2)', [id, ids[sn]]);
  }
  await client.query('DELETE FROM specialists WHERE store_id = $1 AND NOT (name = ANY($2))', [storeId, demo.specialists.map((x) => x[0])]);
  return demo.services.length;
}

async function create() {
  await migrate({ log: (m) => console.log(`[db] ${m}`) });
  for (const demo of DEMO_STORES) {
    try {
      const { slug, products } = await tx(async (client) => {
        const { rows: users } = await client.query(
          `INSERT INTO users (username) VALUES ($1)
           ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id, role`,
          [demo.username],
        );
        const user = users[0];
        if (user.role !== 'owner') throw new Error(`user "${demo.username}" exists and is not a store owner`);
        const taken = await client.query('SELECT owner_id, is_demo FROM stores WHERE slug = $1', [demo.store.slug]);
        if (taken.rows[0] && taken.rows[0].owner_id !== user.id) throw new Error(`/s/${demo.store.slug} already belongs to a real store`);

        const s = {
          maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(demo.store.address_text)}`,
          closed_days: null,
          instagram_handle: 'sonsariofficial', // the platform's own Instagram for every demo store
          ...demo.store,
          whatsapp_number: config.demoWhatsApp,
          whatsapp_verified: true,
          verified: false,
          status: 'approved',
          plan: 'free',
          sku_limit: config.freeSkuLimit,
          is_demo: true,
        };
        const cols = Object.keys(s);
        const { rows: stores } = await client.query(
          `INSERT INTO stores (owner_id, ${cols.join(', ')}, reviewed_at)
           VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, now())
           ON CONFLICT (owner_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()
           RETURNING id`,
          [user.id, ...cols.map((c) => s[c])],
        );
        const storeId = stores[0].id;
        const color = s.theme_color || '#15803d';
        await client.query('UPDATE stores SET logo_url = $2, banner_url = $3 WHERE id = $1', [
          storeId,
          await writeFile(storeId, 'logo.svg', art(demo.emoji, ['#ffffff', color])),
          await writeFile(storeId, 'banner.svg', banner(demo.emoji, s.name, color)),
        ]);

        if (demo.services) return { slug: s.slug, products: await seedBooking(client, storeId, demo), what: 'services' };
        let position = 0;
        for (const p of demo.products) {
          const { emoji, alt, palette } = p.images;
          const images = [
            await writeFile(storeId, `${p.sku_id}-1.svg`, art(emoji, [palette[0], palette[1]])),
            await writeFile(storeId, `${p.sku_id}-2.svg`, art(alt || emoji, [palette[2], palette[0]])),
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
        // Products added to the demo by hand later are kept only if they're in the list above.
        await client.query('DELETE FROM products WHERE store_id = $1 AND NOT (sku_id = ANY($2))', [storeId, demo.products.map((p) => p.sku_id)]);
        return { slug: s.slug, products: demo.products.length };
      });
      console.log(`[demo] ✓ ${demo.store.name.padEnd(32)} /s/${slug}  (${products} ${demo.services ? 'services' : 'products'})`);
    } catch (err) {
      console.error(`[demo] ✗ ${demo.store.name}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  const base = config.publicUrl || `http://localhost:${config.port}`;
  console.log(`[demo] Orders from demo stores go to WhatsApp +${config.demoWhatsApp}. Browse: ${base}/stores`);
}

async function remove() {
  if (!process.argv.includes('--yes')) {
    console.error('This deletes every demo store with its products, orders and images. Re-run with --yes to confirm.');
    process.exitCode = 1;
    return;
  }
  const { rows } = await query(
    `DELETE FROM users u USING stores s WHERE s.owner_id = u.id AND s.is_demo AND u.role = 'owner' RETURNING s.id, s.slug`,
  );
  for (const r of rows) {
    await fs.rm(path.join(config.uploadDir, r.id), { recursive: true, force: true });
    console.log(`[demo] removed /s/${r.slug}`);
  }
  if (!rows.length) console.log('[demo] no demo stores found');
}

const cmd = process.argv[2];
try {
  if (cmd === 'create') await create();
  else if (cmd === 'remove') await remove();
  else {
    console.error('Usage: node src/cli/demo-stores.js create | remove --yes');
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
