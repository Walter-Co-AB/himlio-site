import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('../model-migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort();

test('platform model migrations are named NNNN_name.json and numbered without gaps', () => {
  assert.ok(files.length > 0);
  files.forEach((file, i) => {
    assert.match(file, /^\d{4}_[a-z0-9_]+\.json$/);
    assert.equal(Number(file.slice(0, 4)), i + 1, file);
  });
});

test('model migrations only touch the content model and content, never settings or menus', () => {
  for (const file of files) {
    const m = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    for (const key of Object.keys(m))
      assert.ok(
        ['$schema', 'version', 'meta', 'collections', 'content'].includes(key),
        `${file}: ${key}`
      );
    assert.equal(m.version, '1', file);
  }
});

test('platform D1 migrations stay in 0001–0099', () => {
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)))
    assert.match(file, /^00\d\d_[a-z0-9_]+\.sql$/, file);
});
