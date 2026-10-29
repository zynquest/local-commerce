// Appointment businesses (salon, spa, beauty parlour, clinic): services, specialists, availability and bookings.
// Customers book a free slot; the booking is saved as "requested" (the slot is held at once, so it can't be
// double-booked) and the customer sends the details to the business on WhatsApp. The business confirms or
// cancels it from the dashboard.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { optionalCustomer, requireOwner, viewer } from '../auth.js';
import { clientKey } from '../clientIp.js';
import { query, tx } from '../db.js';
import { badRequest, conflict, notFound, parse } from '../errors.js';
import * as S from '../schemas.js';
import { CLOSED_NOW_SQL } from '../serialize.js';
import { addDays, appointmentCode, computeSlots, hasHours, istDate, istToMs, normaliseSchedule } from '../appointments/slots.js';

export const publicAppointmentsRouter = Router();
export const merchantAppointmentsRouter = Router();

const num = (v) => (v == null ? v : Number(v));
const serviceOut = (s) => ({
  id: s.id,
  name: s.name,
  category: s.category,
  description: s.description,
  duration_min: s.duration_min,
  price: num(s.price),
  active: s.active,
  position: s.position,
});

/** Services + specialists shown on a public booking page (active ones only; schedules stay private). */
export async function publicBookingCatalog(storeId) {
  const [services, specialists] = await Promise.all([
    query(`SELECT * FROM services WHERE store_id = $1 AND active ORDER BY position, created_at`, [storeId]),
    query(
      `SELECT sp.id, sp.name, sp.title, sp.photo_url, sp.schedule,
              coalesce(array_agg(ss.service_id) FILTER (WHERE sv.active), '{}') AS service_ids
         FROM specialists sp
         LEFT JOIN specialist_services ss ON ss.specialist_id = sp.id
         LEFT JOIN services sv ON sv.id = ss.service_id
        WHERE sp.store_id = $1 AND sp.active
        GROUP BY sp.id ORDER BY sp.position, sp.created_at`,
      [storeId],
    ),
  ]);
  return {
    services: services.rows.map(serviceOut),
    specialists: specialists.rows
      .filter((sp) => hasHours(sp.schedule) && sp.service_ids.length)
      .map(({ schedule, ...sp }) => ({ ...sp, days: Object.keys(schedule).filter((d) => schedule[d]?.length) })),
  };
}

/** The bookable store (approved; owners and the admin may preview their own unapproved store). */
async function bookingStore(req, slug) {
  const { rows } = await query(`SELECT s.*, ${CLOSED_NOW_SQL} AS closed_now FROM stores s WHERE s.slug = $1`, [slug]);
  const store = rows[0];
  if (!store || store.business_type !== 'appointments') throw notFound('Store not found');
  if (store.status !== 'approved') {
    const who = await viewer(req);
    if (who.ownerStoreId !== store.id && !who.isAdmin) throw notFound('Store not found');
    store.preview = true;
  }
  return store;
}

/** Service + the specialists who offer it (optionally just one) + their live bookings on `date`. */
async function slotInputs(client, store, serviceId, date, specialistId) {
  const svc = await client.query('SELECT * FROM services WHERE id = $1 AND store_id = $2 AND active', [serviceId, store.id]);
  if (!svc.rows[0]) throw notFound('Service not found');
  const sps = await client.query(
    `SELECT sp.id, sp.name, sp.schedule FROM specialists sp
       JOIN specialist_services ss ON ss.specialist_id = sp.id
      WHERE sp.store_id = $1 AND sp.active AND ss.service_id = $2 AND ($3::uuid IS NULL OR sp.id = $3)
      ORDER BY sp.position, sp.created_at`,
    [store.id, serviceId, specialistId || null],
  );
  const dayStart = new Date(istToMs(date, '00:00'));
  const dayEnd = new Date(istToMs(addDays(date, 1), '00:00'));
  const booked = sps.rows.length
    ? (
        await client.query(
          `SELECT specialist_id, starts_at, ends_at FROM appointments
            WHERE specialist_id = ANY($1) AND status IN ('requested', 'confirmed') AND starts_at < $3 AND ends_at > $2`,
          [sps.rows.map((s) => s.id), dayStart, dayEnd],
        )
      ).rows
    : [];
  return { service: svc.rows[0], specialists: sps.rows, booked };
}

function bookingWindow(store, date) {
  const today = istDate(Date.now());
  const last = addDays(today, store.booking_days - 1);
  if (date < today || date > last) throw badRequest(`Pick a date between ${today} and ${last}`);
}

const slotArgs = (store, service, specialists, booked, date) => ({
  date,
  durationMin: service.duration_min,
  slotMinutes: store.slot_minutes,
  specialists,
  booked,
  minNoticeMin: store.min_notice_minutes,
  closedDays: store.closed_days,
});

/**
 * Free slots. With ?date: the times that day. Without: how many free slots each day in the booking window
 * (for the date picker).
 */
publicAppointmentsRouter.get('/stores/:slug/availability', async (req, res) => {
  const store = await bookingStore(req, req.params.slug);
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  const q = parse(S.availabilityQuery, { ...req.query, date: date || istDate(Date.now()) });
  res.set('Cache-Control', 'no-store');
  if (date) {
    bookingWindow(store, q.date);
    const { service, specialists, booked } = await slotInputs({ query }, store, q.service, q.date, q.specialist);
    return res.json({ date: q.date, slots: computeSlots(slotArgs(store, service, specialists, booked, q.date)) });
  }
  const today = istDate(Date.now());
  const days = [];
  for (let i = 0; i < store.booking_days; i++) {
    const d = addDays(today, i);
    const { service, specialists, booked } = await slotInputs({ query }, store, q.service, d, q.specialist);
    days.push({ date: d, available: computeSlots(slotArgs(store, service, specialists, booked, d)).length });
  }
  res.json({ days });
});

const bookingLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: 'Too many booking requests. Please try again later or message the business on WhatsApp.' },
});

/** Books a slot (status "requested"). The customer then sends the details on WhatsApp. */
publicAppointmentsRouter.post('/stores/:slug/appointments', bookingLimiter, optionalCustomer, async (req, res) => {
  const b = parse(S.bookAppointment, req.body);
  const store = await bookingStore(req, req.params.slug);
  if (store.preview) throw badRequest('This business is not taking bookings yet');
  bookingWindow(store, b.date);
  if (store.closed_now) throw conflict('This business is temporarily closed and not taking bookings right now.');
  // At most 3 pending requests per customer at one business, recognised by their number or their account.
  // (Anonymous requests have no number to count by; the per-device booking rate limit above covers them.)
  if (b.phone || req.customer?.id) {
    const busyLimit = await query(
      `SELECT count(*)::int AS n FROM appointments
        WHERE store_id = $1 AND status = 'requested' AND ends_at > now()
          AND (($2::text IS NOT NULL AND customer_phone = $2) OR ($3::uuid IS NOT NULL AND customer_id = $3))`,
      [store.id, b.phone || null, req.customer?.id || null],
    );
    if (busyLimit.rows[0].n >= 3) throw conflict('You already have 3 pending requests here. Please wait for the business to confirm them.');
  }

  const appointment = await tx(async (client) => {
    const { service, specialists, booked } = await slotInputs(client, store, b.service_id, b.date, b.specialist_id);
    const slot = computeSlots(slotArgs(store, service, specialists, booked, b.date)).find((s) => s.time === b.time);
    if (!slot) throw conflict('That time is no longer available. Please pick another slot.');
    // "Any specialist": the one with the fewest bookings that day.
    const load = (id) => booked.filter((x) => x.specialist_id === id).length;
    const chosenId = b.specialist_id || [...slot.specialists].sort((x, y) => load(x) - load(y))[0];
    const specialist = specialists.find((s) => s.id === chosenId);
    const startsAt = new Date(istToMs(b.date, b.time));
    const endsAt = new Date(startsAt.getTime() + service.duration_min * 60_000);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await client.query('SAVEPOINT book');
        const { rows } = await client.query(
          `INSERT INTO appointments (store_id, specialist_id, service_id, code, service_name, specialist_name, price,
                                     starts_at, ends_at, customer_name, customer_phone, customer_id, notes, language)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [store.id, specialist.id, service.id, appointmentCode(), service.name, specialist.name, service.price,
            startsAt, endsAt, b.name, b.phone || null, req.customer?.id || null, b.notes, b.language],
        );
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT book');
        if (err.code === '23P01') throw conflict('That time was just booked by someone else. Please pick another slot.');
        if (err.code !== '23505') throw err; // 23505: booking code collision → try another code
      }
    }
    throw conflict('Could not create the booking, please try again');
  });
  res.status(201).json({ appointment: appointmentOut(appointment) });
});

const appointmentOut = (a) => ({
  id: a.id,
  code: a.code,
  status: a.status,
  service_id: a.service_id,
  service_name: a.service_name,
  specialist_id: a.specialist_id,
  specialist_name: a.specialist_name,
  price: num(a.price),
  starts_at: a.starts_at,
  ends_at: a.ends_at,
  date: istDate(new Date(a.starts_at).getTime()),
  time: new Date(new Date(a.starts_at).getTime() + 330 * 60_000).toISOString().slice(11, 16),
  end_time: new Date(new Date(a.ends_at).getTime() + 330 * 60_000).toISOString().slice(11, 16),
  customer_name: a.customer_name,
  customer_phone: a.customer_phone,
  notes: a.notes,
  language: a.language,
  created_at: a.created_at,
});

// ---------------------------------------------------------------------------
// Merchant: services, specialists, bookings
// ---------------------------------------------------------------------------

merchantAppointmentsRouter.use(requireOwner);
const touchStore = (client, storeId) => client.query('UPDATE stores SET updated_at = now() WHERE id = $1', [storeId]);

merchantAppointmentsRouter.get('/services', async (req, res) => {
  const { rows } = await query('SELECT * FROM services WHERE store_id = $1 ORDER BY position, created_at', [req.user.store_id]);
  res.json({ services: rows.map(serviceOut) });
});

merchantAppointmentsRouter.post('/services', async (req, res) => {
  const s = parse(S.service, req.body);
  const row = await tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO services (store_id, name, category, description, duration_min, price, active, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7, (SELECT coalesce(max(position), 0) + 1 FROM services WHERE store_id = $1)) RETURNING *`,
      [req.user.store_id, s.name, s.category, s.description, s.duration_min, s.price, s.active],
    );
    await touchStore(client, req.user.store_id);
    return rows[0];
  });
  res.status(201).json({ service: serviceOut(row) });
});

merchantAppointmentsRouter.put('/services/:id', async (req, res) => {
  const s = parse(S.service, req.body);
  const row = await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE services SET name = $3, category = $4, description = $5, duration_min = $6, price = $7, active = $8, updated_at = now()
        WHERE id = $1 AND store_id = $2 RETURNING *`,
      [req.params.id, req.user.store_id, s.name, s.category, s.description, s.duration_min, s.price, s.active],
    );
    if (!rows[0]) throw notFound('Service not found');
    await touchStore(client, req.user.store_id);
    return rows[0];
  });
  res.json({ service: serviceOut(row) });
});

merchantAppointmentsRouter.delete('/services/:id', async (req, res) => {
  await tx(async (client) => {
    const { rowCount } = await client.query('DELETE FROM services WHERE id = $1 AND store_id = $2', [req.params.id, req.user.store_id]);
    if (!rowCount) throw notFound('Service not found');
    await touchStore(client, req.user.store_id);
  });
  res.json({ ok: true });
});

const specialistOut = (sp) => ({
  id: sp.id,
  name: sp.name,
  title: sp.title,
  photo_url: sp.photo_url,
  schedule: sp.schedule,
  service_ids: sp.service_ids || [],
  active: sp.active,
  position: sp.position,
});

const SPECIALIST_SELECT = `SELECT sp.*, coalesce(array_agg(ss.service_id) FILTER (WHERE ss.service_id IS NOT NULL), '{}') AS service_ids
  FROM specialists sp LEFT JOIN specialist_services ss ON ss.specialist_id = sp.id`;

merchantAppointmentsRouter.get('/specialists', async (req, res) => {
  const { rows } = await query(`${SPECIALIST_SELECT} WHERE sp.store_id = $1 GROUP BY sp.id ORDER BY sp.position, sp.created_at`, [req.user.store_id]);
  res.json({ specialists: rows.map(specialistOut) });
});

async function saveSpecialist(req, id) {
  const sp = parse(S.specialist, req.body);
  const { schedule, error } = normaliseSchedule(sp.schedule);
  if (error) throw badRequest(error, { schedule: error });
  return tx(async (client) => {
    if (sp.service_ids.length) {
      const own = await client.query('SELECT count(*)::int AS n FROM services WHERE store_id = $1 AND id = ANY($2)', [req.user.store_id, sp.service_ids]);
      if (own.rows[0].n !== new Set(sp.service_ids).size) throw badRequest('Unknown service selected');
    }
    let row;
    if (id) {
      ({ rows: [row] } = await client.query(
        `UPDATE specialists SET name = $3, title = $4, photo_url = $5, schedule = $6, active = $7, updated_at = now()
          WHERE id = $1 AND store_id = $2 RETURNING *`,
        [id, req.user.store_id, sp.name, sp.title, sp.photo_url ?? null, schedule, sp.active],
      ));
      if (!row) throw notFound('Specialist not found');
      await client.query('DELETE FROM specialist_services WHERE specialist_id = $1', [id]);
    } else {
      ({ rows: [row] } = await client.query(
        `INSERT INTO specialists (store_id, name, title, photo_url, schedule, active, position)
         VALUES ($1,$2,$3,$4,$5,$6, (SELECT coalesce(max(position), 0) + 1 FROM specialists WHERE store_id = $1)) RETURNING *`,
        [req.user.store_id, sp.name, sp.title, sp.photo_url ?? null, schedule, sp.active],
      ));
    }
    for (const serviceId of new Set(sp.service_ids)) {
      await client.query('INSERT INTO specialist_services (specialist_id, service_id) VALUES ($1, $2)', [row.id, serviceId]);
    }
    await touchStore(client, req.user.store_id);
    return specialistOut({ ...row, service_ids: [...new Set(sp.service_ids)] });
  });
}

merchantAppointmentsRouter.post('/specialists', async (req, res) => res.status(201).json({ specialist: await saveSpecialist(req) }));
merchantAppointmentsRouter.put('/specialists/:id', async (req, res) => res.json({ specialist: await saveSpecialist(req, req.params.id) }));

merchantAppointmentsRouter.delete('/specialists/:id', async (req, res) => {
  await tx(async (client) => {
    const { rowCount } = await client.query('DELETE FROM specialists WHERE id = $1 AND store_id = $2', [req.params.id, req.user.store_id]);
    if (!rowCount) throw notFound('Specialist not found');
    await touchStore(client, req.user.store_id);
  });
  res.json({ ok: true });
});

/** Bookings between ?from and ?to (IST dates, inclusive; default today → +14 days), optional ?status. */
merchantAppointmentsRouter.get('/appointments', async (req, res) => {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = iso.test(req.query.from) ? req.query.from : istDate(Date.now());
  const to = iso.test(req.query.to) ? req.query.to : addDays(from, 14);
  const status = S.APPOINTMENT_STATUSES.includes(req.query.status) ? req.query.status : null;
  const { rows } = await query(
    `SELECT * FROM appointments WHERE store_id = $1 AND starts_at >= $2 AND starts_at < $3 AND ($4::text IS NULL OR status = $4)
      ORDER BY starts_at, created_at LIMIT 500`,
    [req.user.store_id, new Date(istToMs(from, '00:00')), new Date(istToMs(addDays(to, 1), '00:00')), status],
  );
  res.json({ from, to, appointments: rows.map(appointmentOut) });
});

merchantAppointmentsRouter.patch('/appointments/:id', async (req, res) => {
  const { status } = parse(S.appointmentStatus, req.body);
  try {
    const { rows } = await query(
      `UPDATE appointments SET status = $3, updated_at = now() WHERE id = $1 AND store_id = $2 RETURNING *`,
      [req.params.id, req.user.store_id, status],
    );
    if (!rows[0]) throw notFound('Appointment not found');
    res.json({ appointment: appointmentOut(rows[0]) });
  } catch (err) {
    // Re-opening a cancelled booking whose slot has since been taken.
    if (err.code === '23P01') throw conflict('That time has been booked by someone else in the meantime');
    throw err;
  }
});
