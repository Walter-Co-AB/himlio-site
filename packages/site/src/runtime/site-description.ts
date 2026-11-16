// The site's description: the Tagline the customer sets in the admin (Settings → General; the
// setup wizard also asks for it). Without one there is no site-wide description: pages show no
// lead and leave out the meta description rather than repeat the site name. Per-page SEO
// descriptions are set on each page and win over this one.
//
// EmDash 1.5 has no separate site-wide SEO description: its SEO settings only hold the title
// separator, default image, robots.txt and verification codes.
import { getSiteSettingsWithCacheHint } from 'emdash';

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
  return data.tagline?.trim() || undefined;
}
