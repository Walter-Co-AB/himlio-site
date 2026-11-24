import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
    'UPSTREAM.md',
    'seed/seed.json',
  ])
    assert.ok(existsSync(new URL(`../../../starter/${path}`, import.meta.url)), path);
});

test("the starter's code imports EmDash through @himlio/site, never directly", () => {
  const dir = new URL('../../../starter/src/', import.meta.url);
  const direct = readdirSync(dir, { recursive: true })
    .filter((f) => /\.(astro|ts|tsx|js|mjs)$/.test(f))
    .filter((f) => /from ['"]emdash(\/[^'"]*)?['"]/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(direct, []);
});

test("the starter's model migrations match its seed: every migrated block type, allowed in pages", () => {
  const seed = JSON.parse(read('starter/seed/seed.json'));
  const dir = new URL('../../../starter/src/model-migrations/', import.meta.url);
  const allowed = seed.collections
    .find((c) => c.slug === 'pages')
    .fields.find((f) => f.slug === 'content').validation.allowedTypes;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const m = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    for (const block of m.blockTypes ?? []) {
      assert.deepEqual(
        block,
        seed.blockTypes.find((b) => b.slug === block.slug),
        `${file}: ${block.slug} differs from seed.json`
      );
      assert.ok(allowed.includes(block.slug), `${block.slug} not allowed in pages.content`);
      assert.ok(
        m.allowBlockTypes?.some((a) => a.add.includes(block.slug)),
        `${file}: ${block.slug} needs allowBlockTypes for existing sites`
      );
    }
  }
});

test('the changelog has an entry for this version, and the starter AGENTS.md imports the rules', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(changelog, new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')}$`, 'm'));
  assert.ok(pkg.files.includes('CHANGELOG.md') && pkg.files.includes('docs'));
  const agents = readFileSync(new URL('../../../starter/AGENTS.md', import.meta.url), 'utf8');
  assert.match(agents, /^@node_modules\/@himlio\/site\/docs\/site-agents\.md$/m);
});

test('changelog format: ## X.Y.Z per version, newest first, each with a ### Sites subsection', () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const sections = changelog.split(/^## /m).slice(1);
  const versions = sections.filter((s) => /^\d+\.\d+\.\d+\n/.test(s)).map((s) => s.split('\n')[0]);
  assert.ok(versions.length > 0);
  for (const section of sections.filter((s) => /^\d+\.\d+\.\d+\n/.test(s)))
    assert.match(section, /^### Sites$/m, `## ${section.split('\n')[0]} has no ### Sites`);
  const key = (v) => v.split('.').map(Number);
  for (let i = 1; i < versions.length; i++) {
    const [a, b] = [key(versions[i - 1]), key(versions[i])];
    assert.ok(
      a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2]))),
      `${versions[i - 1]} before ${versions[i]}`
    );
  }
});
