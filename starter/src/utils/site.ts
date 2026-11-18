import { himlio } from "@himlio/site/runtime";
import type { SiteSettings } from "@himlio/site/emdash";

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
