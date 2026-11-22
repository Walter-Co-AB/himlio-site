// The booking plugin as EmDash loads it (entrypoint of the descriptor in ../booking-plugin.ts):
// routes and MCP tools (routes.ts) over the operations in core.ts, with the platform's facts
// (himlio.json), email and the plugin's own storage.

import { definePlugin } from 'emdash';
import { facts } from 'virtual:himlio/config';
import type { Deps } from './core.js';
import { fetchCalendar, mailer } from './mailer.js';
import { bookingMcpTools, bookingRoutes, type Ctx } from './routes.js';
import { BOOKING_PLUGIN_ID, BOOKING_PLUGIN_VERSION, BOOKING_STORAGE } from './store.js';

const send = mailer(facts.email ? { email: facts.email.from, name: facts.name } : null);

/** The public origin for links: himlio.json's URL, else EmDash's, else this request's (dev). */
function siteUrl(ctx: Ctx): string {
  if (facts.url) return facts.url;
  if (ctx.site?.url) return ctx.site.url;
  try {
    return new URL(ctx.request.url).origin;
  } catch {
    return '';
  }
}

function makeDeps(ctx: Ctx): Deps {
  return {
    storage: ctx.storage,
    kv: ctx.kv,
    now: () => Date.now(),
    send,
    site: { name: ctx.site?.name || facts.name, url: siteUrl(ctx) },
    platformNotify: facts.forms.notify,
    fetchCalendar,
    log: ctx.log,
  };
}

export function createPlugin() {
  return definePlugin({
    id: BOOKING_PLUGIN_ID,
    version: BOOKING_PLUGIN_VERSION,
    capabilities: ['network:request'],
    allowedHosts: ['*'],
    storage: BOOKING_STORAGE as never,
    routes: bookingRoutes(makeDeps) as never,
    mcp: { tools: bookingMcpTools() },
    admin: {
      portableTextBlocks: [
        {
          type: BOOKING_PLUGIN_ID,
          label: 'Booking',
          icon: 'calendar',
          description: 'A booking form: the visitor picks a time',
          fields: [
            {
              type: 'select',
              action_id: 'service',
              label: 'Service (empty: the visitor chooses)',
              options: [],
              optionsRoute: 'services/list',
            },
          ],
        },
      ],
    },
  });
}

export default createPlugin;
