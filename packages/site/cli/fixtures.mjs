// Sample content for the local dev server, for looking at the design and for screenshots.
// Part of @himlio/site. Uses EmDash's dev-only setup bypass, so it only works against `astro dev`.
//
//   himlio-site fixtures             tagline, company details, a start page and "Om oss"
//   himlio-site fixtures --empty    everything empty: no tagline or details, pages unpublished
//   ... -- --url http://localhost:4644   another server (default: this repo's dev port)
//
// The text is labelled as sample text. Never run this against a deployed site.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { devPort, readHimlio } from '../dist/config.js';

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

const PAGES = {
  start: {
    title: 'Välkommen',
    content: [
      block('Exempeltext för startsidan', 'h2'),
      block(
        'Det här är exempelinnehåll från npm run dev:fixtures, för att se hur designen fungerar med riktig text. Det visas bara på den lokala utvecklingsservern.'
      ),
    ],
  },
  'om-oss': {
    title: 'Om oss',
    content: [
      block(
        'Exempeltext: ett par stycken om företaget. Här kan kunden berätta vad de gör, för vem och hur man kommer i kontakt.'
      ),
      block('Exempel på underrubrik', 'h2'),
      block('Ytterligare ett stycke exempeltext för att visa radlängd och avstånd.'),
    ],
  },
};

async function upsertPage(slug, page) {
  const existing = await api('GET', `/_emdash/api/content/pages/${slug}`);
  if (existing.status === 200) {
    const rev = existing.json.data._rev;
    ok(
      await api('PUT', `/_emdash/api/content/pages/${slug}`, { _rev: rev, data: page }),
      `update ${slug}`
    );
  } else {
    ok(await api('POST', '/_emdash/api/content/pages', { slug, data: page }), `create ${slug}`);
  }
  const after = ok(await api('GET', `/_emdash/api/content/pages/${slug}`), `read ${slug}`).data
    .item;
  if (after.status !== 'published' || after.draftRevisionId)
    ok(await api('POST', `/_emdash/api/content/pages/${slug}/publish`, {}), `publish ${slug}`);
}

// Unpublish rather than delete: a trashed page keeps its slug, so the next sample run couldn't
// create it again.
async function removePage(slug) {
  const existing = await api('GET', `/_emdash/api/content/pages/${slug}`);
  if (existing.status === 200 && existing.json.data.item.status === 'published')
    ok(await api('POST', `/_emdash/api/content/pages/${slug}/unpublish`, {}), `unpublish ${slug}`);
}

async function setCompany(data) {
  const entry = await api('GET', '/_emdash/api/content/company/foretagsuppgifter');
  if (entry.status !== 200) {
    console.warn('company entry not found (content-model migration not applied yet?); skipped');
    return;
  }
  ok(
    await api('PUT', '/_emdash/api/content/company/foretagsuppgifter', {
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
  ok(await api('POST', '/_emdash/api/settings', { tagline: '' }), 'tagline');
  await setCompany({ phone: '', email: '', address: '', org_number: '', opening_hours: '' });
  for (const slug of Object.keys(PAGES)) await removePage(slug);
  console.log(`fixtures: empty state on ${base}`);
} else {
  ok(
    await api('POST', '/_emdash/api/settings', {
      tagline: 'Exempeltext: en mening om vad företaget gör.',
    }),
    'tagline'
  );
  await setCompany({
    phone: '08-123 456 78',
    email: 'info@example.com',
    address: 'Exempelgatan 1\n123 45 Stockholm',
    org_number: '556000-0000',
    opening_hours: 'Mån–fre 9–17',
  });
  for (const [slug, page] of Object.entries(PAGES)) await upsertPage(slug, page);
  console.log(`fixtures: sample content on ${base}`);
}
