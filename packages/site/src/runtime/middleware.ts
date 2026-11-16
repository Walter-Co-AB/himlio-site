// The platform's middleware, registered by himlio() after EmDash's own. A site's own
// src/middleware.ts runs after it; nothing to wire up.
import { defineMiddleware } from 'astro:middleware';
import { startModelMigrations } from './model-migrations.js';

/**
 * Starts pending content-model migrations after the response, without delaying it. Only when a
 * Cloudflare request context is available (Workers and `astro dev`), not during the build.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const cf = (context.locals as { cfContext?: { waitUntil(p: Promise<unknown>): void } }).cfContext;
  if (cf) startModelMigrations((promise) => cf.waitUntil(promise));
  return response;
});
