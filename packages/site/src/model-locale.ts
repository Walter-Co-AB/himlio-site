// Content-model migrations may give a collection's `urlPattern` per language, so the URLs are in
// the site's language: { "en": "/news/{slug}", "sv": "/nyheter/{slug}" }. Before the seed is
// validated and applied, each such object becomes the pattern for the site's locale ("sv-SE" →
// "sv"), or "en" when the language has none. Shared by the build's check (config.ts) and the
// runner (runtime/model-migrations.ts).

export function patternLanguage(locale: string): string {
  return locale.toLowerCase().split(/[-_]/)[0] || 'en';
}

/** The seed with every localized `urlPattern` resolved for `locale`. Other values are kept. */
export function localizeSeed<T>(seed: T, locale: string): T {
  const collections = (seed as { collections?: unknown }).collections;
  if (!Array.isArray(collections)) return seed;
  const lang = patternLanguage(locale);
  return {
    ...seed,
    collections: collections.map((collection) => {
      const pattern = (collection as { urlPattern?: unknown }).urlPattern;
      if (typeof pattern !== 'object' || pattern === null) return collection;
      const byLang = pattern as Record<string, unknown>;
      if (typeof byLang.en !== 'string')
        throw new Error(
          `collection ${(collection as { slug?: string }).slug}: a urlPattern per language needs "en"`
        );
      const chosen = typeof byLang[lang] === 'string' ? byLang[lang] : byLang.en;
      return { ...collection, urlPattern: chosen };
    }),
  };
}
