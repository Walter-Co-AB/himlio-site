// Content-model migrations: seed/seed.json only runs when a site is set up, so changes to the
// content model reach existing sites through seed/migrations/NNNN_name.json instead. Each file
// is a partial seed (collections, fields, content only). They are applied in name order with
// EmDash's applySeed in "skip" mode, so anything that already exists is left alone and a file
// can safely run on a site that has it already (e.g. a new site, whose seed.json includes it).
//
// Applied names are kept in the D1 table himlio_model_migrations (migrations/0002_...). The
// check runs once per Worker isolate, from src/middleware.ts. A failure is logged and retried
// at most once a minute; it never breaks the page.
//
// Rules for migration files: append-only, never edit one that has been released, and add the
// same change to seed/seed.json so new sites get it at setup (tests check both).
import { env } from 'cloudflare:workers';
import { applySeed, validateSeed } from 'emdash';

type Seed = Parameters<typeof applySeed>[1];
type Database = Parameters<typeof applySeed>[0];

const files = import.meta.glob<Seed>('../../seed/migrations/*.json', {
  eager: true,
  import: 'default',
});

export const MODEL_MIGRATIONS = Object.entries(files)
  .map(([path, seed]) => ({
    name: path
      .split('/')
      .pop()!
      .replace(/\.json$/, ''),
    seed,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const RETRY_MS = 60_000;
let pending: Promise<void> | null = null;
let failedAt = 0;

const d1 = () => (env as unknown as { DB: D1Database }).DB;

async function applyPending(db: Database): Promise<void> {
  const { results } = await d1()
    .prepare('SELECT name FROM himlio_model_migrations')
    .all<{ name: string }>();
  const applied = new Set(results.map((row) => row.name));

  for (const { name, seed } of MODEL_MIGRATIONS) {
    if (applied.has(name)) continue;
    const validation = validateSeed(seed);
    if (!validation.valid) throw new Error(`${name}: ${validation.errors.join(', ')}`);
    await applySeed(db, seed, { includeContent: true, onConflict: 'skip' });
    await d1()
      .prepare('INSERT OR IGNORE INTO himlio_model_migrations (name, applied_at) VALUES (?, ?)')
      .bind(name, Date.now())
      .run();
    console.log(`[himlio] applied content-model migration ${name}`);
  }
}

/** Applies pending model migrations once per isolate. Resolves even if they fail. */
export function ensureModelMigrations(db: Database): Promise<void> {
  if (!pending && Date.now() - failedAt >= RETRY_MS) {
    pending = applyPending(db).catch((error: unknown) => {
      console.error('[himlio] content-model migrations failed:', error);
      failedAt = Date.now();
      pending = null;
    });
  }
  return pending ?? Promise.resolve();
}
