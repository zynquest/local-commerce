// Store-owner maintenance (CLI). Owners log in with their 10-digit mobile + OTP, so every owner needs a
// mobile number. Accounts created before mobile login can be fixed with:
//
//   npm run owner:set-phone -- <username | store-link> <10-digit mobile>
//   e.g. npm run owner:set-phone -- yogi-store 9876543210
import { pool, query } from '../db.js';
import { migrate } from '../migrate.js';
import { mobile10 } from '../schemas.js';

async function main() {
  const [cmd, who, number] = process.argv.slice(2);
  if (cmd !== 'set-phone' || !who || !number) throw new Error('Usage: node src/cli/owner.js set-phone <username|store-link> <10-digit mobile>');
  const parsed = mobile10.safeParse(number);
  if (!parsed.success) throw new Error('Enter a valid 10-digit Indian mobile number');
  const phone = parsed.data;
  await migrate({ log: () => {} });

  const { rows } = await query(
    `SELECT u.id, u.username, s.slug FROM users u LEFT JOIN stores s ON s.owner_id = u.id
      WHERE u.role = 'owner' AND (u.username = $1 OR s.slug = $1)`,
    [who],
  );
  if (!rows[0]) throw new Error(`No store owner found for "${who}"`);
  const taken = await query('SELECT username FROM users WHERE phone = $1 AND id <> $2', [phone, rows[0].id]);
  if (taken.rows[0]) throw new Error(`+${phone} is already used by "${taken.rows[0].username}"`);

  await query('UPDATE users SET phone = $2 WHERE id = $1', [rows[0].id, phone]);
  // Keep the store's WhatsApp number if it already has one; otherwise use the login mobile.
  await query(
    `UPDATE stores SET whatsapp_number = coalesce(whatsapp_number, $2), updated_at = now() WHERE owner_id = $1`,
    [rows[0].id, phone],
  );
  console.log(`Owner "${rows[0].username}" (${rows[0].slug || 'no store'}) can now log in with +${phone} and OTP.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
