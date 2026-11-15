import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('../../seed/migrations/', import.meta.url);
const read = (url) => JSON.parse(readFileSync(url, 'utf8'));
const seed = read(new URL('../../seed/seed.json', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort();

test('migration files are named NNNN_name.json and numbered without gaps', () => {
  assert.ok(files.length > 0);
  files.forEach((file, i) => {
    assert.match(file, /^\d{4}_[a-z0-9_]+\.json$/);
    assert.equal(Number(file.slice(0, 4)), i + 1, file);
  });
});

test('migrations only touch the content model and content, never settings or menus', () => {
  for (const file of files) {
    const m = read(new URL(file, dir));
    for (const key of Object.keys(m))
      assert.ok(
        ['$schema', 'version', 'meta', 'collections', 'content'].includes(key),
        `${file}: ${key}`
      );
    assert.equal(m.version, '1', file);
  }
});

test('everything a migration adds is also in seed.json, so new sites get it at setup', () => {
  for (const file of files) {
    const m = read(new URL(file, dir));
    for (const col of m.collections ?? []) {
      const inSeed = seed.collections.find((c) => c.slug === col.slug);
      assert.ok(inSeed, `${file}: collection ${col.slug} missing from seed.json`);
      for (const field of col.fields ?? []) {
        const f = inSeed.fields.find((x) => x.slug === field.slug);
        assert.ok(f, `${file}: field ${col.slug}.${field.slug} missing from seed.json`);
        assert.equal(f.type, field.type, `${file}: ${col.slug}.${field.slug} type`);
      }
    }
    for (const [collection, entries] of Object.entries(m.content ?? {}))
      for (const entry of entries)
        assert.ok(
          (seed.content?.[collection] ?? []).some((e) => e.id === entry.id),
          `${file}: entry ${collection}/${entry.id} missing from seed.json`
        );
  }
});
