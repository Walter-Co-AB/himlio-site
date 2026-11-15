import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devPort } from '../astro.config.mjs';

test('dev ports: 4321 for the template, a stable 4400–4899 port per customer slug', () => {
  assert.equal(devPort('template'), 4321);
  assert.equal(devPort(''), 4321);
  // Pinned: changing the hash would move every customer's dev server.
  assert.equal(devPort('walterco'), 4644);
  assert.equal(devPort('acme'), 4515);
  for (const slug of ['a', 'walterco', 'acme-ab', 'x'.repeat(32)]) {
    const port = devPort(slug);
    assert.ok(port >= 4400 && port < 4900, `${slug}: ${port}`);
    assert.equal(devPort(slug), port);
  }
});
