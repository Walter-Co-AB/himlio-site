# AGENTS.md

Rules for AI coding tools (Claude Code, Codex, Cursor, Copilot and others) and for people
working on this site. The site runs on Himlio, the website platform from Walter & Co AB.

## Stack

- [EmDash](https://github.com/emdash-cms/emdash) (an Astro CMS) on Cloudflare Workers for
  Platforms, through the package **`@himlio/site`**. It brings EmDash, the Cloudflare adapter,
  sessions, email, the Worker, the content model's platform part and the build. Its README
  (`node_modules/@himlio/site/README.md`) documents everything it offers.
- This repo holds the site's own code: design, pages, components and, if needed, its own API
  routes, tables, crons and content model. It was created from the Himlio starter once and is
  never synced; the platform reaches it only as `@himlio/site` version updates.
- Import EmDash through the package: `@himlio/site/emdash`, `@himlio/site/emdash/ui`, `/page`
  and `/runtime`, never `emdash` directly, so the site uses the EmDash version the platform pins.
- Admin at `/_emdash/admin`, in English (like EmDash, its plugins and the code). Content and
  users in D1 (`DB`), media in R2 (`MEDIA`).
- Swedish first on the site: `sv` is the site language. Write the site's interface text and content
  in Swedish.

## What's where

| What                                                                      | Where                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content                                                                   | In the admin. Pages are in `pages`: each page is a list of sections (EmDash block types); the home page is the page with slug `home`.                                                                                                                                                                                                 |
| Forms                                                                     | In the admin under Forms (submissions too). Place one on a page in a Contact form section (`marketing_form`, the form's slug), or as a Form block in a Text section; outside content, `<Form id="slug" />` from `@himlio/site/forms`. Styled in `src/styles/forms.css`.                                                               |
| Booking                                                                   | In the admin under Booking (services with prices, staff and resources, opening hours, bookings and requests). Place it on a page in a Booking section (`marketing_booking`), or as a Booking block in a Text section; outside content, `<Booking />` from `@himlio/site/booking`. Picked date/time colours in `src/styles/forms.css`. |
| Site description                                                          | In the admin: Settings → General → Tagline. Read it with `siteDescription()`.                                                                                                                                                                                                                                                         |
| Contact details                                                           | In the admin: the one entry in Company details (`company`). Read them with `contactDetails()`.                                                                                                                                                                                                                                        |
| Design                                                                    | **Read `node_modules/@himlio/site/docs/design.md` first.** `src/styles/theme.css` (tokens; defaults in `tokens.css`), `src/styles/global.css` (shared building blocks), `src/components/blocks/` (one component per block type), `Header.astro`, `Footer.astro`, `src/layouts/Base.astro`, `public/`                                  |
| Pages                                                                     | `src/pages/`                                                                                                                                                                                                                                                                                                                          |
| Astro config                                                              | `astro.config.mjs`: the site's integrations and options, in `defineHimlioConfig()`                                                                                                                                                                                                                                                    |
| Own middleware, API routes, tables, crons, content model, Durable Objects | See "Extension points" in the `@himlio/site` README. Tables: `migrations/0100_*.sql` and up.                                                                                                                                                                                                                                          |
| Platform facts                                                            | `himlio.json`: slug, name, locale, URL, email sender, form recipients. Written by the platform (Terraform) and overwritten on every apply; never edit it.                                                                                                                                                                             |
| CI                                                                        | `.github/workflows/ci.yml` calls the platform's build workflow. Keep its version equal to `@himlio/site` in `package.json`.                                                                                                                                                                                                           |

## Build it the EmDash way

This site started from EmDash's marketing template (`templates/marketing-cloudflare` in
[emdash-cms/emdash](https://github.com/emdash-cms/emdash)) on `@himlio/site`. It is this site's
own code now: change it as much as the design needs. The design guide,
`node_modules/@himlio/site/docs/design.md`, says how. In short:

- **The content model is the contract, the design is free.** A page's `content` is a list of
  block types (`marketing_hero`, `marketing_features`, `marketing_text`, ...) that customers and
  their AI connector edit. Restyle or rewrite any section component, header or footer freely;
  never put copy in `.astro` files.
- **Same content, different look: a variant field.** Add a `layout` select to the block type with
  `addBlockFields` in a content-model migration (the Hero's `layout` is an example; see
  `0003_hero_layout.json`).
- **Different content: a new block type**, with a component in `src/components/blocks/`
  registered in `blocks/index.ts` and `MarketingBlocks.astro`, the block type added through a
  migration in `src/model-migrations/` (`blockTypes`, plus `allowBlockTypes` to allow it in
  `pages.content`; see `0002_booking_section.json`), in `seed/seed.json` and in
  `emdash-env.d.ts`.
- **Look at every section after a change:** `npm run fixtures` makes the block gallery
  (`/block-gallery`), every section type with all fields, only the required ones and each variant.
- **Style through tokens.** Change `theme.css` (it overrides `tokens.css`); keep component CSS
  on the tokens. Colours use `light-dark()` for dark mode.
- **Don't port other themes** (AstroWind, AstroDeck and the like) into a Himlio site; they put
  content in code. Take the look, rebuild it with these blocks and tokens.
- **Look it up before inventing a pattern:** EmDash's docs MCP (`https://docs.emdashcms.com/mcp`,
  set up in `.mcp.json`) and EmDash's agent skills and templates.

## Rules

1. **`npm run verify` must pass** before you commit (format, type check, build).
2. **Work on a branch.** A push to `main` is released automatically once CI is green. Look at
   the **screenshots** artifact on every pull request before merging a design change.
3. **No secrets in git.** Customers may have write access to this repo. Never write keys,
   tokens or passwords into code or config. `.dev.vars` is for local values and is ignored.
4. **Only the bindings the platform provides** (`DB`, `MEDIA`, `EMAIL`, `HIMLIO_SLUG`) plus what
   `defineHimlioConfig({ himlio: ... })` declares. No KV, queues or service bindings; the build
   fails on them. Ask Walter & Co if you need one.
5. **Parameterised SQL only.** `env.DB.prepare('... WHERE id = ?').bind(id)`.
6. **Migrations are append-only**, D1 and content model alike. Never edit one that has been
   released.
7. **Every route needs a decision about access.** Public endpoints need input validation with
   length limits and abuse protection. Anything non-public must check the EmDash session.
8. **Privacy (GDPR).** No third-party fonts, analytics, trackers or embeds without asking.
   Fonts are self-hosted via `@fontsource` (not Astro's Google font provider): import them in
   `Base.astro`, name them in `theme.css`. Store only the personal data a feature needs.
9. **Honest content.** No invented text, testimonials, customers or numbers. The template's
   testimonials, pricing, logos and stats blocks are for the customer's real ones only.
10. **Keep it simple.** Prefer plain Astro and CSS. Ask before adding a framework or library.
11. **Platform changes go to `@himlio/site`**, not into this repo. Don't copy platform code
    here to change it; ask for an extension point or a fix in `Walter-Co-AB/himlio-site`.

## Changing content over an AI connector (MCP)

When you change a **published** item with `content_update` (contact details, a page), pass
`status: "published"` or call `content_publish` afterwards. Otherwise the change can stay a
draft and not show on the site. The contact details are the one entry `foretagsuppgifter` in
`company`: `content_get` it, then `content_update` with its `_rev`. Connectors can also change
the content model, the site settings (not the site URL) and forms, and read form submissions;
see "AI connectors" in the `@himlio/site` README for what they can and can't do.

## Working alongside other agents

- **Your dev server, your port.** `npm run dev` uses this site's fixed port (`npx himlio-site
port`) and fails if it is taken; find out who holds it rather than changing it. Before sending
  requests to a local server, check it is yours (`npx astro dev status`). Never send requests,
  especially writes, to a server you didn't start.
- **Stay in your own checkout.** Run git only in this repo. Merge with
  `gh pr merge <n> -R <owner>/<repo> --squash`; `--delete-branch` only from your own checkout.
- **Hand over with commit hashes** when you ask another agent to review or sync something.

## Commands

```sh
npm install
npm run dev            # this site's port, admin at /_emdash/admin
npm run verify         # format, type check, build (what CI runs)
npm run fixtures       # sample content on the local dev server (-- --empty for the empty state)
npm run screenshots    # screenshots of the local dev server into screenshots/
```
