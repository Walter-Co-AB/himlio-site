// The site's description: what the customer wrote in the admin, else the starting value from
// himlio.json (written by the platform, overwritten on every apply, not editable by customers).
//
// In the admin it is the Tagline (Settings → General; the setup wizard also asks for it).
// EmDash 1.5 has no separate site-wide SEO description: its SEO settings only hold the title
// separator, default image, robots.txt and verification codes. Per-page SEO descriptions are
// set on each page and win over this one.
import { getSiteSettingsWithCacheHint } from 'emdash';
import { himlio } from './himlio';

type CacheHint = Awaited<ReturnType<typeof getSiteSettingsWithCacheHint>>['cacheHint'];

/**
 * Pass `Astro.cache` so cached pages are purged when the site settings change.
 */
export async function siteDescription(cache?: {
  enabled?: boolean;
  set(hint: CacheHint): void;
}): Promise<string | undefined> {
  const { data, cacheHint } = await getSiteSettingsWithCacheHint();
  if (cache?.enabled) cache.set(cacheHint);
  return data.tagline?.trim() || himlio.description;
}
