// Google Sign-In: verifies the ID token (a JWT) that Google Identity Services gives the browser. No SDK needed —
// the token's RS256 signature is checked against Google's published keys, then audience, issuer, expiry and
// email verification. https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
import crypto from 'node:crypto';
import { config } from './config.js';
import { unauthorized } from './errors.js';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
let cache = { keys: null, expires: 0 };
let testKeys = null;

/** Tests only: use these JWKs instead of fetching Google's. Pass null to restore. */
export function setGoogleKeysForTests(keys) {
  testKeys = keys;
}

async function googleKeys() {
  if (testKeys) return testKeys;
  if (cache.keys && Date.now() < cache.expires) return cache.keys;
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Google certs ${res.status}`);
  const { keys } = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  cache = { keys, expires: Date.now() + Math.min(maxAge, 86_400) * 1000 };
  return keys;
}

const b64json = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Returns { email, name, picture, sub } for a valid Google ID token issued to GOOGLE_CLIENT_ID; throws 401 otherwise.
 * The email is lowercased and must be verified by Google.
 */
export async function verifyGoogleIdToken(token) {
  const fail = () => unauthorized('Google sign-in failed. Please try again.');
  if (!config.googleClientId) throw unauthorized('Google sign-in is not set up');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw fail();
  let header;
  let payload;
  try {
    header = b64json(parts[0]);
    payload = b64json(parts[1]);
  } catch {
    throw fail();
  }
  if (header.alg !== 'RS256' || !header.kid) throw fail();
  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk && !testKeys) {
    cache.expires = 0; // Google rotated its keys since we cached them
    jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  }
  if (!jwk) throw fail();
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  const now = Math.floor(Date.now() / 1000);
  if (!ok || payload.aud !== config.googleClientId || !ISSUERS.has(payload.iss) || !(payload.exp > now - 60)) throw fail();
  if (!payload.email || payload.email_verified !== true) throw unauthorized('Your Google account email is not verified');
  return {
    email: String(payload.email).toLowerCase(),
    name: String(payload.name || payload.given_name || '').trim().slice(0, 80),
    picture: payload.picture || null,
    sub: payload.sub,
  };
}
