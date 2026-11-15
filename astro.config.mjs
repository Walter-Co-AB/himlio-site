// The site's Astro config. Add the site's own integrations, Vite plugins and other options here;
// defineHimlioConfig() (himlio.config.mjs, platform-owned) adds EmDash, Cloudflare and the rest.
import { defineHimlioConfig } from './himlio.config.mjs';

export default defineHimlioConfig({
  integrations: [],
});
