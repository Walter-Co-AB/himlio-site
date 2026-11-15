import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import { d1, r2 } from '@emdash-cms/cloudflare';
import { cloudflareEmail } from '@emdash-cms/cloudflare/plugins';
import { defineConfig } from 'astro/config';
import emdash from 'emdash/astro';
import himlio from './himlio.json' with { type: 'json' };

// Email (invites, sign-in links, comment notices) through the platform's EMAIL binding.
// Only when himlio.json has `email`, which the platform writes once it has added the binding.
// Without it EmDash has no email provider, and invites give a link to share instead.
// No Reply-To: these are system emails from a no-reply sender, and the customer's contact
// address lives in the admin, which build-time config can't read.
const emailPlugins = himlio.email?.from
  ? [
      cloudflareEmail({
        binding: 'EMAIL',
        from: { email: himlio.email.from, name: himlio.name },
      }),
    ]
  : [];

// The site's public URL from himlio.json: passkeys, OAuth, MCP and links in emails all use it.
// Not in `astro dev`, where it would tie admin sign-in to the real domain instead of localhost.
const isDev = process.argv.slice(2).includes('dev');
const siteUrl = !isDev && himlio.url ? himlio.url : undefined;

// Every repo gets its own dev port, so agents and people working on several sites at once never
// talk to another site's server: 4321 for the template, 4400–4899 for a customer site (from its
// slug). strictPort: if the port is taken, `astro dev` fails instead of moving to the next one.
export const devPort = (slug) => {
  if (!slug || slug === 'template') return 4321;
  let hash = 0x811c9dc5; // FNV-1a
  for (const ch of slug) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return 4400 + (hash % 500);
};

export default defineConfig({
  server: { port: devPort(himlio.slug) },
  vite: { server: { strictPort: true } },
  site: himlio.url ?? undefined,
  output: 'server',
  // No Cloudflare Images binding on Himlio yet: images are served as uploaded.
  adapter: cloudflare({ imageService: 'passthrough' }),
  // Sessions in D1 instead of the adapter's default KV store. See src/lib/session-d1.ts.
  session: {
    driver: { entrypoint: new URL('./src/lib/session-d1.ts', import.meta.url) },
    ttl: 30 * 24 * 60 * 60,
  },
  image: {
    layout: 'constrained',
    responsiveStyles: true,
  },
  integrations: [
    react(),
    emdash({
      siteUrl,
      database: d1({ binding: 'DB', session: 'auto', coalesce: true }),
      storage: r2({ binding: 'MEDIA' }),
      plugins: emailPlugins,
      admin: {
        siteName: himlio.name,
        // Swedish first. English stays available; the admin picks from the browser language.
        locales: ['sv', 'en'],
      },
    }),
  ],
  devToolbar: { enabled: false },
});
