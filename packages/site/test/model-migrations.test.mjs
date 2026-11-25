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
        [
          '$schema',
          'version',
          'meta',
          'blockTypes',
          'collections',
          'content',
          'relabel',
          'allowBlockTypes',
          'addBlockFields',
          'renameEntries',
          'privacyPage',
        ].includes(key),
        `${file}: ${key}`
      );
    assert.equal(m.version, '1', file);
  }
});

test('platform D1 migrations stay in 0001–0099', () => {
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)))
    assert.match(file, /^00\d\d_[a-z0-9_]+\.sql$/, file);
});

test('a collection urlPattern per language is resolved for the site locale, falling back to en', async () => {
  const { localizeSeed } = await import('../dist/model-locale.js');
  const seed = {
    collections: [
      { slug: 'posts', urlPattern: { en: '/news/{slug}', sv: '/nyheter/{slug}' } },
      { slug: 'pages', urlPattern: '/{slug}' },
    ],
  };
  const pattern = (locale) => localizeSeed(seed, locale).collections.map((c) => c.urlPattern);
  assert.deepEqual(pattern('sv-SE'), ['/nyheter/{slug}', '/{slug}']);
  assert.deepEqual(pattern('de'), ['/news/{slug}', '/{slug}']);
  assert.equal(seed.collections[0].urlPattern.sv, '/nyheter/{slug}'); // not changed in place
  assert.throws(
    () => localizeSeed({ collections: [{ slug: 'x', urlPattern: { sv: '/x' } }] }, 'sv'),
    /needs "en"/
  );
});

test('the News collection URLs match the News paths the runtime and the feed use', async () => {
  const { NEWS_PATHS, newsPathFor } = await import('../dist/news.js');
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const platform = read('../model-migrations/0005_news.json').collections[0];
  const starter = read('../../../starter/src/model-migrations/0005_posts.json').collections[0];
  for (const posts of [platform, starter]) {
    assert.equal(posts.slug, 'posts');
    assert.deepEqual(
      posts.urlPattern,
      Object.fromEntries(Object.entries(NEWS_PATHS).map(([l, p]) => [l, `/${p}/{slug}`]))
    );
  }
  assert.equal(newsPathFor('sv-SE'), 'nyheter');
  assert.equal(newsPathFor('fi'), 'news');
});
