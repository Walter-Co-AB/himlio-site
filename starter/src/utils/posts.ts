import { himlio, siteLanguage } from "@himlio/site/runtime";
import { t } from "./strings";

/** A post's URL. The prefix is `newsPath`, which matches the collection's `urlPattern`. */
export const postPath = (slug: string) => `/${t.newsPath}/${encodeURIComponent(slug)}`;

/** The feed's URL, e.g. /nyheter/rss.xml. */
export const feedPath = () => `/${t.newsPath}/rss.xml`;

const dateFormat = new Intl.DateTimeFormat(himlio.locale || siteLanguage(), {
	dateStyle: "long",
});

/** A post's date in the site's language, e.g. "24 november 2026". */
export const formatDate = (date: Date) => dateFormat.format(date);
