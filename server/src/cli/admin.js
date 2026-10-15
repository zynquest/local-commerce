// Platform admin management (CLI only; there is deliberately no UI or API to create admins).
//
//   npm run admin:create            → create THE admin (fails if one exists; the DB allows only one)
//   npm run admin:reset-password    → set a new password for the existing admin and sign it out everywhere
//
// Credentials are read from ADMIN_USERNAME / ADMIN_PASSWORD env vars, or prompted (password hidden).
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { pool, query } from '../db.js';
import { migrate } from '../migrate.js';

const ADMIN_BCRYPT_ROUNDS = 13;
const COMMON = ['password', 'admin', 'qwerty', 'letmein', 'welcome', '123456', 'iloveyou', 'vocalforlocal', 'sonsari'];

export function adminUsernameProblems(username) {
  if (!/^[A-Za-z0-9_.-]{8,32}$/.test(username)) return ['Username must be 8–32 letters, numbers, dot, dash or underscore'];
  if (/^(admin|administrator|root|superuser)$/i.test(username)) return ['Choose a less guessable username than "admin"'];
  return [];
}

export function adminPasswordProblems(password, username = '') {
  const problems = [];
  if (password.length < 16) problems.push('at least 16 characters');
  if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
  if (!/\d/.test(password)) problems.push('a digit');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('a symbol');
  if (Buffer.byteLength(password) > 72) problems.push('at most 72 bytes');
  const lower = password.toLowerCase();
  if (username && lower.includes(username.toLowerCase())) problems.push('must not contain the username');
  if (COMMON.some((w) => lower.includes(w))) problems.push('must not contain common words');
  if (/(.)\1{3,}/.test(password)) problems.push('no character repeated 4+ times in a row');
  return problems;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => rl.output.write(s.startsWith(question) ? question : '');
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPassword(username) {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const pw = await ask('Admin password: ', { hidden: true });
  const again = await ask('Repeat password: ', { hidden: true });
  if (pw !== again) throw new Error('Passwords do not match');
  return pw;
}

async function main() {
  const mode = process.argv[2];
  if (!['create', 'reset-password'].includes(mode)) throw new Error('Usage: node src/cli/admin.js create|reset-password');
  await migrate({ log: () => {} });

  const { rows: existing } = await query(`SELECT id, username FROM users WHERE role = 'platform_admin'`);

  if (mode === 'create') {
    if (existing[0]) throw new Error(`An admin already exists (${existing[0].username}). Only one admin is allowed; use admin:reset-password.`);
    const username = (process.env.ADMIN_USERNAME || (await ask('Admin username: '))).trim();
    const uProblems = adminUsernameProblems(username);
    if (uProblems.length) throw new Error(uProblems.join('; '));
    const password = await readPassword(username);
    const pProblems = adminPasswordProblems(password, username);
    if (pProblems.length) throw new Error(`Password needs: ${pProblems.join(', ')}`);
    await query(`INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'platform_admin')`, [
      username,
      await bcrypt.hash(password, ADMIN_BCRYPT_ROUNDS),
    ]);
    console.log(`Admin "${username}" created. Log in at /admin/login`);
  } else {
    if (!existing[0]) throw new Error('No admin exists yet; use admin:create.');
    const password = await readPassword(existing[0].username);
    const pProblems = adminPasswordProblems(password, existing[0].username);
    if (pProblems.length) throw new Error(`Password needs: ${pProblems.join(', ')}`);
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [existing[0].id, await bcrypt.hash(password, ADMIN_BCRYPT_ROUNDS)]);
    await query(`DELETE FROM sessions WHERE subject_type = 'admin' AND subject_id = $1`, [existing[0].id]);
    console.log(`Password updated for "${existing[0].username}". All admin sessions were signed out.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
