import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  readHimlio,
  readModelMigrations,
  validateOptions,
  writeGenerated,
} from '../dist/config.js';

function site(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'himlio-site-'));
  const all = {
    'himlio.json': JSON.stringify({ slug: 'acme', name: 'Acme AB', locale: 'sv', url: null }),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
const generated = (root) => JSON.parse(readFileSync(join(root, '.himlio/wrangler.json'), 'utf8'));

test('readHimlio: defaults, and email only when set', () => {
  const facts = readHimlio(site({ 'himlio.json': '{"slug":"a","name":"A"}' }));
  assert.deepEqual(facts, {
    slug: 'a',
    name: 'A',
    locale: 'sv',
    url: null,
    forms: { notify: [] },
  });
});

test('readHimlio: form recipients from forms.notify; missing is empty, invalid fails', () => {
  const read = (forms) =>
    readHimlio(site({ 'himlio.json': JSON.stringify({ slug: 'a', name: 'A', forms }) })).forms;
  assert.deepEqual(read({ notify: ['anton@walterco.se', 'anton@walterco.se', 'b@example.com'] }), {
    notify: ['anton@walterco.se', 'b@example.com'],
  });
  assert.deepEqual(read({}), { notify: [] });
  assert.deepEqual(read(null), { notify: [] });
  assert.throws(() => read({ notify: 'anton@walterco.se' }), /must be a list/);
  for (const bad of [
    'anton',
    'a b@example.com',
    'Anton <a@example.com>',
    'a@example.com,b@example.com',
    7,
  ])
    assert.throws(() => read({ notify: [bad] }), /invalid address/, String(bad));
});

test('the generated Worker config: platform bindings, EmDash rooms, the platform cron', () => {
  const root = site();
  writeGenerated(root, {});
  const c = generated(root);
  assert.equal(c.compatibility_date, '2026-11-01');
  assert.deepEqual(
    c.d1_databases.map((d) => d.binding),
    ['DB']
  );
  assert.deepEqual(
    c.r2_buckets.map((d) => d.binding),
    ['MEDIA']
  );
  assert.deepEqual(c.send_email, [{ name: 'EMAIL' }]);
  assert.equal(c.vars.HIMLIO_SLUG, 'acme');
  assert.deepEqual(c.durable_objects.bindings, [
    { name: 'EMDASH_ROOMS', class_name: 'EmDashRoom' },
  ]);
  assert.deepEqual(c.triggers.crons, ['* * * * *']);
  assert.match(c.main, /dist\/runtime\/worker\.js$/);
  assert.equal(c.kv_namespaces, undefined);
});

test('site options: crons, vars and Durable Objects (with src/worker.ts)', () => {
  const root = site({ 'src/worker.ts': 'export {}' });
  writeGenerated(root, {
    crons: { '0 3 * * *': './src/cron/nightly.ts' },
    vars: { GREETING: 'hej' },
    durableObjects: [{ binding: 'COUNTER', className: 'Counter' }],
  });
  const c = generated(root);
  assert.deepEqual(c.triggers.crons, ['* * * * *', '0 3 * * *']);
  assert.equal(c.vars.GREETING, 'hej');
  assert.equal(c.main, join(root, 'src/worker.ts'));
  assert.deepEqual(c.durable_objects.bindings[1], { name: 'COUNTER', class_name: 'Counter' });
  assert.deepEqual(c.migrations[1], { tag: 'site-Counter', new_sqlite_classes: ['Counter'] });
});

test('D1 migrations: platform 0001–0099 merged with the site 0100+', () => {
  const root = site({ 'migrations/0100_bookings.sql': 'CREATE TABLE b (id TEXT);' });
  writeGenerated(root, {});
  const merged = readdirSync(join(root, '.himlio/migrations')).sort();
  assert.ok(merged.includes('0001_himlio_sessions.sql'));
  assert.ok(merged.includes('0100_bookings.sql'));
  assert.throws(
    () => writeGenerated(site({ 'migrations/0050_mine.sql': '' }), {}),
    /start at 0100/
  );
  assert.throws(() => writeGenerated(site({ 'migrations/bookings.sql': '' }), {}), /0100_create/);
});

test('model migrations: the platform first (unprefixed), then the site (site/...)', () => {
  const root = site({
    'model/0001_products.json': JSON.stringify({ version: '1', collections: [] }),
  });
  const names = readModelMigrations(root, { modelMigrations: 'model' }).map((m) => m.name);
  assert.equal(names[0], '0001_company');
  assert.equal(names.at(-1), 'site/0001_products');
  const blocks = site({
    'model/0001_sections.json': JSON.stringify({ version: '1', blockTypes: [], collections: [] }),
  });
  assert.equal(
    readModelMigrations(blocks, { modelMigrations: 'model' }).at(-1).name,
    'site/0001_sections'
  );
  const bad = site({ 'model/0001_x.json': JSON.stringify({ version: '1', settings: {} }) });
  assert.throws(
    () => readModelMigrations(bad, { modelMigrations: 'model' }),
    /only blockTypes, collections, content and relabel/
  );
});

test('model migrations are validated as EmDash seeds at build time', () => {
  const root = site({
    'model/0001_pages.json': JSON.stringify({ collections: [] }), // no version
  });
  assert.throws(
    () => readModelMigrations(root, { modelMigrations: 'model' }),
    /0001_pages.json: .*version/
  );
});

test('relabel entries are checked at build time', () => {
  const read = (relabel) =>
    readModelMigrations(site({ 'model/0001_x.json': JSON.stringify({ version: '1', relabel }) }), {
      modelMigrations: 'model',
    });
  assert.equal(
    read([
      { collection: 'pages', label: ['Sidor', 'Pages'], labelSingular: ['Sida', 'Page'] },
      { collection: 'pages', field: 'title', label: ['Rubrik', 'Title'] },
    ]).at(-1).name,
    'site/0001_x'
  );
  assert.throws(() => read({}), /must be a list/);
  assert.throws(() => read([{ label: ['a', 'b'] }]), /needs a collection/);
  assert.throws(() => read([{ collection: 'pages' }]), /changes nothing/);
  assert.throws(() => read([{ collection: 'pages', label: 'Pages' }]), /\["from", "to"\]/);
  assert.throws(
    () => read([{ collection: 'pages', field: 'title', description: ['a', 'b'] }]),
    /can't change "description" of a field/
  );
  assert.throws(() => read([{ collection: 'pages', slug: ['a', 'b'] }]), /can't change "slug"/);
});

test('invalid options are refused', () => {
  const crons = (n) => Object.fromEntries([...Array(n)].map((_, i) => [`${i} 3 * * *`, './x.ts']));
  assert.throws(() => validateOptions({ crons: crons(3) }), /at most 2/);
  assert.throws(
    () => validateOptions({ crons: { '* * * * *': './x.ts' } }),
    /used by the platform/
  );
  assert.throws(() => validateOptions({ crons: { '0 3 * * MON': './x.ts' } }), /5 fields/);
  assert.throws(() => validateOptions({ vars: { DB: 'x' } }), /reserved/);
  assert.throws(() => validateOptions({ vars: { lower: 'x' } }), /UPPER_SNAKE_CASE/);
  assert.throws(
    () => validateOptions({ durableObjects: [{ binding: 'EMDASH_ROOMS', className: 'X' }] }),
    /reserved/
  );
  assert.throws(
    () => writeGenerated(site(), { durableObjects: [{ binding: 'C', className: 'C' }] }),
    /src\/worker\.ts/
  );
});
