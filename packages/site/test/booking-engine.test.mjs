import assert from 'node:assert/strict';
import test from 'node:test';
import { busyIntervals, merge } from '../dist/booking/ical-busy.js';
import { calendar, escapeText, fold } from '../dist/booking/ics.js';
import {
  DEFAULT_SCHEDULE,
  freeStarts,
  isFreeStart,
  lockCells,
  occupied,
  scheduleProblems,
  serviceProblems,
} from '../dist/booking/schedule.js';
import { addDays, fromLocal, offsetAt, toLocal, weekdayOf } from '../dist/booking/time.js';
import { newSecret, sign, verify } from '../dist/booking/tokens.js';

const H = 3_600_000;
const M = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const local = (ms) => {
  const l = toLocal(ms);
  return `${l.date} ${l.time}`;
};

test('time: Stockholm offsets in winter and summer', () => {
  assert.equal(offsetAt(Date.parse('2026-01-15T12:00:00Z')), 1 * H);
  assert.equal(offsetAt(Date.parse('2026-07-15T12:00:00Z')), 2 * H);
  assert.equal(iso(fromLocal('2026-01-15', '09:00')), '2026-01-15T08:00:00.000Z');
  assert.equal(iso(fromLocal('2026-07-15', '09:00')), '2026-07-15T07:00:00.000Z');
  assert.equal(local(Date.parse('2026-07-15T22:30:00Z')), '2026-07-16 00:30');
});

test('time: the spring gap moves forward, the autumn overlap takes the first', () => {
  // 2026-03-29: 02:00 CET -> 03:00 CEST. 2026-10-25: 03:00 CEST -> 02:00 CET.
  assert.equal(local(fromLocal('2026-03-29', '02:30')), '2026-03-29 03:30');
  assert.equal(iso(fromLocal('2026-03-29', '03:00')), '2026-03-29T01:00:00.000Z');
  assert.equal(iso(fromLocal('2026-10-25', '02:30')), '2026-10-25T00:30:00.000Z');
  assert.equal(iso(fromLocal('2026-10-25', '03:00')), '2026-10-25T02:00:00.000Z');
});

test('time: dates and weekdays', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(weekdayOf('2026-11-23'), 0); // Monday
  assert.equal(weekdayOf('2026-11-22'), 6); // Sunday
});

const service = { durationMinutes: 60, bufferMinutes: 15 };
// Monday 2026-11-23 06:00 Stockholm.
const monday = fromLocal('2026-11-23', '06:00');

test('free starts: opening hours, step, length within closing time', () => {
  const starts = freeStarts(DEFAULT_SCHEDULE, service, [], monday, '2026-11-23', '2026-11-23');
  assert.equal(local(starts[0]), '2026-11-23 09:00');
  assert.equal(local(starts.at(-1)), '2026-11-23 16:00'); // 16:00-17:00 fits, buffer may pass closing
  assert.equal(starts.length, 15);
});

test('free starts: minimum notice, closed weekend, max days ahead', () => {
  const late = fromLocal('2026-11-23', '11:10');
  const starts = freeStarts(DEFAULT_SCHEDULE, service, [], late, '2026-11-23', '2026-11-23');
  assert.equal(local(starts[0]), '2026-11-23 13:30'); // 11:10 + 2 h notice
  assert.deepEqual(
    freeStarts(DEFAULT_SCHEDULE, service, [], monday, '2026-11-28', '2026-11-29'),
    []
  );
  const short = { ...DEFAULT_SCHEDULE, maxDaysAhead: 1 };
  const two = freeStarts(short, service, [], monday, '2026-11-23', '2026-11-30');
  assert.deepEqual([...new Set(two.map((s) => toLocal(s).date))], ['2026-11-23', '2026-11-24']);
  // Dates in the past are skipped.
  assert.equal(
    local(freeStarts(DEFAULT_SCHEDULE, service, [], monday, '2026-11-01', '2026-11-23')[0]),
    '2026-11-23 09:00'
  );
});

test('free starts: busy time and buffers', () => {
  const booked = occupied(service, fromLocal('2026-11-23', '10:00')); // 10:00-11:15
  const external = {
    start: fromLocal('2026-11-23', '14:00'),
    end: fromLocal('2026-11-23', '15:00'),
  };
  const starts = freeStarts(
    DEFAULT_SCHEDULE,
    service,
    [booked, external],
    monday,
    '2026-11-23',
    '2026-11-23'
  ).map((s) => toLocal(s).time);
  // 09:00 + 60 + 15 min buffer runs into 10:00; 13:00 + 75 min into 14:00.
  assert.deepEqual(starts, ['11:30', '12:00', '12:30', '15:00', '15:30', '16:00']);
});

test('free starts: exceptions close a day or change its hours', () => {
  const schedule = {
    ...DEFAULT_SCHEDULE,
    exceptions: [
      { date: '2026-11-24', hours: [] },
      { date: '2026-11-28', hours: [{ start: '10:00', end: '12:00' }] },
    ],
  };
  assert.deepEqual(freeStarts(schedule, service, [], monday, '2026-11-24', '2026-11-24'), []);
  const saturday = freeStarts(schedule, service, [], monday, '2026-11-28', '2026-11-28').map(
    (s) => toLocal(s).time
  );
  assert.deepEqual(saturday, ['10:00', '10:30', '11:00']);
});

test('free starts: across the autumn change, local times stay on the step', () => {
  const schedule = {
    ...DEFAULT_SCHEDULE,
    hours: Array(7).fill([{ start: '00:00', end: '06:00' }]),
  };
  const now = fromLocal('2026-10-24', '12:00');
  const starts = freeStarts(schedule, service, [], now, '2026-10-25', '2026-10-25').map(
    (s) => toLocal(s).time
  );
  // 02:00-03:00 happens twice; each real half hour is a start.
  assert.equal(starts.filter((t) => t === '02:30').length, 2);
  assert.equal(starts.at(-1), '05:00');
});

test('isFreeStart matches freeStarts', () => {
  const start = fromLocal('2026-11-23', '09:30');
  assert.equal(isFreeStart(DEFAULT_SCHEDULE, service, [], monday, start), true);
  assert.equal(isFreeStart(DEFAULT_SCHEDULE, service, [], monday, start + 5 * M), false);
  assert.equal(
    isFreeStart(DEFAULT_SCHEDULE, service, [], monday, fromLocal('2026-11-28', '10:00')),
    false
  );
});

test('lock cells: overlapping bookings share a cell, adjacent ones do not', () => {
  const a = lockCells(occupied(service, fromLocal('2026-11-23', '10:00'))); // to 11:15
  const b = lockCells(occupied(service, fromLocal('2026-11-23', '11:15')));
  const c = lockCells(occupied(service, fromLocal('2026-11-23', '11:10')));
  assert.equal(a.length, 15);
  assert.equal(a.filter((x) => b.includes(x)).length, 0);
  assert.ok(a.some((x) => c.includes(x)));
});

test('validation: schedule and service', () => {
  assert.deepEqual(scheduleProblems(DEFAULT_SCHEDULE), []);
  const bad = {
    ...DEFAULT_SCHEDULE,
    stepMinutes: 7,
    hours: [
      [{ start: '10:00', end: '09:00' }],
      [
        { start: '09:00', end: '12:00' },
        { start: '11:00', end: '13:00' },
      ],
      [],
      [],
      [],
      [],
      [],
    ],
    exceptions: [{ date: '2026-02-30', hours: [] }],
  };
  const problems = scheduleProblems(bad).join('\n');
  assert.match(problems, /stepMinutes must be a multiple of 5/);
  assert.match(problems, /ends before it starts/);
  assert.match(problems, /overlap/);
  assert.match(problems, /2026-02-30/);
  assert.deepEqual(
    serviceProblems({ name: 'Klippning', durationMinutes: 45, bufferMinutes: 0 }),
    []
  );
  assert.equal(serviceProblems({ name: '', durationMinutes: 44, bufferMinutes: -5 }).length, 3);
});

test('ics: escaping, folding by octets, CRLF', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const long = 'DESCRIPTION:' + 'å'.repeat(60);
  const folded = fold(long);
  for (const line of folded.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75);
  assert.equal(
    folded
      .split('\r\n')
      .map((l, i) => (i ? l.slice(1) : l))
      .join(''),
    long
  );
  const text = calendar(
    [
      {
        uid: 'b1@example.test',
        start: Date.parse('2026-11-23T09:00:00Z'),
        end: Date.parse('2026-11-23T10:00:00Z'),
        summary: 'Klippning, Anna',
      },
    ],
    { now: Date.parse('2026-11-20T00:00:00Z'), name: 'Bokningar' }
  );
  assert.match(text, /\r\nDTSTART:20261123T090000Z\r\n/);
  assert.match(text, /\r\nSUMMARY:Klippning\\, Anna\r\n/);
  assert.match(text, /X-WR-CALNAME:Bokningar/);
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  // What we write, we read back.
  assert.deepEqual(busyIntervals(text, 0, Infinity), [
    { start: Date.parse('2026-11-23T09:00:00Z'), end: Date.parse('2026-11-23T10:00:00Z') },
  ]);
});

const feed = (body) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', body.trim(), 'END:VCALENDAR'].join('\r\n');

test('ical in: time zones, free and cancelled events, all-day', () => {
  const text = feed(`
BEGIN:VEVENT
UID:1
DTSTART;TZID=Europe/Stockholm:20261123T100000
DTEND;TZID=Europe/Stockholm:20261123T110000
SUMMARY:Secret
END:VEVENT
BEGIN:VEVENT
UID:2
DTSTART:20261123T130000Z
DTEND:20261123T133000Z
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
UID:3
DTSTART:20261123T140000Z
DTEND:20261123T143000Z
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:4
DTSTART;VALUE=DATE:20261125
DTEND;VALUE=DATE:20261126
END:VEVENT
BEGIN:VEVENT
UID:5
DTSTART;TZID=America/New_York:20261124T090000
DTEND;TZID=America/New_York:20261124T100000
END:VEVENT
BEGIN:VEVENT
UID:6
DTSTART:20261126T090000
DTEND:20261126T093000
END:VEVENT`);
  const busy = busyIntervals(
    text,
    Date.parse('2026-11-01T00:00:00Z'),
    Date.parse('2026-12-01T00:00:00Z')
  ).map((i) => [iso(i.start), iso(i.end)]);
  assert.deepEqual(busy, [
    ['2026-11-23T09:00:00.000Z', '2026-11-23T10:00:00.000Z'],
    ['2026-11-24T14:00:00.000Z', '2026-11-24T15:00:00.000Z'],
    ['2026-11-24T23:00:00.000Z', '2026-11-25T23:00:00.000Z'],
    ['2026-11-26T08:00:00.000Z', '2026-11-26T08:30:00.000Z'], // floating = Stockholm
  ]);
});

test('ical in: a feed VTIMEZONE (Outlook names) is used', () => {
  const text = feed(`
BEGIN:VTIMEZONE
TZID:W. Europe Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:o1
DTSTART;TZID=W. Europe Standard Time:20260710T090000
DTEND;TZID=W. Europe Standard Time:20260710T100000
END:VEVENT`);
  assert.deepEqual(
    busyIntervals(text, 0, Infinity).map((i) => iso(i.start)),
    ['2026-07-10T07:00:00.000Z']
  );
});

test('ical in: recurring events with EXDATE, a moved and a cancelled occurrence', () => {
  const text = feed(`
BEGIN:VEVENT
UID:r
DTSTART;TZID=Europe/Stockholm:20261019T080000
DTEND;TZID=Europe/Stockholm:20261019T090000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Europe/Stockholm:20261109T080000
END:VEVENT
BEGIN:VEVENT
UID:r
RECURRENCE-ID;TZID=Europe/Stockholm:20261116T080000
DTSTART;TZID=Europe/Stockholm:20261116T120000
DTEND;TZID=Europe/Stockholm:20261116T130000
END:VEVENT
BEGIN:VEVENT
UID:r
RECURRENCE-ID;TZID=Europe/Stockholm:20261123T080000
DTSTART;TZID=Europe/Stockholm:20261123T080000
DTEND;TZID=Europe/Stockholm:20261123T090000
STATUS:CANCELLED
END:VEVENT`);
  const busy = busyIntervals(
    text,
    Date.parse('2026-10-20T00:00:00Z'),
    Date.parse('2026-12-08T00:00:00Z')
  ).map((i) => local(i.start));
  // Weekly at 08:00 local across the DST change (26 Oct); 9 Nov excluded; 16 Nov moved to 12:00;
  // 23 Nov cancelled.
  assert.deepEqual(busy, [
    '2026-10-26 08:00',
    '2026-11-02 08:00',
    '2026-11-16 12:00',
    '2026-11-30 08:00',
    '2026-12-07 08:00',
  ]);
});

test('ical in: an endless daily rule stops at the window', () => {
  const text = feed(`
BEGIN:VEVENT
UID:d
DTSTART:20200101T080000Z
DTEND:20200101T083000Z
RRULE:FREQ=DAILY
END:VEVENT`);
  const busy = busyIntervals(
    text,
    Date.parse('2026-11-01T00:00:00Z'),
    Date.parse('2026-11-08T00:00:00Z')
  );
  assert.equal(busy.length, 7);
});

test('ical in: not iCalendar throws', () => {
  assert.throws(() => busyIntervals('<html>nope</html>', 0, 1));
  assert.throws(() => busyIntervals('BEGIN:VCARD\r\nEND:VCARD', 0, 1));
});

test('merge joins overlapping and touching intervals', () => {
  assert.deepEqual(
    merge([
      { start: 5, end: 7 },
      { start: 1, end: 3 },
      { start: 3, end: 4 },
      { start: 6, end: 9 },
    ]),
    [
      { start: 1, end: 4 },
      { start: 5, end: 9 },
    ]
  );
});

test('tokens: sign and verify, per purpose', async () => {
  const secret = newSecret();
  const sig = await sign(secret, 'cancel', 'b1');
  assert.equal(await verify(secret, 'cancel', 'b1', sig), true);
  assert.equal(await verify(secret, 'confirm', 'b1', sig), false);
  assert.equal(await verify(secret, 'cancel', 'b2', sig), false);
  assert.equal(await verify(newSecret(), 'cancel', 'b1', sig), false);
});
