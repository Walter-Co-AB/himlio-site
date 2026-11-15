// Runs after EmDash's own middleware, which provides locals.emdash.
import { defineMiddleware } from 'astro:middleware';
import { ensureModelMigrations } from './lib/model-migrations';

export const onRequest = defineMiddleware(async (context, next) => {
  const db = context.locals.emdash?.db;
  if (db) await ensureModelMigrations(db);
  return next();
});
