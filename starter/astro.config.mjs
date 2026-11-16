// The site's Astro config. defineHimlioConfig() adds the platform: EmDash, Cloudflare, sessions,
// email, the Worker and the build artifact, all from himlio.json. Add the site's own
// integrations and options here.
import { defineHimlioConfig } from '@himlio/site';

export default defineHimlioConfig({
  integrations: [],
});
