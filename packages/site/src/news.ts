// News URLs in the site's language: posts at /news/<slug> (/nyheter/<slug>), the feed at
// /news/rss.xml. The platform's News collection (model-migrations/0005_news.json) has the same
// paths as its urlPattern; a test keeps them equal. Node-safe (no Worker imports).
import { patternLanguage } from './model-locale.js';

export const NEWS_PATHS: Record<string, string> & { en: string } = {
  en: 'news',
  sv: 'nyheter',
};

/** The News path segment for a locale ("sv-SE" → "nyheter"; unknown languages → "news"). */
export function newsPathFor(locale: string): string {
  return NEWS_PATHS[patternLanguage(locale)] ?? NEWS_PATHS.en;
}
