// Shared by the integration and the CLI (Node only): reads himlio.json, works out the dev port,
// and writes `.himlio/`, the generated Worker config and the merged D1 migrations.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The platform facts in himlio.json (written by Terraform). */
export interface HimlioFacts {
  slug: string;
  name: string;
  locale: string;
  url: string | null;
  email?: { from: string };
}

export interface HimlioOptions {
  /**
   * The site's own scheduled work: cron expression (5 fields, UTC) → module path, relative to
   * the project root, whose default export is `(controller, env, ctx) => void | Promise<void>`.
   * At most two; the platform uses one more.
   */
  crons?: Record<string, string>;
  /** Directory with the site's own content-model migrations (NNNN_name.json, partial seeds). */
  modelMigrations?: string;
  /**
   * The site's own Durable Objects (SQLite-backed). Export each class from `src/worker.ts`,
   * which must also re-export the platform Worker: `export { default } from '@himlio/site/worker'`.
   */
  durableObjects?: { binding: string; className: string }[];
  /** Plain-text variables for the Worker (not secrets). */
  vars?: Record<string, string>;
}

export const COMPATIBILITY_DATE = '2026-11-01';
export const PLATFORM_CRON = '* * * * *';
export const RESERVED_BINDINGS = new Set([
  'DB',
  'MEDIA',
  'EMAIL',
  'HIMLIO_SLUG',
  'ASSETS',
  'EMDASH_ROOMS',
]);
const BINDING = /^[A-Z][A-Z0-9_]{0,63}$/;
const CLASS_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const SITE_MIGRATION = /^(\d{4})_[a-z0-9_]{1,80}\.sql$/;
const MODEL_MIGRATION = /^\d{4}_[a-z0-9_]+\.json$/;
const CRON = /^[0-9*/,-]+( [0-9*/,-]+){4}$/;

/** The package's own directory (holds migrations/ and model-migrations/). */
export const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function readHimlio(root: string): HimlioFacts {
  const raw = JSON.parse(readFileSync(join(root, 'himlio.json'), 'utf8')) as Partial<HimlioFacts>;
  return {
    slug: raw.slug ?? '',
    name: raw.name ?? '',
    locale: raw.locale || 'sv',
    url: raw.url ?? null,
    ...(raw.email?.from ? { email: { from: raw.email.from } } : {}),
  };
}

/**
 * Every repo has its own dev port, so people and agents working on several sites at once never
 * talk to another site's server: 4321 for the starter, 4400–4899 for a customer site.
 */
export function devPort(slug: string): number {
  if (!slug || slug === 'template' || slug === 'starter') return 4321;
  let hash = 0x811c9dc5; // FNV-1a
  for (const ch of slug) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return 4400 + (hash % 500);
}

const fail = (message: string): never => {
  throw new Error(`[himlio] ${message}`);
};

export function validateOptions(options: HimlioOptions): void {
  const crons = Object.keys(options.crons ?? {});
  if (crons.length > 2) fail('crons: at most 2 (the platform uses the third)');
  for (const expr of crons) {
    if (!CRON.test(expr))
      fail(`crons: "${expr}" must be 5 fields of numbers, *, a-b, */n, a,b (UTC)`);
    if (expr === PLATFORM_CRON) fail(`crons: "${PLATFORM_CRON}" is used by the platform`);
  }
  const names = new Set(RESERVED_BINDINGS);
  const claim = (name: string, where: string) => {
    if (!BINDING.test(name)) fail(`${where}: "${name}" must be UPPER_SNAKE_CASE`);
    if (names.has(name)) fail(`${where}: "${name}" is reserved or already used`);
    names.add(name);
  };
  for (const d of options.durableObjects ?? []) {
    claim(d.binding, 'durableObjects');
    if (!CLASS_NAME.test(d.className)) fail(`durableObjects: "${d.className}" is not a class name`);
  }
  for (const [key, value] of Object.entries(options.vars ?? {})) {
    claim(key, 'vars');
    if (typeof value !== 'string') fail(`vars.${key} must be a string`);
  }
}

/** Platform migrations (0001–0099, in the package) plus the site's own (0100+). */
function mergeMigrations(root: string, out: string): void {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const platform = join(packageDir, 'migrations');
  for (const name of readdirSync(platform)) copyFileSync(join(platform, name), join(out, name));
  const site = join(root, 'migrations');
  if (!existsSync(site)) return;
  for (const name of readdirSync(site)) {
    if (name.startsWith('.')) continue;
    const match = SITE_MIGRATION.exec(name);
    if (!match) fail(`migrations/${name}: name must look like 0100_create_bookings.sql`);
    if (Number(match![1]) < 100)
      fail(`migrations/${name}: 0001–0099 belong to the platform; start at 0100`);
    copyFileSync(join(site, name), join(out, name));
  }
}

/** Platform model migrations (unprefixed names) and the site's own ("site/NNNN_name"). */
export function readModelMigrations(root: string, options: HimlioOptions) {
  const list: { name: string; seed: unknown }[] = [];
  const read = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.json')) continue;
      if (!MODEL_MIGRATION.test(file))
        fail(`${dir}/${file}: name must look like 0001_add_fields.json`);
      const seed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      for (const key of Object.keys(seed))
        if (!['$schema', 'version', 'meta', 'collections', 'content'].includes(key))
          fail(`${dir}/${file}: only collections and content are allowed (found "${key}")`);
      list.push({ name: prefix + file.replace(/\.json$/, ''), seed });
    }
  };
  read(join(packageDir, 'model-migrations'), '');
  if (options.modelMigrations) read(resolve(root, options.modelMigrations), 'site/');
  return list;
}

/** Writes `.himlio/wrangler.json` and `.himlio/migrations/`. Returns the config path. */
export function writeGenerated(root: string, options: HimlioOptions): string {
  validateOptions(options);
  const facts = readHimlio(root);
  const dir = join(root, '.himlio');
  mkdirSync(dir, { recursive: true });
  mergeMigrations(root, join(dir, 'migrations'));

  const siteWorker = join(root, 'src', 'worker.ts');
  const main = existsSync(siteWorker)
    ? siteWorker
    : join(packageDir, 'dist', 'runtime', 'worker.js');
  if ((options.durableObjects?.length ?? 0) > 0 && !existsSync(siteWorker))
    fail(
      'durableObjects need src/worker.ts that exports the classes and re-exports @himlio/site/worker'
    );

  const siteDOs = options.durableObjects ?? [];
  // DB, MEDIA, EMAIL and HIMLIO_SLUG are for local development only: in production the
  // platform adds them, and the build artifact leaves them out.
  const config = {
    name: 'himlio-site',
    main,
    compatibility_date: COMPATIBILITY_DATE,
    compatibility_flags: ['nodejs_compat'],
    d1_databases: [{ binding: 'DB', database_name: 'himlio-local', migrations_dir: 'migrations' }],
    r2_buckets: [{ binding: 'MEDIA', bucket_name: 'himlio-local-media' }],
    send_email: [{ name: 'EMAIL' }],
    vars: { HIMLIO_SLUG: facts.slug, ...(options.vars ?? {}) },
    durable_objects: {
      bindings: [
        // Co-editing rooms in the admin. EmDash looks the binding up by this name.
        { name: 'EMDASH_ROOMS', class_name: 'EmDashRoom' },
        ...siteDOs.map((d) => ({ name: d.binding, class_name: d.className })),
      ],
    },
    migrations: [
      { tag: 'v1', new_sqlite_classes: ['EmDashRoom'] },
      ...siteDOs.map((d) => ({ tag: `site-${d.className}`, new_sqlite_classes: [d.className] })),
    ],
    triggers: { crons: [PLATFORM_CRON, ...Object.keys(options.crons ?? {})] },
  };
  const path = join(dir, 'wrangler.json');
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  return path;
}
