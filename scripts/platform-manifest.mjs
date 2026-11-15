// The list of platform-owned files and their sha256 hashes for this template version, in
// himlio-platform.json. Platform-owned.
//
//   node scripts/platform-manifest.mjs           write himlio-platform.json (in himlio-template)
//   node scripts/platform-manifest.mjs --check   fail if this repo differs from it (npm run verify)
//
// Platform-owned files are overwritten whole when a site repo syncs with a new template
// version, so a site must not edit them. Where a site hooks in, it does so in its own files
// (astro.config.mjs, src/middleware.ts); `hooks` lists what those files must still contain.
// For package.json, `package` lists the keys whose values must match.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MANIFEST = 'himlio-platform.json';

/** Platform-owned files: exact paths, and directories whose matching files are all owned. */
const FILES = [
  '.github/workflows/ci.yml',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/himlio-build.md',
  'emdash-env.d.ts',
  'himlio.config.mjs',
  'scripts/himlio-build.mjs',
  'scripts/platform-manifest.mjs',
  'seed/seed.json',
  'src/lib/contact.ts',
  'src/lib/himlio-middleware.ts',
  'src/lib/himlio.ts',
  'src/lib/model-migrations.ts',
  'src/lib/oauth-scopes.ts',
  'src/lib/session-d1.ts',
  'src/lib/site-description.ts',
  'src/live.config.ts',
  'src/worker.ts',
  'wrangler.jsonc',
];
const DIRS = [
  { dir: 'migrations', match: /^00\d\d_[a-z0-9_]+\.sql$/ }, // 0001–0099; sites use 0100+
  { dir: 'seed/migrations', match: /\.json$/ },
  { dir: 'tests/platform', match: /\.test\.mjs$/ },
];

/** Strings that site-owned files must still contain, so the platform's call sites stay in. */
const HOOKS = {
  'astro.config.mjs': ['defineHimlioConfig('],
  'src/middleware.ts': ['himlioMiddleware'],
  '.prettierignore': ['himlio.json'],
  '.gitignore': ['.dev.vars', 'himlio-build/'],
};

/** package.json keys whose values must match the template's. */
const PACKAGE = {
  scripts: [
    'dev',
    'build',
    'check',
    'test',
    'format:check',
    'himlio-build',
    'platform:check',
    'verify',
  ],
  dependencies: [
    '@astrojs/cloudflare',
    '@astrojs/react',
    '@emdash-cms/cloudflare',
    'astro',
    'emdash',
    'react',
    'react-dom',
  ],
  devDependencies: [
    '@astrojs/check',
    '@cloudflare/workers-types',
    'prettier',
    'typescript',
    'wrangler',
  ],
  top: ['engines', 'allowScripts', 'emdash'],
};

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function ownedPaths() {
  const paths = [...FILES];
  for (const { dir, match } of DIRS)
    if (existsSync(dir))
      for (const name of readdirSync(dir)) if (match.test(name)) paths.push(join(dir, name));
  return paths.sort();
}

function packageSubset(pkg) {
  const out = {};
  for (const section of ['scripts', 'dependencies', 'devDependencies'])
    out[section] = Object.fromEntries(PACKAGE[section].map((k) => [k, pkg[section]?.[k] ?? null]));
  for (const key of PACKAGE.top) out[key] = pkg[key] ?? null;
  return out;
}

function write() {
  const files = Object.fromEntries(ownedPaths().map((p) => [p, sha256(p)]));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const manifest = { version: 1, files, hooks: HOOKS, package: packageSubset(pkg) };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${MANIFEST}: ${Object.keys(files).length} platform-owned files`);
}

function check() {
  if (!existsSync(MANIFEST)) return [`${MANIFEST} is missing`];
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const errors = [];

  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!existsSync(path)) errors.push(`${path}: missing`);
    else if (sha256(path) !== hash) errors.push(`${path}: differs from the template`);
  }
  // Files in platform-owned directories that the template doesn't have.
  for (const path of ownedPaths())
    if (!(path in manifest.files)) errors.push(`${path}: not in ${MANIFEST}`);

  for (const [path, needles] of Object.entries(manifest.hooks ?? {})) {
    const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
    for (const needle of needles)
      if (!text.includes(needle)) errors.push(`${path}: must contain "${needle}"`);
  }

  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const want = manifest.package ?? {};
  for (const section of ['scripts', 'dependencies', 'devDependencies'])
    for (const [key, value] of Object.entries(want[section] ?? {}))
      if ((pkg[section]?.[key] ?? null) !== value)
        errors.push(`package.json ${section}.${key}: must be ${JSON.stringify(value)}`);
  for (const key of PACKAGE.top)
    if (key in want && JSON.stringify(pkg[key] ?? null) !== JSON.stringify(want[key]))
      errors.push(`package.json ${key}: must be ${JSON.stringify(want[key])}`);
  return errors;
}

if (process.argv.includes('--check')) {
  const errors = check();
  if (errors.length) {
    console.error('Platform-owned files differ from himlio-platform.json:');
    for (const e of errors) console.error(`  ${e}`);
    console.error(
      'Platform files are changed in himlio-template and synced from there (AGENTS.md). In ' +
        'himlio-template itself, run `npm run platform:manifest` after changing one.'
    );
    process.exit(1);
  }
  console.log('platform files match himlio-platform.json');
} else {
  write();
}
