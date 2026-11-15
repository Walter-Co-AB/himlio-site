import handler, {
  createScheduledHandler,
  EmDashRoom,
  EmDashRoomSite,
  PluginBridge,
} from '@emdash-cms/cloudflare/worker';
import { isOAuthScopePath, limitOAuthScopes, refusesOAuthToken } from './lib/oauth-scopes';
import { deleteExpiredSessions } from './lib/session-d1';

export { EmDashRoom, EmDashRoomSite, PluginBridge };

const emdashScheduled = createScheduledHandler();

// Scheduled publishing and maintenance (EmDash), and session cleanup.
const scheduled: ExportedHandlerScheduledHandler<Env> = (controller, env, ctx) => {
  emdashScheduled(controller, env, ctx);
  ctx.waitUntil(
    deleteExpiredSessions(env.DB).catch((error: unknown) => {
      console.error('[scheduled] deleting expired sessions failed:', error);
    })
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
