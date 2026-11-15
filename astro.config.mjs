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
const emailPlugins = himlio.email?.from
  ? [
      cloudflareEmail({
        binding: 'EMAIL',
        from: { email: himlio.email.from, name: himlio.name },
        ...(himlio.contact?.email ? { replyTo: himlio.contact.email } : {}),
      }),
    ]
  : [];

export default defineConfig({
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
