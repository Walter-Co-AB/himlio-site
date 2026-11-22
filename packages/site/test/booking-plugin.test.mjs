import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingPlugin } from '../dist/booking-plugin.js';
import { saveService } from '../dist/booking/core.js';
import { bookingMcpTools, bookingRoutes } from '../dist/booking/routes.js';
import { BOOKING_STORAGE } from '../dist/booking/store.js';
import { bookingPage, isBookingPage } from '../dist/runtime/booking-pages.js';
import { fromLocal } from '../dist/booking/time.js';
import { deps as makeDeps } from './booking-fakes.mjs';

test('the descriptor names the entrypoint the package exports, with every flat index', async () => {
  const d = bookingPlugin();
  assert.equal(d.id, 'himlio-booking');
  assert.equal(d.entrypoint, '@himlio/site/booking/plugin');
  const pkg = JSON.parse(
    (await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  );
  assert.ok(pkg.exports['./booking/plugin']);
  for (const [name, c] of Object.entries(BOOKING_STORAGE))
    assert.deepEqual(
      d.storage[name].indexes,
      c.indexes.filter((i) => typeof i === 'string')
    );
});

test('every MCP tool points at a route; visitor routes are public, the rest need a permission', () => {
  const routes = bookingRoutes(() => {
    throw new Error('not called');
  });
  for (const [name, tool] of Object.entries(bookingMcpTools())) {
    const route = routes[tool.route];
    assert.ok(route, `${name} -> ${tool.route}`);
    assert.ok(!route.public, `${name} must not use a public route`);
  }
  const publicRoutes = Object.entries(routes)
    .filter(([, r]) => r.public)
    .map(([n]) => n);
  assert.deepEqual(publicRoutes.sort(), ['book', 'feed', 'link', 'services', 'slots']);
  for (const [name, r] of Object.entries(routes))
    if (!r.public) assert.match(r.permission, /^plugins:(read|manage)$/, name);
  // Where visitors' data goes stays in the admin.
  const toolRoutes = Object.values(bookingMcpTools()).map((t) => t.route);
  for (const r of ['settings/get', 'settings/update', 'calendar/set', 'feed/rotate', 'maintenance'])
    assert.ok(!toolRoutes.includes(r), r);
});

test('/_booking: GET shows a button, POST acts, through the public link route', async () => {
  const t = makeDeps({ now: fromLocal('2026-11-23', '08:00') });
  const service = await saveService(t.deps, { name: 'Klippning', durationMinutes: 60 });
  const routes = bookingRoutes(() => t.deps);
  await routes.book.handler({
    input: {
      serviceId: service.id,
      start: new Date(fromLocal('2026-11-24', '10:00')).toISOString(),
      name: 'A',
      email: 'a@example.com',
    },
    requestMeta: { ip: null },
  });
  const link = t.sent[0].text.match(/https:\/\/\S+/)[0];
  const runtime = {
    async handlePublicPluginApiRoute(pluginId, method, path, request) {
      assert.equal(pluginId, 'himlio-booking');
      assert.equal(path, '/link');
      const data = await routes.link.handler({ input: await request.json() });
      return { success: true, data };
    },
  };
  assert.equal(isBookingPage(new URL(link)), true);
  const get = await bookingPage(new Request(link), runtime, 'Salong');
  const html = await get.text();
  assert.equal(get.status, 200);
  assert.match(get.headers.get('content-type'), /text\/html/);
  assert.match(html, /<h1>Bekräfta bokningen<\/h1>/);
  assert.match(html, /<form method="post" action="\/_booking\?a=confirm&amp;b=/);
  assert.equal(t.sent.length, 1, 'a GET changes nothing');
  const post = await bookingPage(new Request(link, { method: 'POST' }), runtime, 'Salong');
  assert.match(await post.text(), /Bokningen är bekräftad/);
  assert.equal(t.sent.length, 3);
  const forged = await bookingPage(new Request(link.replace(/s=[^&]+/, 's=x')), runtime, 'Salong');
  assert.equal(forged.status, 404);
  const put = await bookingPage(new Request(link, { method: 'PUT' }), runtime, 'Salong');
  assert.equal(put.status, 405);
});
