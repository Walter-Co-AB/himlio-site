import assert from 'node:assert/strict';
import test from 'node:test';
import {
  book,
  BookingError,
  busyBetween,
  cancel,
  confirm,
  createBlock,
  feed,
  feedUrl,
  getCalendar,
  HOLD_MINUTES,
  listBookings,
  maintenance,
  rotateFeed,
  saveService,
  setCalendar,
  setSchedule,
  setSettings,
  slots,
  verifyLink,
} from '../dist/booking/core.js';
import { fromLocal, toLocal } from '../dist/booking/time.js';
import { deps as makeDeps } from './booking-fakes.mjs';

const M = 60_000;
// Monday 2026-11-23 08:00 Stockholm.
const NOW = fromLocal('2026-11-23', '08:00');
const at = (date, time) => new Date(fromLocal(date, time)).toISOString();
const visitor = { name: 'Anna Andersson', email: 'anna@example.com', phone: '070-123 45 67' };

async function setup(options = {}) {
  const t = makeDeps({ now: NOW, ...options });
  const service = await saveService(t.deps, {
    name: 'Klippning',
    durationMinutes: 60,
    bufferMinutes: 15,
  });
  return { ...t, service };
}

const linkOf = (mail) => new URL(mail.text.match(/https:\/\/\S+/)[0]);

async function bookAndConfirm(t, start, who = visitor) {
  await book(t.deps, { serviceId: t.service.id, start, ...who }, '203.0.113.1');
  const mail = t.sent.at(-1);
  const link = linkOf(mail);
  const id = link.searchParams.get('b');
  assert.equal(await confirm(t.deps, id), 'confirmed');
  return id;
}

test('slots: free times per local date, with the booked time and its buffer taken out', async () => {
  const t = await setup();
  const before = await slots(t.deps, t.service.id, '2026-11-23', 1);
  assert.equal(before.days[0].starts[0].time, '10:00'); // 2 h notice from 08:00
  await bookAndConfirm(t, at('2026-11-23', '12:00'));
  const after = (await slots(t.deps, t.service.id, '2026-11-23', 1)).days[0].starts.map(
    (s) => s.time
  );
  assert.deepEqual(after, ['10:00', '10:30', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00']);
});

test('book: pending with a held time and a signed confirmation link; confirm emails both sides', async () => {
  const t = await setup();
  const result = await book(
    t.deps,
    { serviceId: t.service.id, start: at('2026-11-24', '10:00'), ...visitor },
    '203.0.113.1'
  );
  assert.deepEqual(result, { status: 'pending', holdMinutes: HOLD_MINUTES });
  assert.equal(t.sent.length, 1);
  const [request] = t.sent;
  assert.equal(request.to, 'anna@example.com');
  assert.match(request.subject, /Bekräfta din bokning hos Salong Test/);
  assert.match(request.text, /tisdag 24 november 2026 kl\. 10:00–11:00/);
  const link = linkOf(request);
  assert.equal(link.pathname, '/_booking');
  const id = link.searchParams.get('b');
  assert.equal(await verifyLink(t.deps, 'confirm', id, link.searchParams.get('s')), true);
  assert.equal(await verifyLink(t.deps, 'cancel', id, link.searchParams.get('s')), false);

  const [stored] = await listBookings(t.deps);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.ipHash, undefined, 'the IP hash stays internal');
  assert.equal(t.deps.storage.locks.rows.size, 15); // 75 minutes of 5-minute cells

  assert.equal(await confirm(t.deps, id), 'confirmed');
  assert.equal(await confirm(t.deps, id), 'already');
  const [, toVisitor, toOwner] = t.sent;
  assert.match(toVisitor.subject, /^Bokning bekräftad: Klippning/);
  assert.match(toVisitor.ics.content, /METHOD:PUBLISH/);
  assert.match(toVisitor.text, /a=cancel/);
  assert.equal(toOwner.to, 'agare@salong.example');
  assert.equal(toOwner.replyTo, 'anna@example.com');
  assert.match(toOwner.text, /Phone: 070-123 45 67/);
  assert.match(toOwner.ics.content, /SUMMARY:Klippning – Salong Test/);
});

test('book: two visitors racing for overlapping times, only one gets it', async () => {
  const t = await setup();
  const start = at('2026-11-24', '10:00');
  const results = await Promise.allSettled([
    book(t.deps, { serviceId: t.service.id, start, ...visitor }, '203.0.113.1'),
    book(
      t.deps,
      {
        serviceId: t.service.id,
        start: at('2026-11-24', '10:30'),
        name: 'Bo',
        email: 'bo@example.com',
      },
      '203.0.113.2'
    ),
    book(
      t.deps,
      { serviceId: t.service.id, start, name: 'Cy', email: 'cy@example.com' },
      '203.0.113.3'
    ),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of results.filter((r) => r.status === 'rejected'))
    assert.equal(r.reason.code, 'TAKEN');
});

test('book: refuses times that are not free, bad input, and is quiet to bots', async () => {
  const t = await setup();
  const base = { serviceId: t.service.id, ...visitor };
  await assert.rejects(book(t.deps, { ...base, start: at('2026-11-23', '09:00') }, null), {
    code: 'TAKEN',
  }); // notice
  await assert.rejects(book(t.deps, { ...base, start: at('2026-11-24', '10:05') }, null), {
    code: 'TAKEN',
  }); // off step
  await assert.rejects(book(t.deps, { ...base, start: at('2026-11-28', '10:00') }, null), {
    code: 'TAKEN',
  }); // Saturday
  await assert.rejects(
    book(t.deps, { ...base, email: 'nope', start: at('2026-11-24', '10:00') }, null),
    { code: 'INVALID' }
  );
  await assert.rejects(
    book(t.deps, { ...base, serviceId: 'x', start: at('2026-11-24', '10:00') }, null),
    { code: 'NO_SERVICE' }
  );
  assert.deepEqual(
    await book(t.deps, { ...base, website: 'http://spam', start: at('2026-11-24', '10:00') }, null),
    {
      status: 'pending',
      holdMinutes: HOLD_MINUTES,
    }
  );
  assert.equal(t.sent.length, 0);
  assert.equal(t.deps.storage.bookings.rows.size, 0);
});

test('limits: per IP per hour and active bookings per email', async () => {
  const t = await setup();
  const times = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:00'];
  for (const [i, time] of times.slice(0, 5).entries())
    await book(
      t.deps,
      {
        serviceId: t.service.id,
        start: at('2026-11-25', time),
        name: 'X',
        email: `x${i}@example.com`,
      },
      '198.51.100.7'
    );
  await assert.rejects(
    book(
      t.deps,
      {
        serviceId: t.service.id,
        start: at('2026-11-25', '16:00'),
        name: 'X',
        email: 'x9@example.com',
      },
      '198.51.100.7'
    ),
    { code: 'RATE_LIMITED', status: 429 }
  );
  for (const time of ['09:00', '10:30', '12:00'])
    await book(
      t.deps,
      { serviceId: t.service.id, start: at('2026-11-26', time), ...visitor },
      null
    );
  await assert.rejects(
    book(t.deps, { serviceId: t.service.id, start: at('2026-11-26', '15:00'), ...visitor }, null),
    {
      code: 'TOO_MANY',
    }
  );
});

test('an unconfirmed hold expires: the time is free again, and a late confirm takes it only if still free', async () => {
  const t = await setup();
  const start = at('2026-11-24', '10:00');
  await book(t.deps, { serviceId: t.service.id, start, ...visitor }, null);
  const late = linkOf(t.sent[0]).searchParams.get('b');
  t.clock.now = NOW + (HOLD_MINUTES + 1) * M;
  // Before the cron runs, another visitor can already take over the stale locks.
  const other = await bookAndConfirm(t, start, { name: 'Bo', email: 'bo@example.com' });
  assert.ok(other);
  assert.equal(await confirm(t.deps, late), 'gone');
  assert.equal((await listBookings(t.deps, { status: ['expired'] })).length, 1);
});

test('a late confirm after expiry succeeds when nobody took the time', async () => {
  const t = await setup();
  await book(
    t.deps,
    { serviceId: t.service.id, start: at('2026-11-24', '10:00'), ...visitor },
    null
  );
  const id = linkOf(t.sent[0]).searchParams.get('b');
  t.clock.now = NOW + (HOLD_MINUTES + 10) * M;
  assert.deepEqual((await maintenance(t.deps)).expired, 1);
  assert.equal(t.deps.storage.locks.rows.size, 0);
  assert.equal(await confirm(t.deps, id), 'confirmed');
  assert.equal(t.deps.storage.locks.rows.size, 15);
});

test('cancel by the visitor frees the time and emails both; staff can cancel quietly', async () => {
  const t = await setup();
  const id = await bookAndConfirm(t, at('2026-11-24', '10:00'));
  const count = t.sent.length;
  assert.equal(await cancel(t.deps, id, 'visitor'), 'cancelled');
  assert.equal(await cancel(t.deps, id, 'visitor'), 'already');
  assert.equal(t.deps.storage.locks.rows.size, 0);
  const [toVisitor, toOwner] = t.sent.slice(count);
  assert.match(toVisitor.subject, /^Avbokad/);
  assert.match(toVisitor.ics.content, /METHOD:CANCEL[\s\S]*SEQUENCE:2\r\nSTATUS:CANCELLED/);
  assert.match(toOwner.text, /cancelled by the visitor/);
  const free = (await slots(t.deps, t.service.id, '2026-11-24', 1)).days[0].starts.map(
    (s) => s.time
  );
  assert.ok(free.includes('10:00'));

  const id2 = await bookAndConfirm(t, at('2026-11-25', '10:00'));
  const before = t.sent.length;
  assert.equal(await cancel(t.deps, id2, 'staff', { notifyVisitor: false }), 'cancelled');
  assert.deepEqual(
    t.sent.slice(before).map((m) => m.to),
    ['agare@salong.example']
  );
});

test('the visitor cannot cancel after the start; staff can', async () => {
  const t = await setup();
  const id = await bookAndConfirm(t, at('2026-11-23', '10:00'));
  t.clock.now = fromLocal('2026-11-23', '10:30');
  assert.equal(await cancel(t.deps, id, 'visitor'), 'past');
  assert.equal(await cancel(t.deps, id, 'staff'), 'cancelled');
});

test('blocked time and exceptions remove free times', async () => {
  const t = await setup();
  const block = await createBlock(t.deps, {
    start: at('2026-11-24', '09:00'),
    end: at('2026-11-24', '12:00'),
    note: 'Tandläkare',
  });
  assert.equal(block.overlappingBookings, 0);
  await setSchedule(t.deps, { exceptions: [{ date: '2026-11-25', hours: [] }] });
  const s = await slots(t.deps, t.service.id, '2026-11-24', 2);
  assert.equal(s.days[0].starts[0].time, '12:00');
  assert.deepEqual(s.days[1].starts, []);
  await assert.rejects(setSchedule(t.deps, { stepMinutes: 7 }), BookingError);
});

test('reminders: a day before, once, not for late bookings', async () => {
  const t = await setup();
  const early = await bookAndConfirm(t, at('2026-11-26', '10:00'));
  await bookAndConfirm(t, at('2026-11-24', '10:00'), { name: 'Bo', email: 'bo@example.com' }); // < 36 h ahead
  t.clock.now = fromLocal('2026-11-25', '10:30');
  const before = t.sent.length;
  assert.equal((await maintenance(t.deps, true)).reminded, 1);
  assert.equal((await maintenance(t.deps, true)).reminded, 0);
  const [reminder] = t.sent.slice(before);
  assert.equal(reminder.to, 'anna@example.com');
  assert.match(reminder.subject, /^Påminnelse: Klippning torsdag 26 november/);
  assert.ok(early);
});

test('retention: bookings are deleted a year after the appointment, unconfirmed ones after 30 days', async () => {
  const t = await setup();
  await bookAndConfirm(t, at('2026-11-24', '10:00'));
  await book(
    t.deps,
    {
      serviceId: t.service.id,
      start: at('2026-11-25', '10:00'),
      name: 'Bo',
      email: 'bo@example.com',
    },
    null
  );
  t.clock.now = NOW + 31 * 24 * 60 * M;
  await maintenance(t.deps, true);
  assert.deepEqual(
    (await listBookings(t.deps)).map((b) => b.status),
    ['confirmed']
  );
  t.clock.now = fromLocal('2027-11-25', '12:00');
  await maintenance(t.deps, true);
  assert.equal(t.deps.storage.bookings.rows.size, 0);
  assert.equal(t.deps.storage.locks.rows.size, 0);
});

test('the maintenance pass runs at most every 5 minutes unless forced', async () => {
  const t = await setup();
  await maintenance(t.deps);
  await book(
    t.deps,
    { serviceId: t.service.id, start: at('2026-11-24', '10:00'), ...visitor },
    null
  );
  t.clock.now = NOW + (HOLD_MINUTES + 1) * M;
  assert.equal((await maintenance(t.deps)).expired, 1);
  assert.deepEqual(await maintenance(t.deps), {});
});

const ical = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:x\r\n${body}\r\nEND:VCALENDAR\r\n`;

test("the customer's calendar: busy times block slots, own bookings in it are ignored, errors keep the last good read", async () => {
  const t = await setup({
    calendarText: ical(
      [
        'BEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=Europe/Stockholm:20261124T090000\r\nDTEND;TZID=Europe/Stockholm:20261124T120000\r\nSUMMARY:Privat\r\nEND:VEVENT',
        'BEGIN:VEVENT\r\nUID:x@himlio-booking\r\nDTSTART;TZID=Europe/Stockholm:20261124T130000\r\nDTEND;TZID=Europe/Stockholm:20261124T170000\r\nEND:VEVENT',
      ].join('\r\n')
    ),
  });
  const status = await setCalendar(t.deps, 'webcal://calendar.example/secret/basic.ics');
  assert.equal(status.url, 'https://calendar.example/…');
  assert.equal(status.events, 1);
  assert.equal(status.error, undefined);
  const free = (await slots(t.deps, t.service.id, '2026-11-24', 1)).days[0].starts.map(
    (s) => s.time
  );
  assert.equal(free[0], '12:00');
  assert.ok(free.includes('13:00'));

  t.deps.calendarText = () => {
    throw new Error('404 Not Found');
  };
  t.clock.now += 6 * M;
  await maintenance(t.deps, true);
  const after = await getCalendar(t.deps);
  assert.equal(after.error, '404 Not Found');
  assert.equal((await busyBetween(t.deps, NOW, fromLocal('2026-11-25', '00:00'))).length, 1);
  await assert.rejects(setCalendar(t.deps, 'http://calendar.example/x.ics'), BookingError);
  assert.equal(await setCalendar(t.deps, null), null);
  assert.equal(await getCalendar(t.deps), null);
});

test('feed: confirmed and cancelled bookings for a valid key; rotating changes the key', async () => {
  const t = await setup();
  const id = await bookAndConfirm(t, at('2026-11-24', '10:00'));
  await bookAndConfirm(t, at('2026-11-25', '10:00'), { name: 'Bo', email: 'bo@example.com' });
  await cancel(t.deps, id, 'visitor');
  await book(
    t.deps,
    {
      serviceId: t.service.id,
      start: at('2026-11-26', '10:00'),
      name: 'Cy',
      email: 'cy@example.com',
    },
    null
  );
  const url = new URL(await feedUrl(t.deps));
  const text = await feed(t.deps, url.searchParams.get('k'));
  assert.equal(text.match(/BEGIN:VEVENT/g).length, 2); // the pending one is not in it
  assert.match(text, /SUMMARY:Klippning: Anna Andersson[\s\S]*STATUS:CANCELLED/);
  assert.match(text, /SUMMARY:Klippning: Bo/);
  assert.equal(await feed(t.deps, 'nope'), null);
  const next = new URL(await rotateFeed(t.deps)).searchParams.get('k');
  assert.equal(await feed(t.deps, url.searchParams.get('k')), null);
  assert.ok(await feed(t.deps, next));
});

test('settings: own recipients replace the platform list; bad addresses are refused', async () => {
  const t = await setup();
  await setSettings(t.deps, {
    notifyEmails: ['bokning@salong.example', ' bokning@salong.example '],
    location: 'Storgatan 1, Ort',
  });
  await bookAndConfirm(t, at('2026-11-24', '10:00'));
  const owner = t.sent.at(-1);
  assert.equal(owner.to, 'bokning@salong.example');
  assert.match(owner.ics.content, /LOCATION:Storgatan 1\\, Ort/);
  await assert.rejects(setSettings(t.deps, { notifyEmails: ['nope'] }), BookingError);
});

test('a failed confirmation email leaves nothing booked', async () => {
  const t = await setup();
  t.deps.failSend = true;
  await assert.rejects(
    book(t.deps, { serviceId: t.service.id, start: at('2026-11-24', '10:00'), ...visitor }, null),
    { code: 'EMAIL_FAILED' }
  );
  assert.equal(t.deps.storage.bookings.rows.size, 0);
  assert.equal(t.deps.storage.locks.rows.size, 0);
});

test('times shown are Stockholm local', async () => {
  const t = await setup();
  const s = await slots(t.deps, t.service.id, '2026-11-24', 1);
  assert.equal(toLocal(Date.parse(s.days[0].starts[0].start)).time, s.days[0].starts[0].time);
});
