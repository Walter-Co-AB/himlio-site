// News: the platform's posts collection (model-migrations/0005_news.json) has URLs in the site's
// language. The site shows posts in its own design (a News section, a post page at
// /<newsPath()>/<slug>); the platform serves the RSS feed at /<newsPath()>/rss.xml from its
// middleware, so every site has it.
//
//   import { newsPath, postPath, feedPath } from '@himlio/site/runtime';
//   postPath('opening-hours')  → "/nyheter/opening-hours" on a Swedish site
import { getEmDashCollection, getSiteSettings } from 'emdash';
import { facts } from 'virtual:himlio/config';
import { newsPathFor } from '../news.js';
import { localized } from './localized.js';

/** The News path segment in the site's language: "news", or "nyheter" on a Swedish site. */
export const newsPath = (): string => newsPathFor(facts.locale);

/** A post's URL path. */
export const postPath = (slug: string): string => `/${newsPath()}/${encodeURIComponent(slug)}`;

/** The feed's URL path, e.g. "/nyheter/rss.xml". */
export const feedPath = (): string => `/${newsPath()}/rss.xml`;

export const isNewsFeed = (url: URL): boolean => url.pathname === feedPath();

const FEED_SIZE = 20;

const escape = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** The feed (RSS 2.0): the newest posts with title, link, date and excerpt. */
export async function newsFeed(url: URL): Promise<Response> {
  const [settings, { entries, error }] = await Promise.all([
    getSiteSettings(),
    getEmDashCollection('posts', { limit: FEED_SIZE, orderBy: { published_at: 'desc' } }),
  ]);
  if (error) return new Response('Not found', { status: 404 });
  const origin = (facts.url ?? settings.url ?? url.origin).replace(/\/$/, '');
  const siteTitle = settings.title || facts.name;
  const news = localized({ en: 'News', sv: 'Nyheter' }, facts.locale);
  const items = entries.map((post) => {
    const data = post.data as {
      title?: string;
      excerpt?: string | null;
      publishedAt?: Date | null;
    };
    const link = `${origin}${postPath(post.id)}`;
    return [
      '<item>',
      `<title>${escape(data.title ?? '')}</title>`,
      `<link>${escape(link)}</link>`,
      `<guid isPermaLink="true">${escape(link)}</guid>`,
      data.publishedAt ? `<pubDate>${data.publishedAt.toUTCString()}</pubDate>` : '',
      data.excerpt ? `<description>${escape(data.excerpt)}</description>` : '',
      '</item>',
    ].join('');
  });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${escape(`${news} – ${siteTitle}`)}</title>`,
    `<link>${escape(origin)}/</link>`,
    `<description>${escape(settings.tagline || siteTitle)}</description>`,
    `<language>${escape(facts.locale)}</language>`,
    `<atom:link href="${escape(origin + feedPath())}" rel="self" type="application/rss+xml"/>`,
    ...items,
    '</channel>',
    '</rss>',
  ].join('\n');
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
}
