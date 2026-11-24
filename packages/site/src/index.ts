// The Himlio platform for an Astro site: EmDash (D1, R2, sessions in D1, email, forms, English admin)
// from himlio.json, the Cloudflare adapter with a generated Worker config, the platform
// middleware, and the dev port.
//
//   // astro.config.mjs
//   import { defineHimlioConfig } from '@himlio/site';
//   export default defineHimlioConfig({
//     integrations: [/* the site's own */],
//     himlio: { crons: { '0 3 * * *': './src/cron/nightly.ts' } }, // optional
//   });
//
// A function around the whole config, not just an integration, because Astro needs the adapter
// in the top-level `adapter` field: from an integration list, `astro dev` doesn't run.
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import { d1, r2 } from '@emdash-cms/cloudflare';
import { cloudflareEmail } from '@emdash-cms/cloudflare/plugins';
import type { AstroIntegration, AstroUserConfig } from 'astro';
import emdash from 'emdash/astro';
import { resolve } from 'node:path';
import {
  devPort,
  readHimlio,
  readModelMigrations,
  writeGenerated,
  type HimlioFacts,
  type HimlioOptions,
} from './config.js';
import { bookingPlugin } from './booking-plugin.js';
import { formsPlugin } from './forms-plugin.js';
import { sitePlugin } from './site-plugin.js';

export type { HimlioFacts, HimlioOptions };
export { devPort };

const VIRTUAL_ID = 'virtual:himlio/config';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

/** The module behind `virtual:himlio/config`, read by the runtime in the Worker. */
function virtualModule(root: string, facts: HimlioFacts, options: HimlioOptions): string {
  const crons = Object.entries(options.crons ?? {});
  return [
    ...crons.map(([, path], i) => `import cron${i} from ${JSON.stringify(resolve(root, path))};`),
    `export const facts = ${JSON.stringify(facts)};`,
    `export const modelMigrations = ${JSON.stringify(readModelMigrations(root, options))};`,
    `export const siteCrons = {${crons.map(([expr], i) => `${JSON.stringify(expr)}: cron${i}`).join(', ')}};`,
  ].join('\n');
}

function himlio(options: HimlioOptions) {
  const root = process.cwd();
  const facts = readHimlio(root);
  const configPath = writeGenerated(root, options);

  // The site's public URL from himlio.json: passkeys, OAuth, MCP and links in emails use it.
  // Not in `astro dev`, where it would tie admin sign-in to the real domain, not localhost.
  const isDev = process.argv.slice(2).includes('dev');
  const siteUrl = !isDev && facts.url ? facts.url : undefined;

  // Email through the platform's EMAIL binding, only when himlio.json has `email` (the
  // platform writes it once the binding exists). No Reply-To: these are system emails.
  const emailPlugins = facts.email
    ? [cloudflareEmail({ binding: 'EMAIL', from: { email: facts.email.from, name: facts.name } })]
    : [];

  // Platform settings, set directly in the config: the adapter's hooks run before any
  // integration's, so a session driver set later would be too late (it would add KV).
  const settings = {
    site: facts.url ?? undefined,
    output: 'server' as const,
    // Sessions in D1 instead of the Cloudflare adapter's default KV store.
    session: {
      driver: { entrypoint: '@himlio/site/session-driver' },
      ttl: 30 * 24 * 60 * 60,
    },
    server: { port: devPort(facts.slug) },
    devToolbar: { enabled: false },
  };
  const vitePlugin = {
    name: '@himlio/site:virtual-config',
    resolveId: (id: string) => (id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : undefined),
    load: (id: string) =>
      id === RESOLVED_VIRTUAL_ID ? virtualModule(root, facts, options) : undefined,
  };

  // Registered after EmDash, so its middleware runs after EmDash's (both "pre").
  const runtime: AstroIntegration = {
    name: '@himlio/site:runtime',
    hooks: {
      'astro:config:setup': ({ addMiddleware }) => {
        addMiddleware({ entrypoint: '@himlio/site/middleware', order: 'pre' });
      },
    },
  };

  const adapter = cloudflare({
    configPath,
    // No Cloudflare Images binding on Himlio yet: images are served as uploaded.
    imageService: 'passthrough',
    persistState: { path: resolve(root, '.wrangler/state') },
  });
  const integrations: AstroIntegration[] = [
    react(),
    emdash({
      siteUrl,
      database: d1({ binding: 'DB', session: 'auto', coalesce: true }),
      storage: r2({ binding: 'MEDIA' }),
      // Forms on every site: built in the admin, placed on a page as a Form block in
      // rich text. Honeypot spam protection unless a form chooses otherwise; notifications go
      // out through the email plugin above.
      // Booking (Bokning): services and opening hours in the admin, a Booking block for pages.
      plugins: [
        formsPlugin({ defaultSpamProtection: 'honeypot' }),
        bookingPlugin(),
        sitePlugin(),
        ...emailPlugins,
      ],
      admin: {
        siteName: facts.name,
        // The admin is in English, like EmDash, its plugins and the code. The site itself (content
        // and interface text) is in its own language, himlio.json `locale`.
        locales: ['en'],
      },
    }),
    runtime,
  ];
  return { adapter, integrations, settings, vitePlugin };
}

export type HimlioConfig = AstroUserConfig & {
  /** The site's own crons, content model, Durable Objects and vars. */
  himlio?: HimlioOptions;
};

/**
 * The site's Astro config with the platform added. The site may set anything Astro allows;
 * its integrations run after the platform's. The platform sets the adapter, output, session,
 * site URL and dev port, and those win.
 */
export function defineHimlioConfig(config: HimlioConfig = {}): AstroUserConfig {
  const { himlio: options = {}, integrations = [], vite = {}, image = {}, ...rest } = config;
  const platform = himlio(options);
  return {
    ...rest,
    ...platform.settings,
    adapter: platform.adapter,
    image: { layout: 'constrained', responsiveStyles: true, ...image },
    vite: {
      ...vite,
      plugins: [platform.vitePlugin, ...(vite.plugins ?? [])],
      // If the port is taken, `astro dev` fails instead of moving to another one.
      server: { ...vite.server, strictPort: true },
    },
    integrations: [...platform.integrations, ...integrations],
  } as unknown as AstroUserConfig;
}
