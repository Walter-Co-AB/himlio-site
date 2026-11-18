// Full-page screenshots of the local dev server, light, dark and mobile. Part of @himlio/site.
//
//   himlio-site screenshots --out screenshots/full [--url http://localhost:4321] [/ /om-oss ...]
//
// Pages default to the home page, "Om oss" (from himlio-site fixtures) and a missing page (404).
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { devPort, readHimlio } from '../dist/config.js';

const args = process.argv.slice(3);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const himlio = readHimlio(process.cwd());
const base = (value('--url') ?? `http://localhost:${devPort(himlio.slug)}`).replace(/\/$/, '');
const out = value('--out') ?? 'screenshots';
const flagValues = new Set([value('--url'), value('--out')]);
const pages = args.filter((a) => a.startsWith('/') && !flagValues.has(a));
if (pages.length === 0) pages.push('/', '/om-oss', '/kontakt', '/sidan-finns-inte');

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
      // Scroll through the page so scroll-triggered effects (IntersectionObserver reveals, lazy
      // images) run, back to the top, then let running animations finish (at most 3 s).
      await page.evaluate(async () => {
        const pause = (ms) => new Promise((r) => setTimeout(r, ms));
        const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
        for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await pause(100);
        }
        window.scrollTo(0, document.documentElement.scrollHeight);
        await pause(200);
        window.scrollTo(0, 0);
        // Let scroll handlers react to being back at the top: they often update in
        // requestAnimationFrame, and their CSS transitions start a frame later.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await pause(300);
        await Promise.race([
          Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
          pause(3000),
        ]);
      });
      const file = join(out, name, fileName(path));
      await page.screenshot({ path: file, fullPage: true });
      console.log(`${res?.status() ?? '?'} ${path} -> ${file}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
