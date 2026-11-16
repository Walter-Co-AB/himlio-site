import handler, {
  createScheduledHandler,
  EmDashRoom,
  EmDashRoomSite,
  PluginBridge,
} from '@emdash-cms/cloudflare/worker';
import { siteCrons } from 'virtual:himlio/config';
import { addMcpInstructions, initializeIds, isMcpPath } from './mcp-instructions.js';
import { isOAuthScopePath, limitOAuthScopes, refusesOAuthToken } from './oauth-scopes.js';
import { deleteExpiredSessions } from './session-d1.js';

export { EmDashRoom, EmDashRoomSite, PluginBridge };

const emdashScheduled = createScheduledHandler();

const PLATFORM_CRON = '* * * * *';

// The platform's minute: scheduled publishing and maintenance (EmDash) and session cleanup.
// Any other expression is the site's own (himlio({ crons })).
const scheduled: ExportedHandlerScheduledHandler<Env> = (controller, env, ctx) => {
  if (controller.cron === PLATFORM_CRON) {
    emdashScheduled(controller, env, ctx);
    ctx.waitUntil(
      deleteExpiredSessions(env.DB).catch((error: unknown) => {
        console.error('[scheduled] deleting expired sessions failed:', error);
      })
    );
    return;
  }
  const handler = siteCrons[controller.cron];
  if (!handler) {
    console.warn(`[scheduled] no handler for cron "${controller.cron}"`);
    return;
  }
  ctx.waitUntil(
    Promise.resolve()
      .then(() => handler(controller, env, ctx))
      .catch((error: unknown) => console.error(`[scheduled] "${controller.cron}" failed:`, error))
  );
};

interface Env {
  DB: D1Database;
}

// Sites on Himlio can't have Cron Triggers. The platform calls POST /_himlio/cron instead,
// with the cron expression in X-Himlio-Cron. The router only lets the platform reach
// /_himlio/*; anything else under it answers 404 here too.
function himlio(request: Request, env: Env, ctx: ExecutionContext): Response {
  const { pathname } = new URL(request.url);
  if (pathname !== '/_himlio/cron') return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const cron = request.headers.get('X-Himlio-Cron')?.trim();
  if (!cron || cron.length > 100) return new Response('Bad request', { status: 400 });

  const controller: ScheduledController = {
    cron,
    scheduledTime: Date.now(),
    noRetry() {},
  };
  // The work runs in ctx.waitUntil, so the platform gets its answer straight away.
  scheduled(controller, env, ctx);
  return new Response(null, { status: 202 });
}

export default {
  ...handler,
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/_himlio/')) return himlio(request, env, ctx);
    if (refusesOAuthToken(request)) return new Response('Forbidden', { status: 403 });
    if (isMcpPath(url)) {
      const ids = await initializeIds(request);
      return addMcpInstructions(await handler.fetch!(request, env, ctx), ids);
    }
    if (isOAuthScopePath(url)) {
      const limited = await limitOAuthScopes(request);
      if (limited instanceof Response) return limited;
      // Same request with rewritten scopes; it keeps the original's cf properties.
      return handler.fetch!(limited as typeof request, env, ctx);
    }
    return handler.fetch!(request, env, ctx);
  },
  scheduled,
} satisfies ExportedHandler<Env>;
