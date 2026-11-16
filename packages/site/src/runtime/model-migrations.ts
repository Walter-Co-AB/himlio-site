// Content-model migrations: the platform's (model-migrations/ in this package) and the site's own
// (himlio({ modelMigrations })), NNNN_name.json, partial EmDash seeds (collections, fields and
// content only). They reach every site, new or existing, without manual work. They are applied in name order with
// EmDash's applySeed in "skip" mode, so anything that already exists is left alone and a file
// can safely run on a site that has it already (e.g. a new site whose seed already includes it).
//
// Applied names are kept in the D1 table himlio_model_migrations (migrations/0002_...).
//
// They never hold up a page. himlioMiddleware starts them after the response, in that
// request's own waitUntil, at most once per Worker isolate at a time, and nothing waits on
// them. They use their own D1 connection (the raw binding, like EmDash's own singleton), not
// EmDash's per-request connection, which is closed when the request ends; and no request
// awaits work started by another request, which can hang a Worker. A failure is logged and
// retried by a later request, at most once a minute.
//
// Rules for migration files: append-only, never edit one that has been released.
import { createDialect } from '@emdash-cms/cloudflare/db/d1';
import { env } from 'cloudflare:workers';
import { applySeed, validateSeed } from 'emdash';
import { Kysely } from 'kysely';
import { modelMigrations } from 'virtual:himlio/config';

type Seed = Parameters<typeof applySeed>[1];
type Database = Parameters<typeof applySeed>[0];

/** Platform migrations (in the package) first, then the site's own ("site/..."). */
export const MODEL_MIGRATIONS = modelMigrations as { name: string; seed: Seed }[];

const RETRY_MS = 60_000;
/** A run that hasn't finished after this long is treated as lost, so a later request retries. */
const STALE_MS = 5 * 60_000;

let state: 'pending' | 'running' | 'done' = 'pending';
let since = 0;

const d1 = () => (env as unknown as { DB: D1Database }).DB;

async function applyPending(): Promise<void> {
  const { results } = await d1()
    .prepare('SELECT name FROM himlio_model_migrations')
    .all<{ name: string }>();
  const applied = new Set(results.map((row) => row.name));
  const todo = MODEL_MIGRATIONS.filter(({ name }) => !applied.has(name));
  if (todo.length === 0) return;

  const db = new Kysely<unknown>({ dialect: createDialect({ binding: 'DB' }) }) as Database;
  try {
    for (const { name, seed } of todo) {
      const validation = validateSeed(seed);
      if (!validation.valid) throw new Error(`${name}: ${validation.errors.join(', ')}`);
      const started = Date.now();
      await applySeed(db, seed, { includeContent: true, onConflict: 'skip' });
      await d1()
        .prepare('INSERT OR IGNORE INTO himlio_model_migrations (name, applied_at) VALUES (?, ?)')
        .bind(name, Date.now())
        .run();
      console.log(`[himlio] applied content-model migration ${name} in ${Date.now() - started} ms`);
    }
  } finally {
    await db.destroy();
  }
}

/**
 * Starts pending model migrations in the background, unless they are done, already running
 * in this isolate, or failed less than a minute ago. Returns at once.
 */
export function startModelMigrations(waitUntil: (promise: Promise<unknown>) => void): void {
  const now = Date.now();
  if (state === 'done') return;
  if (state === 'running' && now - since < STALE_MS) return;
  if (state === 'pending' && since && now - since < RETRY_MS) return;

  state = 'running';
  since = now;
  waitUntil(
    applyPending().then(
      () => {
        state = 'done';
      },
      (error: unknown) => {
        console.error('[himlio] content-model migrations failed:', error);
        state = 'pending';
        since = Date.now();
      }
    )
  );
}
