// The descriptor of Himlio's booking plugin (Bokning), what EmDash's integration gets in
// `plugins`. Written out like ./forms-plugin.ts: the config is loaded in plain Node, and EmDash's
// Vite build loads the plugin itself from `entrypoint` (dist/booking/plugin.js).
import type { PluginDescriptor } from 'emdash';
import {
  BOOKING_ADMIN_PAGES,
  BOOKING_PLUGIN_ID,
  BOOKING_PLUGIN_VERSION,
  BOOKING_STORAGE,
} from './booking/store.js';

export const BOOKING_ENTRYPOINT = '@himlio/site/booking/plugin';

export function bookingPlugin(): PluginDescriptor {
  return {
    id: BOOKING_PLUGIN_ID,
    version: BOOKING_PLUGIN_VERSION,
    entrypoint: BOOKING_ENTRYPOINT,
    componentsEntry: '@himlio/site/booking/astro',
    adminEntry: '@himlio/site/booking/admin',
    adminPages: BOOKING_ADMIN_PAGES,
    options: {},
    capabilities: ['network:request'],
    allowedHosts: ['*'],
    // The descriptor takes flat indexes; the composite ones are in the plugin (store.ts).
    storage: Object.fromEntries(
      Object.entries(BOOKING_STORAGE).map(([name, c]) => [
        name,
        { indexes: (c.indexes as readonly unknown[]).filter((i) => typeof i === 'string') },
      ])
    ),
  } as PluginDescriptor;
}
