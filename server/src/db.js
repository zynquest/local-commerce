import pg from 'pg';
import { config } from './config.js';

// Return NUMERIC columns as JS numbers (prices fit comfortably in a double).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// DATE columns stay plain 'YYYY-MM-DD' strings (a JS Date would shift them by the server's time zone).
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export const query = (text, params) => pool.query(text, params);

/** Runs fn(client) inside a transaction. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
