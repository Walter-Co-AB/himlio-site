import { localized } from "@himlio/site/runtime";

/**
 * Interface text visitors read that isn't content: one object per language, picked by the
 * site's `locale` in himlio.json (Himlio). The code is English; add a language by adding an
 * object with the same keys. Content (headlines, menus, contact details) comes from the admin.
 */
export const t = localized({
	en: {
		skipToContent: "Skip to content",
		menu: "Menu",
		mainMenu: "Main menu",
		contact: "Contact",
		orgNumber: "Company reg. no.",
		allRightsReserved: "All rights reserved.",
		poweredBy: "Powered by",
		theme: "Theme",
		light: "Light",
		lightMode: "Light mode",
		dark: "Dark",
		darkMode: "Dark mode",
		system: "System",
		followSystem: "Follow the system",
		notFoundTitle: "Page not found",
		notFoundText: "The page you are looking for doesn't exist, or has moved.",
		toHomePage: "Go to the home page",
		popularPlan: "Most popular",
		pauseLogos: "Pause the logo animation",
		followUs: "Follow us",
		privacyPolicy: "Privacy policy",
	},
	sv: {
		skipToContent: "Hoppa till innehållet",
		menu: "Meny",
		mainMenu: "Huvudmeny",
		contact: "Kontakt",
		orgNumber: "Org.nr",
		allRightsReserved: "Alla rättigheter förbehållna.",
		poweredBy: "Drivs med",
		theme: "Tema",
		light: "Ljust",
		lightMode: "Ljust läge",
		dark: "Mörkt",
		darkMode: "Mörkt läge",
		system: "System",
		followSystem: "Följ systemet",
		notFoundTitle: "Sidan finns inte",
		notFoundText: "Sidan du letar efter finns inte, eller har flyttats.",
		toHomePage: "Till startsidan",
		popularPlan: "Populärast",
		pauseLogos: "Pausa logotypernas animation",
		followUs: "Följ oss",
		privacyPolicy: "Integritetspolicy",
	},
});
