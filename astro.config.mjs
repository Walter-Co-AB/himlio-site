import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { siteUrl } from './src/lib/site-url.mjs';

export default defineConfig({
  site: siteUrl,
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
});
