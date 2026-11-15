// The site's middleware. Keep himlioMiddleware first; add the site's own after it.
import { sequence } from 'astro:middleware';
import { himlioMiddleware } from './lib/himlio-middleware';

export const onRequest = sequence(himlioMiddleware);
