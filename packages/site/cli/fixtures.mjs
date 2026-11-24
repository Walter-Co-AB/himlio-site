// Sample content for the local dev server, for looking at the design and for screenshots.
// Part of @himlio/site. Uses EmDash's dev-only setup bypass, so it only works against `astro dev`.
//
//   himlio-site fixtures             tagline, company details, a home page, "About us" and
//                                    "Contact" with a sample contact form (in the site's language,
//                                    cli/samples.mjs: /om-oss and /kontakt on a Swedish site), the
//                                    privacy policy published, placeholder social links, and
//                                    "Block gallery"
//                                    (/block-gallery, -2, ...): every section type the pages allow, with
//                                    all fields filled (long text), only the required ones,
//                                    and once per option of each select field (design variants)
//   himlio-site fixtures --empty    everything empty: no tagline or details, pages unpublished
//   ... -- --url http://localhost:4644   another server (default: this repo's dev port)
//
// The text is labelled as sample text. Never run this against a deployed site.
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { devPort, readHimlio } from '../dist/config.js';
import { privacyPage } from '../dist/site/privacy.js';
import { samples } from './samples.mjs';

const args = process.argv.slice(3);
const empty = args.includes('--empty');
const urlArg = args[args.indexOf('--url') + 1];
const himlio = readHimlio(process.cwd());
const base = (args.includes('--url') ? urlArg : `http://localhost:${devPort(himlio.slug)}`).replace(
  /\/$/,
  ''
);

// Only write to this repo's own dev server (AGENTS.md, "Working alongside other agents").
function assertOwnServer() {
  const { hostname, port } = new URL(base);
  if (!['localhost', '127.0.0.1'].includes(hostname))
    throw new Error(`not a local server: ${base}`);
  let cwd = '';
  try {
    const pid = execFileSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')[0];
    cwd = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
      .split('\n')
      .find((l) => l.startsWith('n'))
      ?.slice(1);
  } catch {
    throw new Error(`no server listening on port ${port}; start it with npx himlio-site dev`);
  }
  if (cwd !== process.cwd()) throw new Error(`port ${port} belongs to ${cwd}, not this repo`);
}

const jar = new Map(); // cookie name -> value
async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      'X-EmDash-Request': '1',
      ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value && !/max-age=0|expires=thu, 01 jan 1970/i.test(header)) jar.set(name, value);
    else jar.delete(name);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const ok = (r, what) => {
  if (r.status >= 400)
    throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};

const block = (text, style = 'normal') => ({
  _type: 'block',
  _key: Math.random().toString(36).slice(2, 10),
  style,
  markDefs: [],
  children: [{ _type: 'span', _key: 's', text, marks: [] }],
});

const S = samples(himlio.locale);

/**
 * Sample pages for the site's content model. With pages built from sections (`content` is a
 * blocks field, as in EmDash's marketing template), the home page is "home" and uses the hero
 * and text blocks; with rich text (`content` is portableText) it is "start".
 */
async function samplePages() {
  const schema = ok(
    await api('GET', '/_emdash/api/schema/collections/pages?includeFields=true'),
    'read the pages schema'
  ).data.item;
  const content = schema.fields.find((f) => f.slug === 'content');
  if (content?.type !== 'blocks') {
    return {
      start: {
        title: S.titles.start,
        content: [block(S.startHeading, 'h2'), block(S.startText)],
      },
      [S.pages.about]: {
        title: S.titles.about,
        content: [block(S.aboutText), block(S.subheading, 'h2'), block(S.moreText)],
      },
    };
  }
  const allowed = new Set(content.validation?.allowedTypes ?? []);
  const key = () => Math.random().toString(36).slice(2, 10);
  const text = (headline, paragraphs) => ({
    _type: 'marketing_text',
    _key: key(),
    headline,
    body: paragraphs.map((t) => block(t)),
  });
  const hero = {
    _type: 'marketing_hero',
    _key: key(),
    headline: S.hero.headline,
    subheadline: S.hero.subheadline,
    primary_cta_label: S.hero.cta,
    primary_cta_url: `/${S.pages.about}`,
  };
  // The form in its own section (marketing_form, the starter's "Contact form") where the site
  // has it, otherwise as a Form block in a Text section.
  const contact = allowed.has('marketing_form')
    ? {
        _type: 'marketing_form',
        _key: key(),
        eyebrow: S.contact.eyebrow,
        headline: S.contact.headline,
        intro: S.contact.intro,
        form: FORM_SLUG,
        show_contact_details: true,
        aside_text: S.contact.aside,
      }
    : {
        _type: 'marketing_text',
        _key: key(),
        headline: S.contact.headline,
        body: [block(S.contact.intro), { _type: 'emdash-form', _key: key(), formId: FORM_SLUG }],
      };
  const only = (blocks) => blocks.filter((b) => allowed.size === 0 || allowed.has(b._type));
  // The platform adds the privacy policy page as a draft; publish it, so the footer links to it.
  const privacy = privacyPage(himlio.locale);
  const policy = {
    _type: 'marketing_text',
    _key: key(),
    body: [{ _type: 'himlio-privacy', _key: key() }],
  };
  return {
    ...(await galleryPages(allowed, content.validation?.maxItems ?? 20)),
    home: {
      title: S.titles.home,
      content: only([hero, text(S.startHeading, [S.startText])]),
    },
    [S.pages.about]: {
      title: S.titles.about,
      content: only([text(undefined, [S.aboutText, S.moreText])]),
    },
    [S.pages.contact]: { title: S.titles.contact, content: only([contact]) },
    [privacy.slug]: { title: privacy.title, content: only([policy]) },
  };
}

// A sample contact form from the Forms plugin, placed on the contact page (blocks sites only).
// Its slug, name and field names are internal, so English; its labels are the site's language.
const FORM_SLUG = 'sample-form';
const FORMS_API = '/_emdash/api/plugins/emdash-forms';
async function sampleForm() {
  const list = ok(await api('GET', `${FORMS_API}/forms/list`), 'list forms').data;
  if ((list.items ?? []).some((f) => f.slug === FORM_SLUG)) return;
  const field = (type, name, label, required, width = 'full') => ({
    id: name,
    type,
    name,
    label,
    required,
    width,
  });
  ok(
    await api('POST', `${FORMS_API}/forms/create`, {
      name: 'Sample form',
      slug: FORM_SLUG,
      pages: [
        {
          fields: [
            field('text', 'name', S.form.labels.name, true, 'half'),
            field('email', 'email', S.form.labels.email, true, 'half'),
            field('tel', 'phone', S.form.labels.phone, false),
            field('textarea', 'message', S.form.labels.message, true),
          ],
        },
      ],
      settings: {
        submitLabel: S.form.submit,
        confirmationMessage: S.form.confirmation,
        notifyEmails: ['info@example.com'],
        spamProtection: 'honeypot',
        retentionDays: 30,
      },
    }),
    'create the sample form'
  );
}

// ---- Block gallery ----------------------------------------------------------------------------

/** A PNG of a soft diagonal gradient, so image fields have something to show (no network). */
function samplePng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const i = row + 1 + x * 3;
      raw[i] = Math.round(70 + 150 * t);
      raw[i + 1] = Math.round(110 + 60 * (1 - t));
      raw[i + 2] = Math.round(160 - 60 * t);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function sampleImage() {
  const [width, height] = [1600, 1000];
  const form = new FormData();
  form.append(
    'file',
    new Blob([samplePng(width, height)], { type: 'image/png' }),
    'sample-image.png'
  );
  form.append('alt', 'Sample image');
  form.append('width', String(width));
  form.append('height', String(height));
  form.append('deduplicate', 'true');
  const res = await fetch(base + '/_emdash/api/media', {
    method: 'POST',
    headers: {
      Origin: base,
      'X-EmDash-Request': '1',
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`upload the sample image: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  const item = json.data.item;
  return {
    provider: 'local',
    id: item.id,
    src: item.url,
    filename: item.filename,
    mimeType: item.mimeType,
    width: item.width ?? width,
    height: item.height ?? height,
    alt: 'Sample image',
  };
}

// The gallery's sample content is in the site's language, with its long words (cli/samples.mjs).
// Everything else in the gallery (slugs, titles, the variant labels) is English: it is a
// developer tool, only ever on the local dev server.
const LONG = S.long;
const SKIP = /^(anchor_id|service)$|_id$/; // Section IDs must be unique; booking service by name
const URLISH = /(^|_)(url|href|link)$/;

function matches(value, validation) {
  if (typeof value !== 'string') return true;
  if (validation?.maxLength !== undefined && value.length > validation.maxLength) return false;
  if (validation?.pattern && !new RegExp(validation.pattern).test(value)) return false;
  return true;
}

/** A sample value for a field, or undefined to leave it out. */
function sampleValue(field, ctx) {
  const v = field.validation ?? {};
  const options = v.options ?? field.options;
  const clip = (text) => (v.maxLength ? text.slice(0, v.maxLength) : text);
  let value;
  switch (field.type) {
    case 'string':
      if (SKIP.test(field.slug)) return undefined;
      if (field.slug === 'form') value = FORM_SLUG;
      else if (URLISH.test(field.slug)) value = `/${S.pages.about}`;
      else if (/headline|title|name|question/.test(field.slug)) value = LONG.headline;
      else if (/price|amount/.test(field.slug)) value = LONG.price;
      else if (/value|number|stat/.test(field.slug)) value = '98 %';
      else if (/label|cta|badge|period|role/.test(field.slug)) value = LONG.short;
      else value = LONG.sentence;
      value = clip(value);
      break;
    case 'text':
      value = clip(/points|list|items/.test(field.slug) ? LONG.lines : LONG.paragraphs);
      break;
    case 'url':
      value = 'https://example.com/';
      break;
    case 'number':
    case 'integer':
      value = Math.min(v.max ?? 42, Math.max(v.min ?? 42, 42));
      break;
    case 'boolean':
      value = true;
      break;
    case 'datetime':
      value = new Date().toISOString();
      break;
    case 'select':
      value = ctx.select?.[field.slug] ?? options?.[0];
      break;
    case 'multiSelect':
      value = options ?? [];
      break;
    case 'portableText':
      value = [
        block(LONG.subheading, 'h2'),
        block(LONG.paragraphs.split('\n\n')[0]),
        block(LONG.sentence),
      ];
      break;
    case 'image':
      value = ctx.image;
      break;
    case 'repeater': {
      const subs = v.subFields ?? [];
      const count = Math.max(v.minItems ?? 1, Math.min(v.maxItems ?? 3, ctx.minimal ? 1 : 3));
      value = Array.from({ length: count }, (_, i) => {
        const item = { _key: `item${i}` };
        for (const sub of subs) {
          if (ctx.minimal && !sub.required) continue;
          const subOptions = sub.options ?? sub.validation?.options;
          const x =
            sub.type === 'select' && subOptions
              ? subOptions[i % subOptions.length]
              : sampleValue(sub, { ...ctx, select: undefined });
          if (x !== undefined) item[sub.slug] = x;
        }
        return item;
      });
      break;
    }
    default:
      return undefined;
  }
  return matches(value, v) ? value : undefined;
}

/**
 * The block gallery: every block type the pages allow, from the live content model, so a site's
 * own block types and variants are in it too. Per type: all fields filled, only the required
 * ones (for the empty states), and once per further option of each select field.
 */
async function galleryPages(allowed, maxBlocks) {
  const types = ok(await api('GET', '/_emdash/api/schema/block-types'), 'list block types').data
    .items;
  const image = await sampleImage();
  const key = () => Math.random().toString(36).slice(2, 10);
  const content = [];
  for (const type of types) {
    if (allowed.size > 0 && !allowed.has(type.slug)) continue;
    const version = type.versions.find((x) => x.version === type.currentVersion);
    if (!version) continue;
    const make = (variant, ctx) => {
      const value = { _type: type.slug, _key: key() };
      for (const field of version.fields) {
        if (ctx.minimal && !field.required) continue;
        const x = sampleValue(field, { image, ...ctx });
        if (x !== undefined) value[field.slug] = x;
      }
      // Say which variant this is in the first text field (usually the headline).
      const first = version.fields.find(
        (f) =>
          f.type === 'string' &&
          typeof value[f.slug] === 'string' &&
          f.slug !== 'form' &&
          !URLISH.test(f.slug)
      );
      if (first) value[first.slug] = `${type.label} (${variant}): ${value[first.slug]}`;
      return value;
    };
    content.push(make('all fields', {}));
    content.push(make('required only', { minimal: true }));
    for (const field of version.fields.filter((f) => f.type === 'select')) {
      for (const option of (field.validation?.options ?? []).slice(1))
        content.push(make(`${field.slug}: ${option}`, { select: { [field.slug]: option } }));
    }
  }
  // A page takes at most maxBlocks sections (pages.content's maxItems), so split it up.
  const pages = {};
  for (let i = 0; i * maxBlocks < content.length; i++)
    pages[i ? `block-gallery-${i + 1}` : 'block-gallery'] = {
      title: i ? `Block gallery ${i + 1}` : 'Block gallery',
      content: content.slice(i * maxBlocks, (i + 1) * maxBlocks),
    };
  return pages;
}

async function upsertPage(slug, page, collection = 'pages') {
  const at = `/_emdash/api/content/${collection}`;
  const existing = await api('GET', `${at}/${slug}`);
  if (existing.status === 200) {
    const rev = existing.json.data._rev;
    ok(await api('PUT', `${at}/${slug}`, { _rev: rev, data: page }), `update ${slug}`);
  } else {
    ok(await api('POST', at, { slug, data: page }), `create ${slug}`);
  }
  const after = ok(await api('GET', `${at}/${slug}`), `read ${slug}`).data.item;
  if (after.status !== 'published' || after.draftRevisionId)
    ok(await api('POST', `${at}/${slug}/publish`, {}), `publish ${slug}`);
}

// Unpublish rather than delete: a trashed page keeps its slug, so the next sample run couldn't
// create it again.
async function removePage(slug, collection = 'pages') {
  const at = `/_emdash/api/content/${collection}`;
  const existing = await api('GET', `${at}/${slug}`);
  if (existing.status === 200 && existing.json.data.item.status === 'published')
    ok(await api('POST', `${at}/${slug}/unpublish`, {}), `unpublish ${slug}`);
  return existing.status === 200;
}

// Sample posts, on sites with a News collection (`posts`, as in the starter): three, so lists
// and the post page have something to show. Slugs are internal-looking on purpose.
const POST_SLUGS = ['sample-post-1', 'sample-post-2', 'sample-post-3'];
async function hasPosts() {
  return (await api('GET', '/_emdash/api/schema/collections/posts')).status === 200;
}
async function samplePosts() {
  if (!(await hasPosts())) return;
  const image = await sampleImage();
  for (const [i, slug] of POST_SLUGS.entries())
    await upsertPage(
      slug,
      {
        title: i === 0 ? S.long.headline : `${S.post.title} ${i + 1}`,
        excerpt: i === 1 ? undefined : S.long.sentence,
        ...(i === 2 ? {} : { image }),
        content: [
          block(S.post.paragraph),
          block(S.subheading, 'h2'),
          ...S.long.paragraphs.split('\n\n').map((p) => block(p)),
        ],
      },
      'posts'
    );
}

const COMPANY_ENTRY = 'company-details'; // renamed from foretagsuppgifter by 0003

async function setCompany(data) {
  const entry = await api('GET', `/_emdash/api/content/company/${COMPANY_ENTRY}`);
  if (entry.status !== 200) {
    console.warn('company entry not found (content-model migration not applied yet?); skipped');
    return;
  }
  ok(
    await api('PUT', `/_emdash/api/content/company/${COMPANY_ENTRY}`, {
      _rev: entry.json.data._rev,
      data,
    }),
    'update company'
  );
}

assertOwnServer();
await fetch(base + '/'); // first request applies content-model migrations
ok(await api('POST', '/_emdash/api/setup/dev-bypass'), 'dev bypass');

if (empty) {
  ok(await api('POST', '/_emdash/api/settings', { tagline: '', social: {} }), 'settings');
  await setCompany({ phone: '', email: '', address: '', org_number: '', opening_hours: '' });
  for (const slug of [
    'home',
    'start',
    S.pages.about,
    S.pages.contact,
    privacyPage(himlio.locale).slug,
  ])
    await removePage(slug);
  for (let i = 1; await removePage(i > 1 ? `block-gallery-${i}` : 'block-gallery'); i++);
  if (await hasPosts()) for (const slug of POST_SLUGS) await removePage(slug, 'posts');
  console.log(`fixtures: empty state on ${base}`);
} else {
  ok(
    await api('POST', '/_emdash/api/settings', {
      tagline: S.tagline,
      // Placeholder profiles, so the footer shows its social links.
      social: { instagram: 'example', facebook: 'example', linkedin: 'example' },
    }),
    'settings'
  );
  await setCompany({ ...S.company, email: 'info@example.com' });
  const pages = await samplePages();
  if (pages[S.pages.contact]) await sampleForm();
  await samplePosts();
  for (const [slug, page] of Object.entries(pages)) await upsertPage(slug, page);
  const gallery = Object.keys(pages).filter((slug) => slug.startsWith('block-gallery'));
  // Unpublish gallery pages a bigger content model left behind.
  for (let i = gallery.length + 1; await removePage(`block-gallery-${i}`); i++);
  if (gallery.length) console.log(`fixtures: block gallery on /${gallery.join(', /')}`);
  console.log(`fixtures: sample content on ${base}`);
}
