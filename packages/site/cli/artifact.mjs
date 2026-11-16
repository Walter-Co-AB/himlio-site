// `himlio-site artifact`: writes the himlio-build artifact (docs/build-artifact.md) after
// `astro build`. Part of @himlio/site.
//
//   himlio-build/worker/            wrangler deploy --dry-run --outdir himlio-build/worker
//   himlio-build/himlio-build.json  from the Worker config the build generated
//   himlio-build/assets/            copy of dist/client
//   himlio-build/migrations/        the platform's D1 migrations and the site's own (.himlio/migrations)
//
// Bindings the platform adds (DB, MEDIA, EMAIL, HIMLIO_SLUG) are left out. Any other binding the
// platform can't provide fails the build, so it doesn't break at release time instead.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const OUT = 'himlio-build';
const BUILT_CONFIG = 'dist/server/wrangler.json';
const RESERVED = new Set(['DB', 'MEDIA', 'EMAIL', 'HIMLIO_SLUG']);
const BINDING = /^[A-Z][A-Z0-9_]{0,63}$/;
const MIGRATION = /^\d{4}_[a-z0-9_]{1,80}\.sql$/;

const fail = (msg) => {
  console.error(`himlio-build: ${msg}`);
  process.exit(1);
};
const isEmpty = (v) =>
  v === undefined ||
  v === null ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isEmpty));

if (!existsSync(BUILT_CONFIG)) fail(`${BUILT_CONFIG} is missing; run \`astro build\` first`);
rmSync(OUT, { recursive: true, force: true });
const req = createRequire(import.meta.url);
const wranglerPkg = req.resolve('wrangler/package.json');
const wrangler = join(dirname(wranglerPkg), req(wranglerPkg).bin.wrangler);
execFileSync(process.execPath, [wrangler, 'deploy', '--dry-run', '--outdir', `${OUT}/worker`], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
const config = JSON.parse(readFileSync(BUILT_CONFIG, 'utf8'));

// Keys that only describe the local setup or the bundle, not the deployment.
const IGNORED = new Set([
  '$schema',
  'configPath',
  'userConfigPath',
  'topLevelName',
  'definedEnvironments',
  'legacy_env',
  'name',
  'main',
  'rules',
  'jsx_factory',
  'jsx_fragment',
  'no_bundle',
  'find_additional_modules',
  'base_dir',
  'preserve_file_names',
  'dev',
  'site',
  'python_modules',
  'unsafe',
  'observability',
  'logpush',
  'upload_source_maps',
  'workers_dev',
  'preview_urls',
  'keep_vars',
  'exports',
  'tsconfig',
  'build',
  'alias',
  'define',
]);
// Mapped below.
const MAPPED = new Set([
  'compatibility_date',
  'compatibility_flags',
  'assets',
  'durable_objects',
  'migrations',
  'triggers',
  'vars',
  'd1_databases',
  'r2_buckets',
  'send_email',
]);

for (const [key, value] of Object.entries(config)) {
  if (IGNORED.has(key) || MAPPED.has(key) || isEmpty(value)) continue;
  fail(`Worker config: "${key}" is not supported on Himlio (see docs/build-artifact.md)`);
}
for (const db of config.d1_databases ?? [])
  if (db.binding !== 'DB') fail(`only the D1 binding DB is supported (got ${db.binding})`);
for (const e of config.send_email ?? [])
  if (e.name !== 'EMAIL') fail(`only the send_email binding EMAIL is supported (got ${e.name})`);
for (const b of config.r2_buckets ?? [])
  if (b.binding !== 'MEDIA') fail(`only the R2 binding MEDIA is supported (got ${b.binding})`);

const claimed = new Set(RESERVED);
const claim = (name, where) => {
  if (!BINDING.test(name)) fail(`${where}: binding "${name}" must be UPPER_SNAKE_CASE`);
  if (claimed.has(name)) fail(`${where}: binding "${name}" is reserved or already used`);
  claimed.add(name);
};

const manifest = {
  version: 1,
  main: config.main.replace(/^\.\//, ''),
  compatibility_date: config.compatibility_date,
  compatibility_flags: config.compatibility_flags ?? [],
};

if (!existsSync(`${OUT}/worker/${manifest.main}`))
  fail(`${OUT}/worker/${manifest.main} is missing`);

if (config.assets) {
  const { binding, html_handling, not_found_handling, run_worker_first } = config.assets;
  if (binding) claim(binding, 'assets');
  manifest.assets = Object.fromEntries(
    Object.entries({ binding, html_handling, not_found_handling, run_worker_first }).filter(
      ([, v]) => v !== undefined
    )
  );
}

const dos = config.durable_objects?.bindings ?? [];
if (dos.length) {
  manifest.durable_objects = dos.map((d) => {
    if (d.script_name) fail(`durable_objects: ${d.name} must be defined in this Worker`);
    claim(d.name, 'durable_objects');
    return { binding: d.name, class_name: d.class_name };
  });
  manifest.durable_object_migrations = config.migrations ?? [];
}

const crons = config.triggers?.crons ?? [];
if (crons.length) manifest.crons = crons;

const vars = Object.fromEntries(
  Object.entries(config.vars ?? {}).filter(([k]) => !RESERVED.has(k))
);
for (const [k, v] of Object.entries(vars)) {
  claim(k, 'vars');
  if (typeof v !== 'string') fail(`vars.${k} must be a string`);
}
manifest.vars = vars;

if (existsSync('dist/client')) cpSync('dist/client', `${OUT}/assets`, { recursive: true });
else delete manifest.assets;

const MIGRATIONS = '.himlio/migrations';
if (existsSync(MIGRATIONS)) {
  const files = readdirSync(MIGRATIONS);
  for (const f of files)
    if (!MIGRATION.test(f)) fail(`migrations/${f}: name must look like 0001_create_posts.sql`);
  if (files.length) cpSync(MIGRATIONS, `${OUT}/migrations`, { recursive: true });
}

writeFileSync(`${OUT}/himlio-build.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`himlio-build: wrote ${OUT}/himlio-build.json`);
console.log(JSON.stringify(manifest, null, 2));
