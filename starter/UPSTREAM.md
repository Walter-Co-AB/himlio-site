# Upstream

This starter is EmDash's marketing template, adapted to Himlio.

- Source: [emdash-cms/emdash](https://github.com/emdash-cms/emdash), `templates/marketing-cloudflare`
- Version: `emdash@1.5.0` (commit `549c6b5b501da1088dfcb38de65ea87b7dd8b7ba`), the EmDash version
  `@himlio/site` pins. MIT.

## What Himlio changed

This file is for maintaining the starter in `Walter-Co-AB/himlio-site`. A site made from it owns
its copy and changes it freely (see AGENTS.md); it is never synced.

Apart from the changes below, `src/` matches upstream, so EmDash's template updates can be
compared with `diff` and applied. To compare, map the imports back first:
`sed -E 's#@himlio/site/(emdash[^"]*)#\1#'`. Upstream's `src/layouts/Base.astro` is split here
into `Base.astro`, `src/components/Header.astro`, `src/components/Footer.astro` and
`src/styles/global.css`; compare those against the matching parts of upstream's file (the
header markup and menu script, the footer markup and theme script, `<style is:global>`, and the
scoped `<style>` split between header and footer). Himlio's own changes in them are marked
`(Himlio)` or `Himlio:` in comments.

| File                                                                                                                   | Change                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `astro.config.mjs`                                                                                                     | `defineHimlioConfig()` instead of EmDash, adapter and Wrangler setup; the icon integration and Vite settings as upstream; no `fonts` (no Google).                                                                                                                                                                          |
| `src/**` (imports)                                                                                                     | `emdash`, `emdash/ui`, `emdash/page`, `emdash/runtime` → `@himlio/site/emdash...`                                                                                                                                                                                                                                          |
| `src/layouts/Base.astro`                                                                                               | Fonts from `@fontsource` instead of `<Font>`; `lang` from `himlio.json`; Swedish interface text; a "Kontakt" footer column from the admin's Company details (`contactDetails()`); imports `forms.css`. Split into `Base.astro`, `Header.astro`, `Footer.astro` and `src/styles/global.css` (same markup, scripts and CSS). |
| `src/utils/site.ts`                                                                                                    | The site name from `himlio.json`.                                                                                                                                                                                                                                                                                          |
| `src/styles/theme.css`                                                                                                 | `--font-body` and `--font-display` for the self-hosted fonts.                                                                                                                                                                                                                                                              |
| `src/pages/index.astro`, `404.astro`, `src/components/PageView.astro`, `blocks/Pricing.astro`, `blocks/Logos.astro`    | Swedish text; the 404 page has no link to a contact page.                                                                                                                                                                                                                                                                  |
| `src/components/blocks/ContactForm.astro` (new), `MarketingBlocks.astro`, `blocks/index.ts`                            | A "Contact form" section (`marketing_form`): a form from Forms with an optional side column.                                                                                                                                                                                                                               |
| `src/components/blocks/BookingSection.astro` (new), `MarketingBlocks.astro`, `blocks/index.ts`, `src/styles/forms.css` | A "Booking" section (`marketing_booking`): @himlio/site's booking form with a headline and optional address and opening hours.                                                                                                                                                                                             |
| `src/model-migrations/` (new), `astro.config.mjs`                                                                      | The site's content-model migrations; `0001` adds `marketing_form`, `0002` `marketing_booking` and `0003` the Hero's `layout`, for sites made before them.                                                                                                                                                                  |
| `src/components/blocks/Hero.astro`, `seed/seed.json`, `emdash-env.d.ts`                                                | A `layout` field on the Hero: `standard` (upstream) or `cover`, the text over a full-bleed image like the photo call to action.                                                                                                                                                                                            |
| `src/styles/global.css` (headings), `blocks/Pricing.astro` (`.plan__badge`)                                            | Long words in headings hyphenate or break instead of overflowing (`hyphens: auto`, `overflow-wrap: anywhere`); a long plan badge wraps instead of widening the page.                                                                                                                                                       |
| `src/styles/forms.css` (new)                                                                                           | Styles for forms from the Forms plugin (`.ec-form`), on the template's tokens.                                                                                                                                                                                                                                             |
| `seed/seed.json`                                                                                                       | Upstream block types plus `marketing_form` and `marketing_booking`, and the `pages` model; no sample content, settings or demo menus (honest content).                                                                                                                                                                     |
| Removed                                                                                                                | `wrangler.jsonc`, `src/worker.ts`, `worker-configuration.d.ts` (in `@himlio/site`).                                                                                                                                                                                                                                        |

## Updating from upstream

1. Diff `templates/marketing-cloudflare` between the old and the new EmDash tag.
2. Apply the changes here, keeping the Himlio changes above.
3. New or changed block types reach existing sites only through a content-model migration
   (`himlio({ modelMigrations })`); update `seed/seed.json` for new sites as well.
