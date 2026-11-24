// The descriptor of Himlio's site plugin, what EmDash's integration gets in `plugins`. Written
// out like ./booking-plugin.ts: the config is loaded in plain Node, and EmDash's Vite build loads
// the plugin itself from `entrypoint` (dist/site/plugin.js).
import type { PluginDescriptor } from 'emdash';

export const SITE_ENTRYPOINT = '@himlio/site/site/plugin';

export function sitePlugin(): PluginDescriptor {
  return {
    id: 'himlio-site',
    version: '1.0.0',
    entrypoint: SITE_ENTRYPOINT,
    componentsEntry: '@himlio/site/site/astro',
    options: {},
    capabilities: ['hooks.page-fragments:register'],
  } as PluginDescriptor;
}
