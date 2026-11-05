// Khata (credit ledger) for store owners: customers who buy now and pay later, their credits and payments, monthly
// statements, "mark as paid", and orders added to a customer's khata. The owner's own record: shoppers only see what
// the owner sends them on WhatsApp.
import { Router } from 'express';
import { requireOwner } from '../auth.js';
import { query, tx } from '../db.js';
import { badRequest, conflict, notFound, parse } from '../errors.js';
import * as S from '../schemas.js';

export const khataRouter = Router();
khataRouter.use(requireOwner);

const BALANCE_SQL = `coalesce(sum(CASE WHEN e.kind = 'credit' THEN e.amount ELSE -e.amount END), 0)::float`;
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // India date

async function ownCustomer(storeId, id, client = { query }) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('Customer not found');
  const { rows } = await client.query('SELECT * FROM khata_customers WHERE id = $1 AND store_id = $2', [id, storeId]);
  if (!rows[0]) throw notFound('Customer not found');
  return rows[0];
}

/** Everyone in the khata with their balance (what they owe; negative = paid in advance), most owed first. */
khataRouter.get('/khata', async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.name, c.phone, ${BALANCE_SQL} AS balance, to_char(max(e.entry_date), 'YYYY-MM-DD') AS last_entry, count(e.id)::int AS entries
       FROM khata_customers c LEFT JOIN khata_entries e ON e.customer_id = c.id
      WHERE c.store_id = $1
      GROUP BY c.id
      ORDER BY ${BALANCE_SQL} DESC, c.name`,
    [req.user.store_id],
  );
  const due = rows.filter((r) => r.balance > 0);
  res.json({ customers: rows, total_due: Math.round(due.reduce((a, r) => a + r.balance, 0) * 100) / 100, customers_due: due.length });
});

khataRouter.post('/khata/customers', async (req, res) => {
  const { name, phone } = parse(S.khataCustomer, req.body);
  try {
    const { rows } = await query('INSERT INTO khata_customers (store_id, name, phone) VALUES ($1, $2, $3) RETURNING *', [req.user.store_id, name, phone]);
    res.status(201).json({ customer: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw conflict('This mobile number is already in your khata', { phone: 'This mobile number is already in your khata' });
    throw err;
  }
});

khataRouter.put('/khata/customers/:id', async (req, res) => {
  await ownCustomer(req.user.store_id, req.params.id);
  const { name, phone } = parse(S.khataCustomer, req.body);
  try {
    const { rows } = await query('UPDATE khata_customers SET name = $2, phone = $3 WHERE id = $1 RETURNING *', [req.params.id, name, phone]);
    res.json({ customer: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw conflict('This mobile number is already in your khata', { phone: 'This mobile number is already in your khata' });
    throw err;
  }
});

/** Removes the customer and all their entries (the client asks first). */
khataRouter.delete('/khata/customers/:id', async (req, res) => {
  await ownCustomer(req.user.store_id, req.params.id);
  await query('DELETE FROM khata_customers WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

/** One customer: entries newest first, the balance, and month-by-month totals with the closing balance. */
khataRouter.get('/khata/customers/:id', async (req, res) => {
  const customer = await ownCustomer(req.user.store_id, req.params.id);
  const { rows: entries } = await query(
    `SELECT e.id, e.kind, e.amount::float AS amount, e.note, to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.created_at,
            o.order_code
       FROM khata_entries e LEFT JOIN orders o ON o.id = e.order_id
      WHERE e.customer_id = $1
      ORDER BY e.entry_date DESC, e.created_at DESC`,
    [customer.id],
  );
  const { rows: months } = await query(
    `SELECT month, credit, payment, sum(credit - payment) OVER (ORDER BY month)::float AS closing
       FROM (SELECT to_char(entry_date, 'YYYY-MM') AS month,
                    coalesce(sum(amount) FILTER (WHERE kind = 'credit'), 0)::float AS credit,
                    coalesce(sum(amount) FILTER (WHERE kind = 'payment'), 0)::float AS payment
               FROM khata_entries WHERE customer_id = $1 GROUP BY 1) m
      ORDER BY month DESC`,
    [customer.id],
  );
  const balance = Math.round(entries.reduce((a, e) => a + (e.kind === 'credit' ? e.amount : -e.amount), 0) * 100) / 100;
  res.json({ customer, balance, entries, months });
});

khataRouter.post('/khata/customers/:id/entries', async (req, res) => {
  await ownCustomer(req.user.store_id, req.params.id);
  const { kind, amount, note, entry_date } = parse(S.khataEntry, req.body);
  if (entry_date && entry_date > today()) throw badRequest('The date can’t be in the future', { entry_date: 'The date can’t be in the future' });
  const { rows } = await query(
    `INSERT INTO khata_entries (store_id, customer_id, kind, amount, note, entry_date)
     VALUES ($1, $2, $3, $4, $5, coalesce($6::date, (now() AT TIME ZONE 'Asia/Kolkata')::date)) RETURNING id`,
    [req.user.store_id, req.params.id, kind, amount, note, entry_date || null],
  );
  res.status(201).json({ id: rows[0].id });
});

khataRouter.delete('/khata/entries/:id', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw notFound('Entry not found');
  const { rowCount } = await query('DELETE FROM khata_entries WHERE id = $1 AND store_id = $2', [req.params.id, req.user.store_id]);
  if (!rowCount) throw notFound('Entry not found');
  res.json({ ok: true });
});

/** "Mark as paid": a payment for the whole balance, which brings it to zero. */
khataRouter.post('/khata/customers/:id/settle', async (req, res) => {
  const amount = await tx(async (client) => {
    const customer = await ownCustomer(req.user.store_id, req.params.id, client);
    await client.query('SELECT id FROM khata_customers WHERE id = $1 FOR UPDATE', [customer.id]);
    const { rows } = await client.query(
      `SELECT coalesce(sum(CASE WHEN kind = 'credit' THEN amount ELSE -amount END), 0)::float AS balance FROM khata_entries WHERE customer_id = $1`,
      [customer.id],
    );
    const due = Math.round(rows[0].balance * 100) / 100;
    if (due <= 0) throw badRequest('Nothing is due');
    await client.query(`INSERT INTO khata_entries (store_id, customer_id, kind, amount, note) VALUES ($1, $2, 'payment', $3, 'Settled')`, [
      req.user.store_id,
      customer.id,
      due,
    ]);
    return due;
  });
  res.json({ settled: amount });
});

/**
 * "Add to khata" from an order: a credit for the order total, in the khata of the order's mobile number (created with
 * the order's name if new; the owner can rename them). An order goes in at most once.
 */
khataRouter.post('/orders/:id/khata', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw notFound('Order not found');
  const result = await tx(async (client) => {
    const { rows } = await client.query('SELECT id, order_code, customer_name, customer_phone, total FROM orders WHERE id = $1 AND store_id = $2', [
      req.params.id,
      req.user.store_id,
    ]);
    const order = rows[0];
    if (!order) throw notFound('Order not found');
    const phone = String(order.customer_phone || '').replace(/\D/g, '').replace(/^(?=[6-9]\d{9}$)/, '91');
    if (!/^91[6-9]\d{9}$/.test(phone)) throw badRequest('This order has no mobile number to keep a khata for');
    const name = (order.customer_name || '').trim().slice(0, 80) || `+${phone}`;
    const { rows: c } = await client.query(
      `INSERT INTO khata_customers (store_id, name, phone) VALUES ($1, $2, $3)
       ON CONFLICT (store_id, phone) WHERE phone IS NOT NULL DO UPDATE SET phone = EXCLUDED.phone RETURNING id, name`,
      [req.user.store_id, name, phone],
    );
    try {
      await client.query('SAVEPOINT khata_order');
      await client.query(
        `INSERT INTO khata_entries (store_id, customer_id, kind, amount, note, order_id) VALUES ($1, $2, 'credit', $3, $4, $5)`,
        [req.user.store_id, c[0].id, order.total, `Order #${order.order_code}`, order.id],
      );
    } catch (err) {
      if (err.code === '23505') throw conflict('This order is already in the khata');
      throw err;
    }
    return { customer_id: c[0].id, name: c[0].name };
  });
  res.status(201).json(result);
});
