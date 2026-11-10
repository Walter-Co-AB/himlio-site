import type { APIRoute } from 'astro';
import { isPreview } from '../lib/site-url.mjs';

// Preview deployments are not indexed.
export const GET: APIRoute = ({ site }) => {
  const body = isPreview
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nDisallow: /admin/\n\nSitemap: ${new URL('sitemap-index.xml', site)}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
