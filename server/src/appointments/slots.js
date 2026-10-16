// Appointment slot maths (pure, no database). All businesses are in India: times are IST (UTC+05:30, no DST).
//
// A specialist's weekly schedule looks like {"mon": [["10:00","13:00"], ["14:00","19:00"]], "sun": []}.
// A slot is offered when the whole service fits inside one working interval, doesn't overlap a live booking
// of that specialist, starts after the minimum notice, and the store isn't closed that weekday.

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const IST = '+05:30';
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const toMinutes = (hhmm) => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
export const fromMinutes = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Epoch ms for an IST date ("2026-10-20") + time ("10:30"). */
export const istToMs = (date, time) => Date.parse(`${date}T${time}:00${IST}`);

/** "YYYY-MM-DD" of a moment, in IST. */
export const istDate = (ms) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);

/** Weekday key ('mon'…) of an IST date. */
export const weekday = (date) => DAYS[new Date(`${date}T12:00:00${IST}`).getUTCDay()];

/** Adds days to an IST date string. */
export const addDays = (date, n) => istDate(Date.parse(`${date}T12:00:00${IST}`) + n * 86_400_000);

/** True when the store's closed_days text ("Sun", "Sat, Sun", "Sunday") covers this date's weekday. */
export function isClosedDay(closedDays, date) {
  const day = weekday(date);
  return String(closedDays || '')
    .toLowerCase()
    .split(/[\s,;/]+/)
    .some((d) => d && d.slice(0, 3) === day);
}

/**
 * Validates and normalises a weekly schedule. Returns { schedule } or { error }.
 * Up to 4 intervals per day, each start < end, sorted and non-overlapping.
 */
export function normaliseSchedule(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Working hours are missing' };
  const out = {};
  for (const day of DAYS) {
    const raw = input[day] ?? [];
    if (!Array.isArray(raw) || raw.length > 4) return { error: `Working hours for ${day}: up to 4 time ranges` };
    const ranges = [];
    for (const r of raw) {
      const [start, end] = Array.isArray(r) ? r : [r?.start, r?.end];
      const s = toMinutes(start);
      const e = toMinutes(end);
      if (Number.isNaN(s) || Number.isNaN(e)) return { error: `Working hours for ${day}: use HH:MM` };
      if (e <= s) return { error: `Working hours for ${day}: ${start}–${end} must end after it starts` };
      ranges.push([s, e]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] < ranges[i - 1][1]) return { error: `Working hours for ${day}: time ranges overlap` };
    }
    out[day] = ranges.map(([s, e]) => [fromMinutes(s), fromMinutes(e)]);
  }
  return { schedule: out };
}

export const hasHours = (schedule) => DAYS.some((d) => (schedule?.[d] || []).length > 0);

/**
 * Free start times on `date` for a service of `durationMin`.
 * specialists: [{ id, schedule }]; booked: [{ specialist_id, starts_at, ends_at }] (Date or ISO).
 * Returns [{ time: "10:30", specialists: [id, …] }] sorted by time.
 */
export function computeSlots({ date, durationMin, slotMinutes = 30, specialists, booked = [], nowMs = Date.now(), minNoticeMin = 0, closedDays = '' }) {
  if (isClosedDay(closedDays, date)) return [];
  const day = weekday(date);
  const earliest = nowMs + minNoticeMin * 60_000;
  const busy = new Map();
  for (const b of booked) {
    const list = busy.get(b.specialist_id) || [];
    list.push([new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()]);
    busy.set(b.specialist_id, list);
  }
  const byTime = new Map();
  for (const sp of specialists) {
    for (const [start, end] of sp.schedule?.[day] || []) {
      const s = toMinutes(start);
      const e = toMinutes(end);
      // Slots start on the store's grid (e.g. every 30 min from the start of the working interval).
      for (let t = s; t + durationMin <= e; t += slotMinutes) {
        const from = istToMs(date, fromMinutes(t));
        const to = from + durationMin * 60_000;
        if (from < earliest) continue;
        if ((busy.get(sp.id) || []).some(([bs, be]) => from < be && to > bs)) continue;
        const key = fromMinutes(t);
        if (!byTime.has(key)) byTime.set(key, []);
        byTime.get(key).push(sp.id);
      }
    }
  }
  return [...byTime.entries()].sort(([a], [b]) => toMinutes(a) - toMinutes(b)).map(([time, ids]) => ({ time, specialists: ids }));
}

/** Short booking reference, e.g. APT-7K2Q9M (no 0/O/1/I to avoid confusion when read out). */
export function appointmentCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `APT-${s}`;
}
