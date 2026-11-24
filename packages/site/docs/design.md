# Designing a Himlio site

How to make a Himlio site look exactly the way the customer wants, any look, while it stays a
site the customer (and their AI connector) can edit in EmDash. For AI agents and people working
in a `site-*` repo. Shipped in `@himlio/site` (`node_modules/@himlio/site/docs/design.md`), so it
updates with the package.

## The one rule: the content model is the contract, the design is free

What the customer edits is fixed: the **block types** (sections) and their **fields**, the menus,
the settings and the company details. Everything that only decides how that content looks is
yours to change, completely.

| Layer                                 | Where                                                       | Freedom                                                                        |
| ------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Tokens                                | `src/styles/theme.css` (defaults in `tokens.css`)           | Full. Colours (light and dark), fonts, type scale, spacing, radii, shadows     |
| Building blocks                       | `src/styles/global.css`                                     | Full. Reset, layout (`.container`, `.sheet`), type, buttons, cards, motion     |
| Section components                    | `src/components/blocks/*.astro`                             | **Full rewrite allowed**: any markup, any CSS, as long as it renders the block |
| Header, footer, page frame            | `src/components/Header.astro`, `Footer.astro`, `Base.astro` | Full. Menus, logo, tagline and contact details still come from the admin       |
| Forms and booking                     | `src/styles/forms.css`                                      | Full, through their classes and variables                                      |
| Block types and fields (the contract) | `src/model-migrations/`, `seed/seed.json`                   | Only through a migration (below)                                               |

So a section component may look nothing like the template's, and that is fine. What is not fine:

- **Copy in code.** Every visible text comes from a field, a menu, the settings or the company
  details. A heading the customer can't change is a bug. (Interface words such as "Meny" or
  "Hoppa till innehållet" are code; they are the same on every page.)
- **A section the customer can't rebuild.** If the design shows something on a page, the
  customer must be able to make it again, or remove it, from the admin.
- **Porting a theme.** Don't copy AstroWind, AstroDeck or a Tailwind template into the repo;
  they put content in code. Take the look and rebuild it here.

## Workflow

1. **Collect the reference.** Figma, screenshots, the customer's current site, a brand guide.
   Note what is fixed (logo, brand colours, fonts) and what is a wish ("lighter", "like X").
2. **Extract the tokens first.** Colours for light and dark mode, fonts, type scale, spacing,
   radii, shadows, motion. Put them in `theme.css`. Many designs are 80% done here.
3. **Map the design to sections.** List every section in the reference and decide for each, in
   this order:
   1. an existing block type as it is (restyled freely);
   2. an existing block type with a **variant field** (a `layout` select, see below);
   3. a **new block type**, only when the content is different, not just its look.
4. **Build from the bottom up:** tokens → building blocks in `global.css` → section components →
   header and footer. Change a building block once rather than overriding it per section.
5. **Check it against the reference** with the block gallery and screenshots (below), in light
   and dark mode, desktop and mobile, until it matches.
6. **Check the content cases**, not only the happy path: empty optional fields, one item and
   twelve, long Swedish words, a missing image.

## Variants: one block type, several looks

When the customer wants the same kind of section to look different on different pages (a hero
with the photo below the text on one page and behind it on another), add a **select field** to
the block type rather than a new block type. The starter's Hero has one: `layout`, `standard` or
`cover` (`src/components/blocks/Hero.astro`).

1. **Migration** (`src/model-migrations/NNNN_name.json`). `addBlockFields` adds optional fields
   to an existing block type on every site that has it, new or deployed:

   ```json
   {
     "version": "1",
     "addBlockFields": [
       {
         "blockType": "marketing_split",
         "fields": [
           {
             "slug": "layout",
             "label": "Layout (Wide: the image fills half the page)",
             "type": "select",
             "defaultValue": "standard",
             "validation": { "options": ["standard", "wide"] }
           }
         ]
       }
     ]
   }
   ```

   Added fields must be optional; content made before has no value, so treat a missing value as
   the first option. A field the block type has already is left alone.

2. **Seed:** add the same field to the block type in `seed/seed.json`, for the next database
   made from it (local dev, previews).
3. **Types:** add it to the block's interface in `emdash-env.d.ts`
   (`"layout"?: "standard" | "wide" | null;`).
4. **Component:** read it, `const wide = value.layout === "wide";`, and switch classes.

Name options for what the customer sees ("cover", "wide", "dark"), and describe each in the
label, since the label is all the admin shows. Keep a variant meaningful with the content the
customer can enter (a `cover` hero without an image falls back to `standard`).

**A new block type** is for content that is different: its own fields. Add it with `blockTypes`
and `allowBlockTypes` in a migration, a component in `src/components/blocks/`, registered in
`blocks/index.ts` and `MarketingBlocks.astro`, the seed and the types (see the starter's
`0002_booking_section.json` and `BookingSection.astro`). Extension points are in the
`@himlio/site` README.

## Astro, the Himlio way

- **No JavaScript by default.** Sections are server-rendered HTML and CSS. A `<script>` (bundled
  by Astro) only adds to something that already works without it: a menu, a carousel's buttons,
  a reveal on scroll. No UI frameworks or islands (React, Vue, Svelte) without asking Walter &
  Co; no Astro `ClientRouter`.
- **Scoped styles.** Each component has its own `<style>`; use `:global()` only for markup you
  don't render yourself (EmDash's `<Image>`, portable text). Shared patterns go in `global.css`.
- **Tokens, not literals.** Component CSS uses `var(--...)`. A colour that appears once is still
  a token if it belongs to the brand.
- **Modern CSS is fine:** nesting, `:has()`, container queries (`container-type: inline-size` on
  a section, so a block adapts to its own width), `clamp()` for fluid type, logical properties
  (`margin-inline`, `inset-block`), `text-wrap: balance`, `light-dark()`.
- **Dark mode.** Colours use `light-dark(<light>, <dark>)` and the footer's theme switcher sets
  it. If the customer wants one mode only, set `color-scheme` in `theme.css` and remove the
  switcher from `Footer.astro`; don't leave a switcher that does nothing.
- **Images.** Content images (photos the customer may change) are image fields, shown with
  EmDash's `<Image>` from `@himlio/site/emdash/ui`, with `sizes` that match the layout and
  `priority` only above the fold. Graphics that are part of the design (patterns, shapes,
  textures, illustrations) belong to the code: `src/assets/` with `astro:assets`, or inline SVG.
  The logo comes from the admin (Settings → Logo).
- **Fonts** are self-hosted: an `@fontsource` package imported in `Base.astro` and named in
  `theme.css`. A brand font that isn't on Fontsource goes in `public/fonts/` as WOFF2 with an
  `@font-face` in `theme.css`, if its licence allows web use. Never Google Fonts or another
  third party (privacy). Load only the weights you use.
- **Icons** come from `astro-iconset` (Phosphor); only the icons listed in `astro.config.mjs`
  are shipped, so add new ones there. An icon the customer picks is a select field whose options
  map to icon names in the component.
- **Motion** respects `prefers-reduced-motion` (the base styles turn it off); animate
  `transform` and `opacity`; content must be readable before any animation runs.
- **Swedish text is long.** Compound words (`hårvårdsspecialistkonsultationer`) don't fit narrow
  columns. Headings hyphenate (`hyphens: auto`; the page is `lang="sv"`) and break as a last
  resort (`overflow-wrap: anywhere`); do the same for any big text you add, and never set
  `white-space: nowrap` on text the customer writes.
- **Accessibility:** one `h1` per page, headings in order,
  contrast at least 4.5:1 for text (3:1 for large text and UI) in both modes, visible focus,
  44 px touch targets, alt text from the image field.

## Seeing it: the block gallery

```sh
npm run dev
npm run fixtures       # sample content, including /block-gallery (and -2, -3, ...)
npm run screenshots    # light, dark and mobile, into screenshots/
```

`fixtures` builds the **block gallery** from the site's live content model, so your own block
types and variants are in it: every section type the pages allow, once with every field filled
(long Swedish text, three repeater items, a sample image), once with only the required fields,
and once per option of each select field. One look at `/block-gallery` after a token change
shows every section, its empty state and its variants. CI's **screenshots** artifact has the
same pages; look at it before merging a design change.

Things to look for: the page scrolls sideways (something overflows), text on images is hard to
read, a section without its optional fields looks broken, dark mode has a light-only colour,
two sections next to each other have doubled or missing space.

## Done means

- [ ] Matches the reference at 390 and 1280 px, light and dark (or one mode, on purpose).
- [ ] Every section in the gallery works with all fields, with only the required ones, and in
      each variant. No horizontal scroll at 390 px.
- [ ] Every visible text is editable in the admin; nothing in the design depends on copy.
- [ ] Forms and booking look like the rest of the site (`forms.css`).
- [ ] Contrast and focus checked; reduced motion respected.
- [ ] No third-party requests (fonts, scripts, images) without the customer's consent.
- [ ] `npm run verify` passes; the screenshots artifact looks right.
