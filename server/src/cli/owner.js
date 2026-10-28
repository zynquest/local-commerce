// Store-owner maintenance (CLI). Owners log in with an email + code (OWNER_LOGIN=email) or a 10-digit mobile + OTP
// (OWNER_LOGIN=mobile). Give an existing owner the login they need:
//
//   npm run owner:set-email -- <username | store-link | mobile> <email>
//   npm run owner:set-phone -- <username | store-link> <10-digit mobile>
//   e.g. npm run owner:set-email -- yogi-store yogi@example.com
import { pool, query } from '../db.js';
import { migrate } from '../migrate.js';
import { email as emailSchema, mobile10 } from '../schemas.js';

async function setEmail(who, value) {
  const parsed = emailSchema.safeParse(value);
  if (!parsed.success) throw new Error('Enter a valid email address');
  const email = parsed.data;
  await migrate({ log: () => {} });
  const { rows } = await query(
    `SELECT u.id, u.username, s.slug FROM users u LEFT JOIN stores s ON s.owner_id = u.id
      WHERE u.role = 'owner' AND (u.username = $1 OR s.slug = $1 OR u.phone = $1 OR u.phone = '91' || $1)`,
    [who],
  );
  if (!rows[0]) throw new Error(`No store owner found for "${who}"`);
  const taken = await query('SELECT username FROM users WHERE email = $1 AND id <> $2', [email, rows[0].id]);
  if (taken.rows[0]) throw new Error(`${email} is already used by "${taken.rows[0].username}"`);
  // Unverified until they log in with it (the emailed code proves it).
  await query('UPDATE users SET email = $2, email_verified_at = NULL WHERE id = $1', [rows[0].id, email]);
  console.log(`Owner "${rows[0].username}" (${rows[0].slug || 'no store'}) can now log in with ${email} and an emailed code.`);
}

async function main() {
  const [cmd, who, number] = process.argv.slice(2);
  if (cmd === 'set-email' && who && number) return setEmail(who, number);
  if (cmd !== 'set-phone' || !who || !number) {
    throw new Error('Usage: node src/cli/owner.js set-email <username|store-link|mobile> <email>\n       node src/cli/owner.js set-phone <username|store-link> <10-digit mobile>');
  }
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
