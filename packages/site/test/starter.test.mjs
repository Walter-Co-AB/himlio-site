import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

// New sites are created by copying starter/ at the tag of the latest @himlio/site, once
// (himlio-infrastructure scripts/scaffold). So at every version the starter must point at that
// exact version, in package.json and in the CI workflow, and be complete on its own.
const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const version = JSON.parse(read('packages/site/package.json')).version;

test('the starter depends on this exact @himlio/site version', () => {
  assert.equal(JSON.parse(read('starter/package.json')).dependencies['@himlio/site'], version);
});

test("the starter's CI calls the build workflow at this version's tag", () => {
  const uses = read('starter/.github/workflows/ci.yml').match(/build\.yml@(\S+)/)?.[1];
  assert.equal(uses, `v${version}`);
});

test('the starter has what a site needs on its own', () => {
  for (const path of [
    '.nvmrc',
    '.gitignore',
    'astro.config.mjs',
    'himlio.json',
    'src/live.config.ts',
    'AGENTS.md',
  ])
    assert.ok(existsSync(new URL(`../../../starter/${path}`, import.meta.url)), path);
});
