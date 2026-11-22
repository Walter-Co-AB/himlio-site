// The booking plugin as EmDash loads it (entrypoint of the descriptor in ../booking-plugin.ts):
// routes and MCP tools (routes.ts) over the operations in core.ts, with the platform's facts
// (himlio.json), email and the plugin's own storage.

import { definePlugin } from 'emdash';
import { facts } from 'virtual:himlio/config';
import type { Deps } from './core.js';
import { fetchCalendar, mailer } from './mailer.js';
import { bookingMcpTools, bookingRoutes, type Ctx } from './routes.js';
import {
  BOOKING_ADMIN_PAGES,
  BOOKING_PLUGIN_ID,
  BOOKING_PLUGIN_VERSION,
  BOOKING_STORAGE,
} from './store.js';

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

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Turnstile, when the site has a site key (himlio.json) and the secret (Worker secret
 * TURNSTILE_SECRET; it arrives with the release after the key). Without either: undefined, and
 * booking confirms by email. The token must be for this site's hostname.
 */
async function turnstile(ctx: Ctx): Promise<Pick<Deps, 'verifyHuman' | 'turnstileSiteKey'>> {
  const siteKey = facts.turnstile?.siteKey;
  if (!siteKey) return {};
  const secret = ((await import('./worker-env.js')).env as unknown as { TURNSTILE_SECRET?: string })
    .TURNSTILE_SECRET;
  if (!secret) return {};
  let hostname = '';
  try {
    hostname = new URL(ctx.request.url).hostname;
  } catch {
    return {};
  }
  const ip = ctx.requestMeta?.ip as string | null | undefined;
  return {
    turnstileSiteKey: siteKey,
    async verifyHuman(token: string) {
      const body = new FormData();
      body.append('secret', secret);
      body.append('response', token);
      if (ip) body.append('remoteip', ip);
      const res = await fetch(SITEVERIFY, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const result = (await res.json()) as {
        success?: boolean;
        hostname?: string;
        metadata?: { result_with_testing_key?: boolean };
      };
      if (result.success !== true) return false;
      // Cloudflare's test keys answer for example.com; accept them only on localhost (dev).
      if (result.metadata?.result_with_testing_key)
        return hostname === 'localhost' || hostname === '127.0.0.1';
      return result.hostname === hostname;
    },
  };
}

async function makeDeps(ctx: Ctx): Promise<Deps> {
  return {
    ...(await turnstile(ctx)),
    storage: ctx.storage,
    kv: ctx.kv,
    now: () => Date.now(),
    send,
    site: {
      name: ctx.site?.name || facts.name,
      url: siteUrl(ctx),
      ...(facts.email?.replyTo ? { replyTo: facts.email.replyTo } : {}),
    },
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
      pages: BOOKING_ADMIN_PAGES,
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
            {
              type: 'select',
              action_id: 'resource',
              label: 'Who (empty: the visitor chooses)',
              options: [],
              optionsRoute: 'resources/list',
            },
          ],
        },
      ],
    },
  });
}

export default createPlugin;
