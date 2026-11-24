// Interface text in the site's language. A site's code is English; the few words visitors read
// that aren't content (a menu button, "Skip to content", the 404 page) come from one object per
// language, and the site's `locale` in himlio.json picks one:
//
//   const t = localized({
//     en: { menu: 'Menu' },
//     sv: { menu: 'Meny' },
//   });
//   <button aria-label={t.menu}>
//
// "sv" and "sv-SE" both pick `sv`; a language without its own object gets `en`.
import { himlio } from './himlio.js';

/** The language part of a locale: "sv-SE" → "sv". */
export const siteLanguage = (locale: string = himlio.locale) =>
  locale.toLowerCase().split(/[-_]/)[0] || 'en';

export function localized<T>(texts: { en: T } & Record<string, T>, locale?: string): T {
  return texts[siteLanguage(locale)] ?? texts.en;
}
