// The site's Astro config. defineHimlioConfig() adds the platform: EmDash, Cloudflare, sessions,
// email, the Worker and the build artifact, all from himlio.json. The rest is from EmDash's
// marketing template (templates/marketing-cloudflare): Phosphor icons and native light-dark().
import { defineHimlioConfig } from "@himlio/site";
import icon from "astro-iconset";
import { Features } from "lightningcss";

export default defineHimlioConfig({
	// The site's own content-model migrations (Himlio): sections added after a site was made.
	himlio: { modelMigrations: "src/model-migrations" },
	vite: {
		css: {
			// Keep light-dark() native so the footer theme switcher works in
			// production. Browsers without light-dark() get the light fallback in
			// tokens.css.
			lightningcss: { exclude: Features.LightDark },
		},
		ssr: {
			optimizeDeps: {
				// Pre-bundle so it isn't discovered mid-render, which would trigger
				// a Vite dep re-optimization under the Cloudflare dev runner.
				include: ["astro-iconset/components"],
			},
		},
	},
	integrations: [
		icon({
			// Only ship the Phosphor icons used in templates, not the whole set.
			include: {
				ph: [
					"arrow-right",
					"bell-simple",
					"buildings",
					"chart-bar",
					"chat-circle",
					"check",
					"check-circle",
					"clock",
					"cloud",
					"code",
					"currency-dollar",
					"envelope",
					"file-text",
					"gauge",
					"globe",
					"heart",
					"leaf",
					"lifebuoy",
					"lightning",
					"list",
					"lock",
					"map-pin",
					"pause",
					"phone",
					"play",
					"plug",
					"plus",
					"shield-check",
					"sparkle",
					"star",
					"sun",
					"thermometer-simple",
					"trend-up",
					"users-three",
					"x",
				],
			},
		}),
	],
});
