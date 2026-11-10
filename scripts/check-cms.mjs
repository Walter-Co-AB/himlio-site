// Checks that the CMS fields in cms/config.yml match the Zod schemas in src/schemas.ts:
// the same field names, and a field is optional in Zod exactly when the CMS marks it
// `required: false` (fields with a Zod default may be either). Also validates the
// current content files against the schemas.
//
// Run: npm run check:cms
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'astro/zod';
import { pageSchema, settingsSchema } from '../src/schemas.ts';

const root = new URL('../', import.meta.url);
const cms = parse(readFileSync(new URL('cms/config.yml', root), 'utf8'));
const errors = [];

// Fields the CMS writes that are not frontmatter.
const BODY_FIELDS = new Set(['body']);

/** Unwraps optional/default/nullable wrappers. */
function unwrap(schema) {
  let s = schema;
  let optional = false;
  let hasDefault = false;
  for (;;) {
    const type = s.def.type;
    if (type === 'optional') optional = true;
    else if (type === 'default' || type === 'prefault') hasDefault = true;
    else if (type !== 'nullable') break;
    s = s.def.innerType;
  }
  return { inner: s, optional, hasDefault };
}

function compare(where, cmsFields, zodObject) {
  const shape = zodObject.shape;
  const cmsNames = new Set();
  for (const field of cmsFields) {
    if (BODY_FIELDS.has(field.name) && field.widget === 'markdown') continue;
    cmsNames.add(field.name);
    const zodField = shape[field.name];
    if (!zodField) {
      errors.push(`${where}.${field.name}: in the CMS but not in the Zod schema`);
      continue;
    }
    const { inner, optional, hasDefault } = unwrap(zodField);
    const cmsOptional = field.required === false;
    if (!hasDefault && cmsOptional !== optional) {
      errors.push(
        `${where}.${field.name}: ` +
          (cmsOptional
            ? 'required: false in the CMS but required in Zod (add .optional())'
            : 'optional in Zod but required in the CMS (add required: false)')
      );
    }
    if (field.widget === 'object') {
      if (inner.def.type !== 'object') {
        errors.push(`${where}.${field.name}: object in the CMS but not in Zod`);
      } else {
        compare(`${where}.${field.name}`, field.fields ?? [], inner);
      }
    }
  }
  for (const name of Object.keys(shape)) {
    if (!cmsNames.has(name)) errors.push(`${where}.${name}: in the Zod schema but not in the CMS`);
  }
}

function collection(name) {
  const c = cms.collections.find((col) => col.name === name);
  if (!c) throw new Error(`cms/config.yml has no collection "${name}"`);
  return c;
}

// The image() helper is only available inside Astro; a string stands in for it here.
const pages = pageSchema(() => z.string());
compare('pages', collection('pages').fields, pages);
const siteFile = collection('settings').files.find((f) => f.name === 'site');
compare('settings/site', siteFile.fields, settingsSchema);

// Validate the content that exists today.
const site = JSON.parse(readFileSync(new URL('src/content/settings/site.json', root), 'utf8'));
const siteResult = settingsSchema.safeParse(site);
if (!siteResult.success) errors.push(`site.json: ${z.prettifyError(siteResult.error)}`);

const pagesDir = new URL('src/content/pages/', root);
for (const dir of readdirSync(pagesDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const text = readFileSync(new URL(`${dir.name}/index.md`, pagesDir), 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) {
    errors.push(`pages/${dir.name}/index.md: no frontmatter`);
    continue;
  }
  const result = pages.safeParse(parse(match[1]) ?? {});
  if (!result.success) errors.push(`pages/${dir.name}: ${z.prettifyError(result.error)}`);
}

if (errors.length) {
  console.error('CMS config and schemas do not match:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log('CMS config matches the content schemas.');
