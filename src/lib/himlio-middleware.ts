// The platform's middleware. Platform-owned. src/middleware.ts (the site's file) must run it
// first: `export const onRequest = sequence(himlioMiddleware, ...)`.
import { defineMiddleware } from 'astro:middleware';
import { startModelMigrations } from './model-migrations';

/**
 * Starts pending content-model migrations after the response, without delaying it. Only when a
 * Cloudflare request context is available (Workers and `astro dev`), not during the build.
 */
export const himlioMiddleware = defineMiddleware(async (context, next) => {
  const response = await next();
  const cf = (context.locals as { cfContext?: { waitUntil(p: Promise<unknown>): void } }).cfContext;
  if (cf) startModelMigrations((promise) => cf.waitUntil(promise));
  return response;
});
