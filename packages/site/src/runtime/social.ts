// The company's social media profiles, from EmDash's site settings (admin: Settings → Social).
// Each value may be a username ("walterco", "@walterco") or a full profile URL; both become a
// link. Used by the site's footer and by the business info for search engines (sameAs).
import { getSiteSettingsWithCacheHint } from 'emdash';

export interface SocialLink {
  network: SocialNetwork;
  /** The network's name, e.g. "Instagram". */
  label: string;
  url: string;
}

export type SocialNetwork =
  'instagram' | 'facebook' | 'linkedin' | 'youtube' | 'twitter' | 'github';

const NETWORKS: Record<SocialNetwork, { label: string; profile: (user: string) => string }> = {
  instagram: { label: 'Instagram', profile: (u) => `https://www.instagram.com/${u}/` },
  facebook: { label: 'Facebook', profile: (u) => `https://www.facebook.com/${u}` },
  linkedin: { label: 'LinkedIn', profile: (u) => `https://www.linkedin.com/in/${u}/` },
  youtube: { label: 'YouTube', profile: (u) => `https://www.youtube.com/@${u}` },
  twitter: { label: 'X', profile: (u) => `https://x.com/${u}` },
  github: { label: 'GitHub', profile: (u) => `https://github.com/${u}` },
};

const USERNAME = /^[\p{L}\p{N}._-]{1,100}$/u;

/** One setting value as a profile URL, or undefined if it is neither a URL nor a username. */
export function socialUrl(network: SocialNetwork, value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) {
    try {
      const url = new URL(v);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
    } catch {
      return undefined;
    }
  }
  const user = v.replace(/^@/, '');
  return USERNAME.test(user) ? NETWORKS[network].profile(user) : undefined;
}

/** The links for EmDash's `social` setting, in a fixed order; empty ones are left out. */
export function socialLinksFrom(social: Partial<Record<string, string>> | undefined): SocialLink[] {
  const links: SocialLink[] = [];
  for (const network of Object.keys(NETWORKS) as SocialNetwork[]) {
    const value = social?.[network];
    const url = typeof value === 'string' ? socialUrl(network, value) : undefined;
    if (url) links.push({ network, label: NETWORKS[network].label, url });
  }
  return links;
}

type CacheHint = Awaited<ReturnType<typeof getSiteSettingsWithCacheHint>>['cacheHint'];

/**
 * The company's social media links. Pass `Astro.cache` so cached pages are purged when the
 * settings change.
 */
export async function socialLinks(cache?: {
  enabled?: boolean;
  set(hint: CacheHint): void;
}): Promise<SocialLink[]> {
  const { data, cacheHint } = await getSiteSettingsWithCacheHint();
  if (cache?.enabled) cache.set(cacheHint);
  return socialLinksFrom(data.social);
}
