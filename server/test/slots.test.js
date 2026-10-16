// Unit tests for appointment slot maths (IST, no database).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addDays, computeSlots, isClosedDay, istDate, istToMs, normaliseSchedule, weekday } from '../src/appointments/slots.js';

const MON = '2026-10-19'; // a Monday
const sched = { mon: [['10:00', '13:00'], ['14:00', '16:00']] };

describe('slot maths', () => {
  test('dates and weekdays are IST', () => {
    assert.equal(weekday(MON), 'mon');
    assert.equal(addDays(MON, 6), '2026-10-25');
    assert.equal(istDate(istToMs(MON, '23:59')), MON); // 18:29 UTC is still Monday in India
    assert.equal(new Date(istToMs(MON, '10:00')).toISOString(), '2026-10-19T04:30:00.000Z');
  });

  test('a 60-minute service fits on a 30-minute grid inside each working interval', () => {
    const slots = computeSlots({ date: MON, durationMin: 60, slotMinutes: 30, specialists: [{ id: 'a', schedule: sched }], nowMs: 0 });
    assert.deepEqual(slots.map((s) => s.time), ['10:00', '10:30', '11:00', '11:30', '12:00', '14:00', '14:30', '15:00']);
  });

  test('booked time, minimum notice and closed days remove slots', () => {
    const booked = [{ specialist_id: 'a', starts_at: new Date(istToMs(MON, '10:30')), ends_at: new Date(istToMs(MON, '11:30')) }];
    const slots = computeSlots({ date: MON, durationMin: 30, slotMinutes: 30, specialists: [{ id: 'a', schedule: sched }], booked, nowMs: 0 });
    assert.ok(!slots.some((s) => ['10:30', '11:00'].includes(s.time)));
    assert.ok(slots.some((s) => s.time === '10:00') && slots.some((s) => s.time === '11:30'));
    const notice = computeSlots({ date: MON, durationMin: 30, slotMinutes: 30, specialists: [{ id: 'a', schedule: sched }], nowMs: istToMs(MON, '11:10'), minNoticeMin: 60 });
    assert.equal(notice[0].time, '12:30');
    assert.deepEqual(computeSlots({ date: MON, durationMin: 30, specialists: [{ id: 'a', schedule: sched }], nowMs: 0, closedDays: 'Sat, Mon' }), []);
    assert.ok(isClosedDay('Sunday', '2026-10-18') && !isClosedDay('Sun', MON));
  });

  test('several specialists: each slot lists who is free', () => {
    const slots = computeSlots({
      date: MON, durationMin: 30, slotMinutes: 30, nowMs: 0,
      specialists: [{ id: 'a', schedule: { mon: [['10:00', '11:00']] } }, { id: 'b', schedule: { mon: [['10:30', '11:30']] } }],
    });
    assert.deepEqual(slots, [{ time: '10:00', specialists: ['a'] }, { time: '10:30', specialists: ['a', 'b'] }, { time: '11:00', specialists: ['b'] }]);
  });

  test('schedule validation', () => {
    assert.deepEqual(normaliseSchedule({ mon: [['9:00', '13:00']] }).error, 'Working hours for mon: use HH:MM');
    assert.match(normaliseSchedule({ tue: [['13:00', '10:00']] }).error, /must end after/);
    assert.match(normaliseSchedule({ wed: [['10:00', '13:00'], ['12:00', '14:00']] }).error, /overlap/);
    const ok = normaliseSchedule({ fri: [['14:00', '18:00'], ['09:00', '12:00']] });
    assert.deepEqual(ok.schedule.fri, [['09:00', '12:00'], ['14:00', '18:00']]);
    assert.deepEqual(ok.schedule.sun, []);
  });
});
