// Full-page screenshots of the local dev server, light, dark and mobile. Platform-owned.
//
//   npm run screenshots -- --out screenshots/full [--url http://localhost:4321] [/ /om-oss ...]
//
// Pages default to the home page, "Om oss" (from dev:fixtures) and a missing page (404).
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { devPort } from '../himlio.config.mjs';

const args = process.argv.slice(2);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const himlio = JSON.parse(readFileSync('himlio.json', 'utf8'));
const base = (value('--url') ?? `http://localhost:${devPort(himlio.slug)}`).replace(/\/$/, '');
const out = value('--out') ?? 'screenshots';
const flagValues = new Set([value('--url'), value('--out')]);
const pages = args.filter((a) => a.startsWith('/') && !flagValues.has(a));
if (pages.length === 0) pages.push('/', '/om-oss', '/sidan-finns-inte');

const VARIANTS = [
  { name: 'desktop-light', viewport: { width: 1280, height: 800 }, colorScheme: 'light' },
  { name: 'desktop-dark', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' },
  {
    name: 'mobile-light',
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
    isMobile: true,
  },
];

const fileName = (path) =>
  (path === '/' ? 'start' : path.replace(/^\/|\/$/g, '').replace(/\//g, '_')) + '.png';

const browser = await chromium.launch();
try {
  for (const { name, ...options } of VARIANTS) {
    const context = await browser.newContext({ ...options, deviceScaleFactor: 1 });
    const page = await context.newPage();
    mkdirSync(join(out, name), { recursive: true });
    for (const path of pages) {
      const res = await page.goto(base + path, { waitUntil: 'networkidle' });
      const file = join(out, name, fileName(path));
      await page.screenshot({ path: file, fullPage: true });
      console.log(`${res?.status() ?? '?'} ${path} -> ${file}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
