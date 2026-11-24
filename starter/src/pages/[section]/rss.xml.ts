// The News feed (RSS 2.0) at /news/rss.xml (/nyheter/rss.xml on a Swedish site): the 20 newest
// posts with title, link, date and excerpt.
import type { APIRoute } from "astro";
import { getEmDashCollection, getSiteSettings } from "@himlio/site/emdash";
import { himlio } from "@himlio/site/runtime";
import { feedPath, postPath } from "../../utils/posts";
import { t } from "../../utils/strings";

const escape = (text: string) =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");

export const GET: APIRoute = async ({ params, url }) => {
	if (params.section !== t.newsPath) return new Response("Not found", { status: 404 });
	const [settings, { entries }] = await Promise.all([
		getSiteSettings(),
		getEmDashCollection("posts", { limit: 20, orderBy: { published_at: "desc" } }),
	]);
	const origin = (himlio.url ?? settings.url ?? url.origin).replace(/\/$/, "");
	const siteTitle = settings.title || himlio.name;
	const items = entries.map((post) => {
		const link = `${origin}${postPath(post.id)}`;
		return [
			"<item>",
			`<title>${escape(post.data.title)}</title>`,
			`<link>${escape(link)}</link>`,
			`<guid isPermaLink="true">${escape(link)}</guid>`,
			post.data.publishedAt ? `<pubDate>${post.data.publishedAt.toUTCString()}</pubDate>` : "",
			post.data.excerpt ? `<description>${escape(post.data.excerpt)}</description>` : "",
			"</item>",
		].join("");
	});
	const xml = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
		"<channel>",
		`<title>${escape(`${t.news} – ${siteTitle}`)}</title>`,
		`<link>${escape(origin)}/</link>`,
		`<description>${escape(settings.tagline || siteTitle)}</description>`,
		`<language>${escape(himlio.locale)}</language>`,
		`<atom:link href="${escape(origin + feedPath())}" rel="self" type="application/rss+xml"/>`,
		...items,
		"</channel>",
		"</rss>",
	].join("\n");
	return new Response(xml, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=600",
		},
	});
};
