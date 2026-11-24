// The platform's middleware, registered by himlio() after EmDash's own. A site's own
// src/middleware.ts runs after it; nothing to wire up. It also answers /_booking, the page
// behind the links in booking emails (booking-pages.ts).
import { defineMiddleware } from 'astro:middleware';
import { facts } from 'virtual:himlio/config';
import { bookingPage, isBookingPage } from './booking-pages.js';
import { startModelMigrations } from './model-migrations.js';

/**
 * Starts pending content-model migrations after the response, without delaying it. Only when a
 * Cloudflare request context is available (Workers and `astro dev`), not during the build.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (isBookingPage(context.url)) {
    const runtime = (context.locals as { emdash?: Parameters<typeof bookingPage>[1] }).emdash;
    return bookingPage(context.request, runtime, facts.name, facts.locale);
  }
  const response = await next();
  const cf = (context.locals as { cfContext?: { waitUntil(p: Promise<unknown>): void } }).cfContext;
  if (cf) startModelMigrations((promise) => cf.waitUntil(promise));
  return response;
});
