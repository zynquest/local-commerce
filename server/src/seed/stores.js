// Seeded listings: hand-over to the real owner, and removal at the owner's request.
import { query, tx } from '../db.js';
import { conflict, notFound } from '../errors.js';

/**
 * Hands an unclaimed seeded listing to its owner. The placeholder account gets the owner's login email (they log in
 * with it + an emailed code) and/or mobile; the mobile also becomes the store's WhatsApp number, so orders start
 * reaching them. The listing keeps origin = 'seed'.
 *   verified: the mobile was proven, by OTP (self-claim on registration) or by the platform team at the shop.
 * Returns the owner user id.
 */
export async function claimSeedStore({ storeId, email, phone, name, verified = true, actorId = null, note = '' }) {
  if (!email && !phone) throw conflict("Enter the owner's email or mobile");
  return tx(async (client) => {
    const { rows } = await client.query('SELECT id, owner_id, origin, claimed_at FROM stores WHERE id = $1 FOR UPDATE', [storeId]);
    const store = rows[0];
    if (!store) throw notFound('Store not found');
    if (store.origin !== 'seed' || store.claimed_at) throw conflict('This listing has already been claimed');
    if (email && (await client.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount) {
      throw conflict('This email already has a store. Log in with it, or use another email.', { email: 'This email already has a store' });
    }
    if (phone) {
      const taken = await client.query(
        `SELECT 1 FROM users WHERE phone = $1 UNION ALL SELECT 1 FROM stores WHERE whatsapp_number = $1 AND id <> $2 AND NOT is_demo`,
        [phone, storeId],
      );
      if (taken.rowCount) throw conflict('This mobile number already has a store. Log in with it, or use another number.', { phone: 'This mobile number already has a store' });
    }
    await client.query(
      `UPDATE users SET email = coalesce($2, email), phone = coalesce($3, phone),
              phone_verified_at = CASE WHEN $3::text IS NOT NULL AND $4 THEN now() ELSE phone_verified_at END,
              -- Owners are usually "m<mobile>"; keep the placeholder username if that one is taken.
              username = CASE WHEN $3::text IS NULL OR EXISTS (SELECT 1 FROM users WHERE username = 'm' || $3) THEN username ELSE 'm' || $3 END
        WHERE id = $1`,
      [store.owner_id, email || null, phone || null, verified],
    );
    await client.query(
      `UPDATE stores SET whatsapp_number = coalesce($2, whatsapp_number), whatsapp_verified = ($2::text IS NOT NULL AND $3),
              claimed_at = now(), name = coalesce($4, name), updated_at = now()
        WHERE id = $1`,
      [storeId, phone || null, verified, name || null],
    );
    await client.query(`INSERT INTO store_reviews (store_id, action, remarks, actor_id) VALUES ($1, 'claimed', $2, $3)`, [
      storeId,
      note || (actorId ? 'Handed over by the platform team' : 'Claimed by the owner (mobile verified by OTP)'),
      actorId,
    ]);
    return store.owner_id;
  });
}

/** Unclaimed seeded listing with this registration mobile (exactly one), or null. */
export async function seedForMobile(phone) {
  const { rows } = await query(`SELECT id FROM stores WHERE claim_phone = $1 AND origin = 'seed' AND claimed_at IS NULL LIMIT 2`, [phone]);
  return rows.length === 1 ? rows[0].id : null;
}

/** Deletes an unclaimed seeded listing (products, images, placeholder owner) and remembers it so re-imports skip it. */
export async function removeSeedStore({ storeId, reason = '' }) {
  return tx(async (client) => {
    const { rows } = await client.query('SELECT id, owner_id, name, origin, claimed_at, seed_ref, slug FROM stores WHERE id = $1 FOR UPDATE', [storeId]);
    const store = rows[0];
    if (!store) throw notFound('Store not found');
    if (store.origin !== 'seed' || store.claimed_at) throw conflict('Only unclaimed seeded listings can be removed this way');
    if (store.seed_ref) {
      await client.query(`INSERT INTO seed_optouts (seed_ref, name, reason) VALUES ($1, $2, $3) ON CONFLICT (seed_ref) DO UPDATE SET reason = EXCLUDED.reason`, [
        store.seed_ref,
        store.name,
        reason || null,
      ]);
    }
    await client.query('DELETE FROM users WHERE id = $1', [store.owner_id]); // cascades to the store and its products
    return store;
  });
}
