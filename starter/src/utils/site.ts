import { himlio } from "@himlio/site/runtime";
import type { getMenuWithCacheHint, SiteSettings } from "@himlio/site/emdash";

const DEFAULT_TITLE_SEPARATOR = "—";

/**
 * Site identity. The name is the company name from himlio.json (the platform's);
 * the tagline, logo and separator come from the admin's settings.
 */
export function resolveSiteIdentity(settings: Partial<SiteSettings> | undefined) {
	return {
		siteTitle: himlio.name || settings?.title?.trim() || "",
		siteTagline: settings?.tagline?.trim() ?? "",
		siteLogo: settings?.logo?.url ? settings.logo : null,
		titleSeparator: settings?.seo?.titleSeparator?.trim() || DEFAULT_TITLE_SEPARATOR,
	};
}

/** The site logo from the admin's settings, or null (Himlio). */
export type SiteLogo = ReturnType<typeof resolveSiteIdentity>["siteLogo"];

/** One item of a menu from the admin (Himlio). */
export type MenuItem = NonNullable<
	Awaited<ReturnType<typeof getMenuWithCacheHint>>["data"]
>["items"][number];
