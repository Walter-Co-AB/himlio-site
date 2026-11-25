import { himlio, siteLanguage } from "@himlio/site/runtime";

// Post and feed URLs come from the platform, in the site's language (/news or /nyheter).
export { feedPath, newsPath, postPath } from "@himlio/site/runtime";

const dateFormat = new Intl.DateTimeFormat(himlio.locale || siteLanguage(), {
	dateStyle: "long",
});

/** A post's date in the site's language, e.g. "24 november 2026". */
export const formatDate = (date: Date) => dateFormat.format(date);
