// The platform's middleware. Platform-owned. src/middleware.ts (the site's file) must run it
// first: `export const onRequest = sequence(himlioMiddleware, ...)`.
import { defineMiddleware } from 'astro:middleware';
import { ensureModelMigrations } from './model-migrations';

/** Applies pending content-model migrations. Runs after EmDash's own middleware. */
export const himlioMiddleware = defineMiddleware(async (context, next) => {
  const db = context.locals.emdash?.db;
  if (db) await ensureModelMigrations(db);
  return next();
});
