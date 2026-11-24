// Content-model migrations: the platform's (model-migrations/ in this package) and the site's own
// (himlio({ modelMigrations })), NNNN_name.json, partial EmDash seeds (collections, fields and
// content only). They reach every site, new or existing, without manual work. They are applied in name order with
// EmDash's applySeed in "skip" mode, so anything that already exists is left alone and a file
// can safely run on a site that has it already (e.g. a new site whose seed already includes it).
// Fields a migration adds to a collection that already exists are created too; nothing that
// exists is changed. Block types (`blockTypes`) are allowed as well. `relabel` renames
// collections and fields, but only labels that still have their old value (see applyRelabel).
// `allowBlockTypes` adds block types to a blocks field's allowed list (applyAllowBlockTypes).
// `addBlockFields` adds optional fields to an existing block type (applyAddBlockFields), e.g. a
// `layout` select for a design variant. `renameEntries` renames an entry's slug, and its title
// while it still has the old one (applyRenameEntries). `privacyPage` (platform only) adds the
// privacy policy page as a draft (applyPrivacyPage).
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
import {
  BlockTypeRegistry,
  ContentRepository,
  SchemaRegistry,
  applySeed,
  validateSeed,
} from 'emdash';
import { Kysely } from 'kysely';
import { facts, modelMigrations } from 'virtual:himlio/config';
import { privacyPage } from '../site/privacy.js';

type Seed = Parameters<typeof applySeed>[1];
type LabelChange = [from: string, to: string];
interface Relabel {
  collection: string;
  field?: string;
  label?: LabelChange;
  labelSingular?: LabelChange;
  description?: LabelChange;
}
interface AllowBlockTypes {
  collection: string;
  field: string;
  add: string[];
}

interface AddBlockFields {
  blockType: string;
  fields: BlockField[];
}
type BlockField = Parameters<BlockTypeRegistry['updateBlockType']>[1]['fields'] extends
  (infer F)[] | undefined
  ? F
  : never;

interface RenameEntry {
  collection: string;
  slug: LabelChange;
  title?: LabelChange;
}

type Migration = Seed & {
  relabel?: Relabel[];
  allowBlockTypes?: AllowBlockTypes[];
  addBlockFields?: AddBlockFields[];
  renameEntries?: RenameEntry[];
  privacyPage?: boolean;
};
type Database = Parameters<typeof applySeed>[0];

/** Platform migrations (in the package) first, then the site's own ("site/..."). */
export const MODEL_MIGRATIONS = modelMigrations as { name: string; seed: Migration }[];

const RETRY_MS = 60_000;
/** A run that hasn't finished after this long is treated as lost, so a later request retries. */
const STALE_MS = 5 * 60_000;

let state: 'pending' | 'running' | 'done' = 'pending';
let since = 0;

const d1 = () => (env as unknown as { DB: D1Database }).DB;

/**
 * applySeed in "skip" mode leaves an existing collection alone, including fields the migration
 * adds to it. Create those fields here. Existing fields and collection settings are never changed
 * (EmDash can't change most field types without a manual content migration anyway).
 */
async function addMissingFields(db: Database, seed: Seed, name: string): Promise<void> {
  const registry = new SchemaRegistry(db);
  for (const collection of seed.collections ?? []) {
    if (!(await registry.getCollection(collection.slug))) continue;
    for (const field of collection.fields) {
      if (await registry.getField(collection.slug, field.slug)) continue;
      if (field.type === 'reference')
        throw new Error(
          `${name}: add reference field ${collection.slug}.${field.slug} in the admin`
        );
      // SeedField's validation/options are loosely typed; EmDash validates them in createField.
      await registry.createField(
        collection.slug,
        field as Parameters<SchemaRegistry['createField']>[1]
      );
      console.log(`[himlio] ${name}: added field ${collection.slug}.${field.slug}`);
    }
  }
}

/**
 * Renames collections and fields (e.g. to English admin labels). A label changes only while it
 * still has the `from` value, so one the customer changed in the admin is kept, and a missing
 * collection or field is skipped.
 */
async function applyRelabel(db: Database, relabel: Relabel[], name: string): Promise<void> {
  const registry = new SchemaRegistry(db);
  for (const { collection, field, ...changes } of relabel) {
    const current = field
      ? await registry.getField(collection, field)
      : await registry.getCollection(collection);
    if (!current) continue;
    const update: Record<string, string> = {};
    for (const [key, [from, to]] of Object.entries(changes) as [string, LabelChange][])
      if ((current as unknown as Record<string, unknown>)[key] === from) update[key] = to;
    if (Object.keys(update).length === 0) continue;
    if (field) await registry.updateField(collection, field, update);
    else await registry.updateCollection(collection, update);
    console.log(`[himlio] ${name}: relabelled ${field ? `${collection}.${field}` : collection}`);
  }
}

/**
 * Adds block types to a blocks field's allowed list (a new section type on `pages.content`).
 * Only adds: types the customer removed stay removed unless a migration names them again, and
 * a field without a list (every type allowed) or a missing field is left alone.
 */
async function applyAllowBlockTypes(
  db: Database,
  entries: AllowBlockTypes[],
  name: string
): Promise<void> {
  const registry = new SchemaRegistry(db);
  for (const { collection, field, add } of entries) {
    const current = await registry.getField(collection, field);
    if (!current || current.type !== 'blocks') continue;
    const allowed = current.validation?.allowedTypes;
    if (!Array.isArray(allowed)) continue;
    const missing = add.filter((t) => !allowed.includes(t));
    if (missing.length === 0) continue;
    await registry.updateField(collection, field, {
      validation: { ...current.validation, allowedTypes: [...allowed, ...missing] },
    });
    console.log(`[himlio] ${name}: allowed ${missing.join(', ')} in ${collection}.${field}`);
  }
}

/**
 * Adds optional fields to block types that exist (seeded block types are otherwise skipped).
 * Fields the block type has already are left alone, as are missing block types. An optional
 * field is a compatible change, so EmDash updates the active version in place: content made
 * before simply doesn't have the field.
 */
async function applyAddBlockFields(
  db: Database,
  entries: AddBlockFields[],
  name: string
): Promise<void> {
  const registry = new BlockTypeRegistry(db);
  for (const { blockType, fields } of entries) {
    const current = await registry.getBlockType(blockType);
    if (!current) continue;
    const active = current.versions.find((v) => v.version === current.currentVersion);
    if (!active) continue;
    const have = new Set(active.fields.map((f) => f.slug));
    const missing = fields.filter((f) => !have.has(f.slug));
    if (missing.length === 0) continue;
    await registry.updateBlockType(blockType, {
      expectedFingerprint: active.fingerprint,
      fields: [...active.fields, ...missing],
    });
    console.log(
      `[himlio] ${name}: added ${missing.map((f) => f.slug).join(', ')} to block type ${blockType}`
    );
  }
}

/**
 * Renames entries (e.g. a Swedish internal slug to English). Only an entry that still has the old
 * slug, and only when the new slug is free; the title changes only while it is still the old
 * one, so a title the customer changed is kept. Missing collections and entries are skipped.
 */
async function applyRenameEntries(
  db: Database,
  entries: RenameEntry[],
  name: string
): Promise<void> {
  const schema = new SchemaRegistry(db);
  const content = new ContentRepository(db);
  for (const { collection, slug, title } of entries) {
    if (!(await schema.getCollection(collection))) continue;
    const item = await content.findBySlug(collection, slug[0]);
    if (!item || (await content.findBySlug(collection, slug[1]))) continue;
    const data = title && item.data.title === title[0] ? { title: title[1] } : undefined;
    await content.update(collection, item.id, { slug: slug[1], ...(data ? { data } : {}) });
    console.log(`[himlio] ${name}: renamed ${collection}/${slug[0]} to ${slug[1]}`);
  }
}

/**
 * Adds the privacy policy page, a draft for the company to read and publish: a Text section with
 * the Privacy policy block, titled and slugged in the site's language. Skipped when a page
 * already has the block or the slug is taken (the site has its own policy), and on a site whose
 * pages can't hold a Text section.
 */
async function applyPrivacyPage(db: Database, name: string): Promise<void> {
  const schema = new SchemaRegistry(db);
  const content = await schema.getField('pages', 'content');
  const allowed = content?.validation?.allowedTypes;
  if (!content || content.type !== 'blocks') return;
  if (Array.isArray(allowed) && !allowed.includes('marketing_text')) return;
  const text = await new BlockTypeRegistry(db).getBlockType('marketing_text');
  if (!text) return;
  const existing = await d1()
    .prepare(
      'SELECT 1 FROM ec_pages WHERE deleted_at IS NULL AND content LIKE \'%"himlio-privacy"%\' LIMIT 1'
    )
    .first();
  if (existing) return;
  const { title, slug } = privacyPage(facts.locale);
  const repo = new ContentRepository(db);
  if (await repo.findBySlug('pages', slug)) return;
  await repo.create({
    type: 'pages',
    slug,
    status: 'draft',
    data: {
      title,
      content: [
        {
          _type: 'marketing_text',
          _version: text.currentVersion,
          _key: 'privacy',
          body: [{ _type: 'himlio-privacy', _key: 'policy' }],
        },
      ],
    },
  });
  console.log(`[himlio] ${name}: added the draft page /${slug}`);
}

async function applyPending(): Promise<void> {
  const { results } = await d1()
    .prepare('SELECT name FROM himlio_model_migrations')
    .all<{ name: string }>();
  const applied = new Set(results.map((row) => row.name));
  const todo = MODEL_MIGRATIONS.filter(({ name }) => !applied.has(name));
  if (todo.length === 0) return;

  const db = new Kysely<unknown>({ dialect: createDialect({ binding: 'DB' }) }) as Database;
  try {
    for (const { name, seed: migration } of todo) {
      const { relabel, allowBlockTypes, addBlockFields, renameEntries, privacyPage, ...seed } =
        migration;
      const validation = validateSeed(seed);
      if (!validation.valid) throw new Error(`${name}: ${validation.errors.join(', ')}`);
      const started = Date.now();
      await applySeed(db, seed, { includeContent: true, onConflict: 'skip' });
      await addMissingFields(db, seed, name);
      if (relabel) await applyRelabel(db, relabel, name);
      if (allowBlockTypes) await applyAllowBlockTypes(db, allowBlockTypes, name);
      if (addBlockFields) await applyAddBlockFields(db, addBlockFields, name);
      if (renameEntries) await applyRenameEntries(db, renameEntries, name);
      if (privacyPage) await applyPrivacyPage(db, name);
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
