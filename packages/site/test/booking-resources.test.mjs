import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approve,
  book,
  cancel,
  confirm,
  createBlock,
  decline,
  deleteResource,
  feed,
  feedUrl,
  listBookings,
  maintenance,
  rebook,
  rebookOptions,
  saveResource,
  saveService,
  setCalendar,
  slots,
} from '../dist/booking/core.js';
import { bookingRoutes } from '../dist/booking/routes.js';
import { fromLocal } from '../dist/booking/time.js';
import { bookingPage } from '../dist/runtime/booking-pages.js';
import { deps as makeDeps } from './booking-fakes.mjs';

const NOW = fromLocal('2026-11-23', '08:00'); // Monday
const at = (date, time) => new Date(fromLocal(date, time)).toISOString();
const linkOf = (mail, action = 'confirm') =>
  new URL(mail.text.match(new RegExp(`https://\\S+a=${action}\\S+`))[0]);
const times = (s, date) => s.days.find((d) => d.date === date).starts.map((x) => x.time);
const visitor = (n = 1) => ({ name: `V${n}`, email: `v${n}@example.com` });

async function salon() {
  const t = makeDeps({ now: NOW });
  const cut = await saveService(t.deps, { name: 'Klippning', durationMinutes: 60 });
  const colour = await saveService(t.deps, { name: 'Färg', durationMinutes: 120 });
  const anna = await saveResource(t.deps, { name: 'Anna', durations: { [cut.id]: 45 } });
  const bo = await saveResource(t.deps, {
    name: 'Bo',
    serviceIds: [cut.id],
    // Bo works Tuesday–Thursday 12–18 only.
    hours: [
      [],
      [{ start: '12:00', end: '18:00' }],
      [{ start: '12:00', end: '18:00' }],
      [{ start: '12:00', end: '18:00' }],
      [],
      [],
      [],
    ],
  });
  return { ...t, cut, colour, anna, bo };
}

async function bookConfirmed(t, input) {
  await book(t.deps, input, null);
  const id = linkOf(t.sent.at(-1)).searchParams.get('b');
  const result = await confirm(t.deps, id);
  return { id, result };
}

test('resources: own hours, services and lengths; "any" is the union of who is free', async () => {
  const t = await salon();
  const any = await slots(t.deps, t.cut.id, '2026-11-24', 1);
  assert.deepEqual(
    any.resources.map((r) => r.name),
    ['Anna', 'Bo']
  );
  const tue = any.days[0].starts;
  assert.deepEqual(tue.find((s) => s.time === '09:00').resources, [t.anna.id]);
  assert.deepEqual(
    tue.find((s) => s.time === '12:00').resources.sort(),
    [t.anna.id, t.bo.id].sort()
  );
  assert.ok(times(any, '2026-11-24').includes('17:00')); // Bo until 18
  // Anna's own length: 45 min fits at 16:00 (site hours to 17:00).
  assert.ok(
    times(await slots(t.deps, t.cut.id, '2026-11-24', 1, t.anna.id), '2026-11-24').includes('16:00')
  );
  // Bo doesn't do colour.
  const colour = await slots(t.deps, t.colour.id, '2026-11-24', 1);
  assert.deepEqual(
    colour.resources.map((r) => r.name),
    ['Anna']
  );
  assert.deepEqual(
    times(await slots(t.deps, t.cut.id, '2026-11-23', 1, t.bo.id), '2026-11-23'),
    []
  ); // Monday off
});

test('resources: "any" books whoever is free; the same time for two people is two bookings', async () => {
  const t = await salon();
  const start = at('2026-11-24', '13:00');
  const a = await bookConfirmed(t, { serviceId: t.cut.id, start, ...visitor(1) });
  const b = await bookConfirmed(t, { serviceId: t.cut.id, start, ...visitor(2) });
  assert.equal(a.result, 'confirmed');
  assert.equal(b.result, 'confirmed');
  const booked = await listBookings(t.deps, { status: ['confirmed'] });
  assert.deepEqual(booked.map((x) => x.resourceName).sort(), ['Anna', 'Bo']);
  assert.equal(booked.find((x) => x.resourceName === 'Anna').end, at('2026-11-24', '13:45'));
  await assert.rejects(book(t.deps, { serviceId: t.cut.id, start, ...visitor(3) }, null), {
    code: 'TAKEN',
  });
  // A named resource that doesn't offer the service can't be booked for it.
  await assert.rejects(
    book(
      t.deps,
      {
        serviceId: t.colour.id,
        resourceId: t.bo.id,
        start: at('2026-11-25', '13:00'),
        ...visitor(4),
      },
      null
    ),
    { code: 'NO_RESOURCE' }
  );
});

test('resources: time off and blocks per person; site holidays close everyone', async () => {
  const t = await salon();
  await saveResource(t.deps, { id: t.anna.id, exceptions: [{ date: '2026-11-24', hours: [] }] });
  await createBlock(t.deps, {
    start: at('2026-11-25', '12:00'),
    end: at('2026-11-25', '15:00'),
    resourceId: t.bo.id,
  });
  const tue = await slots(t.deps, t.cut.id, '2026-11-24', 2);
  assert.equal(times(tue, '2026-11-24')[0], '12:00'); // only Bo
  assert.ok(times(tue, '2026-11-25').includes('09:00')); // Anna; Bo blocked 12-15
  assert.ok(
    tue.days[1].starts.find((s) => s.time === '13:00').resources.every((r) => r === t.anna.id)
  );
  const { setSchedule } = await import('../dist/booking/core.js');
  await setSchedule(t.deps, {
    exceptions: [{ date: '2026-11-26', hours: [{ start: '10:00', end: '14:00' }] }],
  });
  const thu = times(await slots(t.deps, t.cut.id, '2026-11-26', 1, t.bo.id), '2026-11-26');
  assert.deepEqual(thu, ['12:00', '12:30', '13:00']); // Bo's 12–18 within the site's 10–14
});

test('bookings from before resources block everyone; a resource with upcoming bookings cannot be deleted', async () => {
  const t = makeDeps({ now: NOW });
  const cut = await saveService(t.deps, { name: 'Klippning', durationMinutes: 60 });
  await bookConfirmed(t, { serviceId: cut.id, start: at('2026-11-24', '10:00'), ...visitor(1) });
  const anna = await saveResource(t.deps, { name: 'Anna' });
  assert.ok(!times(await slots(t.deps, cut.id, '2026-11-24', 1), '2026-11-24').includes('10:00'));
  await bookConfirmed(t, { serviceId: cut.id, start: at('2026-11-25', '10:00'), ...visitor(2) });
  await assert.rejects(deleteResource(t.deps, anna.id), { code: 'HAS_BOOKINGS' });
});

test('request mode: held until the business answers; approve confirms, decline frees, silence lapses', async () => {
  const t = makeDeps({ now: NOW });
  const tattoo = await saveService(t.deps, {
    name: 'Tatuering',
    durationMinutes: 180,
    mode: 'request',
    price: { kind: 'from', amount: 2500 },
    questions: [
      { id: 'placement', label: 'Placering', required: true },
      { id: 'idea', label: 'Beskriv motivet', long: true },
    ],
  });
  await assert.rejects(
    book(t.deps, { serviceId: tattoo.id, start: at('2026-11-24', '09:00'), ...visitor(1) }, null),
    /Placering/
  );
  const r1 = await bookConfirmed(t, {
    serviceId: tattoo.id,
    start: at('2026-11-24', '09:00'),
    ...visitor(1),
    answers: { placement: 'Underarm', idea: 'En räv\nmed blommor' },
  });
  assert.equal(r1.result, 'requested');
  const [received, toOwner] = t.sent.slice(-2);
  assert.match(received.subject, /^Förfrågan mottagen/);
  assert.match(toOwner.subject, /^Booking request/);
  assert.match(toOwner.text, /Placering: Underarm/);
  assert.match(toOwner.text, /Beskriv motivet: En räv\nmed blommor/);
  assert.ok(
    !times(await slots(t.deps, tattoo.id, '2026-11-24', 1), '2026-11-24').includes('09:00')
  );

  const before = t.sent.length;
  assert.equal(await approve(t.deps, r1.id), 'confirmed');
  const approved = t.sent.slice(before);
  assert.deepEqual(
    approved.map((m) => m.to),
    ['v1@example.com']
  );
  assert.match(approved[0].subject, /^Bokning bekräftad/);

  const r2 = await bookConfirmed(t, {
    serviceId: tattoo.id,
    start: at('2026-11-25', '09:00'),
    ...visitor(2),
    answers: { placement: 'Rygg' },
  });
  assert.equal(await decline(t.deps, r2.id, 'Vi gör inte den stilen.'), 'declined');
  assert.match(t.sent.at(-1).text, /Vi gör inte den stilen\./);
  assert.ok(times(await slots(t.deps, tattoo.id, '2026-11-25', 1), '2026-11-25').includes('09:00'));

  const r3 = await bookConfirmed(t, {
    serviceId: tattoo.id,
    start: at('2026-11-30', '09:00'),
    ...visitor(3),
    answers: { placement: 'Arm' },
  });
  assert.equal(r3.result, 'requested');
  t.clock.now = NOW + 73 * 3_600_000;
  assert.equal((await maintenance(t.deps, true)).lapsed, 1);
  assert.match(t.sent.at(-1).text, /hann tyvärr inte svara/);
  assert.equal((await listBookings(t.deps, { status: ['expired'] })).length, 1);
});

test('cancellation deadline: the visitor can cancel or move until N hours before, staff any time', async () => {
  const t = makeDeps({ now: NOW });
  const cut = await saveService(t.deps, {
    name: 'Klippning',
    durationMinutes: 60,
    cancelHours: 24,
  });
  const { id } = await bookConfirmed(t, {
    serviceId: cut.id,
    start: at('2026-11-25', '10:00'),
    ...visitor(1),
  });
  const confirmation = t.sent.at(-2);
  assert.match(confirmation.text, /Avboka eller boka om senast tisdag 24 november kl\. 10:00/);
  assert.match(confirmation.text, /Boka om: https:\/\/\S+a=rebook/);
  t.clock.now = fromLocal('2026-11-24', '11:00');
  assert.equal(await cancel(t.deps, id, 'visitor'), 'late');
  assert.equal((await rebookOptions(t.deps, id)).state, 'late');
  assert.equal(await rebook(t.deps, id, at('2026-11-26', '10:00')), 'late');
  assert.equal(await cancel(t.deps, id, 'staff'), 'cancelled');
});

test('rebook: free times with the same person, the move frees the old time, both sides told', async () => {
  const t = await salon();
  const { id } = await bookConfirmed(t, {
    serviceId: t.cut.id,
    resourceId: t.bo.id,
    start: at('2026-11-24', '13:00'),
    ...visitor(1),
  });
  const options = await rebookOptions(t.deps, id, '2026-11-24', 2);
  assert.equal(options.state, 'ok');
  assert.ok(times(options, '2026-11-24').includes('13:00'), 'its own time counts as free');
  assert.equal(times(options, '2026-11-24')[0], '12:00'); // Bo's hours
  const before = t.sent.length;
  assert.equal(await rebook(t.deps, id, at('2026-11-25', '15:00')), 'moved');
  const [toVisitor, toOwner] = t.sent.slice(before);
  assert.match(toVisitor.subject, /^Ombokad: Klippning hos Bo, onsdag 25 november/);
  assert.match(toVisitor.ics.content, /SEQUENCE:2/);
  assert.match(toOwner.subject, /^Moved/);
  // The old time is free for Bo; the new one is taken.
  const bo = await slots(t.deps, t.cut.id, '2026-11-24', 2, t.bo.id);
  assert.ok(times(bo, '2026-11-24').includes('13:00'));
  assert.ok(!times(bo, '2026-11-25').includes('15:00'));
  assert.equal(t.deps.storage.locks.rows.size, 12); // 60 min of Bo's cells only
  assert.equal(await rebook(t.deps, id, at('2026-11-25', '09:00')), 'taken'); // Bo starts at 12
});

test('Turnstile: a verified visitor is booked at once; a failed check falls back to email', async () => {
  const t = makeDeps({ now: NOW });
  const cut = await saveService(t.deps, { name: 'Klippning', durationMinutes: 60 });
  t.deps.verifyHuman = async (token) => token === 'ok';
  const r = await book(
    t.deps,
    { serviceId: cut.id, start: at('2026-11-24', '10:00'), ...visitor(1), turnstileToken: 'ok' },
    null
  );
  assert.equal(r.status, 'confirmed');
  assert.deepEqual(
    t.sent.map((m) => m.subject.split(':')[0]),
    ['Bokning bekräftad', 'New booking']
  );
  const r2 = await book(
    t.deps,
    { serviceId: cut.id, start: at('2026-11-24', '12:00'), ...visitor(2), turnstileToken: 'bad' },
    null
  );
  assert.equal(r2.status, 'pending');
  assert.match(t.sent.at(-1).subject, /^Bekräfta din bokning/);
});

test('feeds and calendars per resource', async () => {
  const t = await salon();
  await bookConfirmed(t, {
    serviceId: t.cut.id,
    resourceId: t.anna.id,
    start: at('2026-11-24', '10:00'),
    ...visitor(1),
  });
  await bookConfirmed(t, {
    serviceId: t.cut.id,
    resourceId: t.bo.id,
    start: at('2026-11-24', '13:00'),
    ...visitor(2),
  });
  const annaFeed = new URL(await feedUrl(t.deps, t.anna.id));
  const text = await feed(t.deps, annaFeed.searchParams.get('k'), t.anna.id);
  assert.equal(text.match(/BEGIN:VEVENT/g).length, 1);
  assert.match(text, /X-WR-CALNAME:Bokningar – Anna\\, Salong Test/);
  assert.equal(
    await feed(t.deps, annaFeed.searchParams.get('k'), t.bo.id),
    null,
    "Anna's key isn't Bo's"
  );
  const all = new URL(await feedUrl(t.deps));
  assert.equal((await feed(t.deps, all.searchParams.get('k'))).match(/BEGIN:VEVENT/g).length, 2);

  t.deps.calendarText =
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:x\r\nBEGIN:VEVENT\r\nUID:p\r\nDTSTART;TZID=Europe/Stockholm:20261125T120000\r\nDTEND;TZID=Europe/Stockholm:20261125T180000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  await setCalendar(t.deps, 'https://cal.example/bo.ics', t.bo.id);
  const wed = await slots(t.deps, t.cut.id, '2026-11-25', 1);
  assert.ok(
    wed.days[0].starts.every((s) => !s.resources.includes(t.bo.id)),
    "Bo's own calendar blocks only Bo"
  );
  assert.ok(times(wed, '2026-11-25').includes('13:00')); // Anna
});

test('the public services route: prices, modes, questions and who does what; unstaffed services hidden', async () => {
  const t = await salon();
  await saveService(t.deps, { id: t.cut.id, price: { kind: 'fixed', amount: 650 } });
  const lonely = await saveService(t.deps, { name: 'Ingen gör detta', durationMinutes: 30 });
  await saveResource(t.deps, { id: t.anna.id, serviceIds: [t.cut.id, t.colour.id] });
  const routes = bookingRoutes(() => t.deps);
  const { items } = await routes.services.handler({ input: {} });
  assert.deepEqual(items.map((s) => s.name).sort(), ['Färg', 'Klippning']);
  assert.ok(!items.some((s) => s.id === lonely.id));
  const cut = items.find((s) => s.name === 'Klippning');
  assert.deepEqual(cut.price, { kind: 'fixed', amount: 650 });
  assert.deepEqual(
    cut.resources.map((r) => [r.name, r.durationMinutes]),
    [
      ['Anna', 45],
      ['Bo', 60],
    ]
  );
});

test('/_booking rebook: lists times as buttons; a POST with t moves the booking', async () => {
  const t = makeDeps({ now: NOW });
  const cut = await saveService(t.deps, { name: 'Klippning', durationMinutes: 60 });
  const { id } = await bookConfirmed(t, {
    serviceId: cut.id,
    start: at('2026-11-24', '10:00'),
    ...visitor(1),
  });
  const routes = bookingRoutes(() => t.deps);
  const runtime = {
    async handlePublicPluginApiRoute(_p, _m, _path, request) {
      return { success: true, data: await routes.link.handler({ input: await request.json() }) };
    },
  };
  const link = linkOf(t.sent.at(-2), 'rebook').toString();
  const page = await (await bookingPage(new Request(link), runtime, 'Salong')).text();
  assert.match(page, /<h1>Boka om<\/h1>/);
  const action = page.match(/action="([^"]+t=2026-11-25T08%3A00[^"]*)"/)[1].replace(/&amp;/g, '&');
  assert.match(page, /Senare datum/);
  const done = await (
    await bookingPage(new Request(new URL(action, link), { method: 'POST' }), runtime, 'Salong')
  ).text();
  assert.match(done, /Bokningen är flyttad/);
  assert.match(done, /onsdag 25 november 2026 kl\. 09:00–10:00/);
  assert.equal((await listBookings(t.deps))[0].start, at('2026-11-25', '09:00'));
  assert.ok(id);
});
