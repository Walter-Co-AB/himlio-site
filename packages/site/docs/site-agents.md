# Working on a Himlio site

Rules for AI coding tools (Claude Code, Codex, Cursor, Copilot and others) and for people working
on a Himlio site, the website platform from Walter & Co AB. They ship with `@himlio/site`
(`node_modules/@himlio/site/docs/site-agents.md`) and update with it; the site's own `AGENTS.md`
points here and adds notes that only apply to that site. Where the two differ, the site's notes
win for that site.

Paths below are those of sites made from the Himlio starter; an older site may have its files
elsewhere. Look at the repo before assuming.

## Stack

- [EmDash](https://github.com/emdash-cms/emdash) (an Astro CMS) on Cloudflare Workers for
  Platforms, through the package **`@himlio/site`**. It brings EmDash, the Cloudflare adapter,
  sessions, email, the Worker, forms, booking, the content model's platform part, the build and
  these rules. Its README (`node_modules/@himlio/site/README.md`) documents everything it offers;
  its release notes are `node_modules/@himlio/site/CHANGELOG.md`.
- The site's repo holds the site's own code: design, pages, components and, if needed, its own
  API routes, tables, crons and content model. It was created from the Himlio starter once and is
  never synced; the platform reaches it only as `@himlio/site` version updates.
- Import EmDash through the package: `@himlio/site/emdash`, `@himlio/site/emdash/ui`, `/page`
  and `/runtime`, never `emdash` directly, so the site uses the EmDash version the platform pins.
- Admin at `/_emdash/admin`, in English (like EmDash, its plugins and the code). Content and
  users in D1 (`DB`), media in R2 (`MEDIA`).

## Language

The site's language is `locale` in `himlio.json` (`sv` on most sites). In that language: the
content, page URLs (page slugs) and the interface text visitors read. Interface text comes from
`src/utils/strings.ts` (`localized()` from `@himlio/site/runtime`, one object per language),
never written into markup. Booking and the other platform parts follow `locale` by themselves.

Everything else is English: code, comments, commits, docs, text only editors see, and names
inside the CMS that aren't URLs (block types, fields, select options, entry and form slugs, form
names, form field names).

## What's where

| What                                                                      | Where                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content                                                                   | In the admin. Pages are in `pages`: each page is a list of sections (EmDash block types); the home page is the page with slug `home`.                                                                                              |
| Forms                                                                     | In the admin under Forms (submissions too). On a page: a Contact form section (`marketing_form`) where the site has one, or a Form block in a Text section; outside content, `<Form id="slug" />` from `@himlio/site/forms`.       |
| Booking                                                                   | In the admin under Booking (services, staff and resources, opening hours, bookings and requests). On a page: a Booking section (`marketing_booking`) where the site has one, or a Booking block; outside content, `<Booking />`.   |
| Site description                                                          | In the admin: Settings → General → Tagline. Read it with `siteDescription()`.                                                                                                                                                      |
| Contact details                                                           | In the admin: the one entry `company-details` in Company details (`company`). Read them with `contactDetails()`.                                                                                                                   |
| Design                                                                    | **Read `node_modules/@himlio/site/docs/design.md` first.** `src/styles/` (`theme.css` tokens, `global.css` building blocks, `forms.css`), `src/components/` (one component per block type in `blocks/`), `src/layouts/`, `public/` |
| Interface text                                                            | `src/utils/strings.ts`, one object per language                                                                                                                                                                                    |
| Pages                                                                     | `src/pages/`                                                                                                                                                                                                                       |
| Astro config                                                              | `astro.config.mjs`: the site's integrations and options, in `defineHimlioConfig()`                                                                                                                                                 |
| Own middleware, API routes, tables, crons, content model, Durable Objects | "Extension points" in the `@himlio/site` README. Tables: `migrations/0100_*.sql` and up; content model: `src/model-migrations/`.                                                                                                   |
| Platform facts                                                            | `himlio.json`: slug, name, locale, URL, email sender, form recipients. Written by the platform (Terraform) and overwritten on every apply; never edit it.                                                                          |
| CI                                                                        | `.github/workflows/ci.yml` calls the platform's build workflow. Keep its version equal to `@himlio/site` in `package.json`.                                                                                                        |

## Build it the EmDash way

The design guide, `node_modules/@himlio/site/docs/design.md`, says how. In short:

- **The content model is the contract, the design is free.** A page's `content` is a list of
  block types (`marketing_hero`, `marketing_text`, ...) that customers and their AI connector
  edit. Restyle or rewrite any section component, header or footer freely; never put copy in
  `.astro` files.
- **Same content, different look: a variant field** (a `layout` select), added with
  `addBlockFields` in a content-model migration.
- **Different content: a new block type**: a component in `src/components/blocks/`, registered
  where the site lists its block components, the block type in a migration (`blockTypes`, plus
  `allowBlockTypes` to allow it in `pages.content`), in `seed/seed.json` and in
  `emdash-env.d.ts`.
- **Look at every section after a change:** `npm run fixtures` makes the block gallery
  (`/block-gallery`): every section type with all fields, only the required ones and each
  variant.
- **Style through tokens**; colours use `light-dark()` for dark mode.
- **Don't port other themes** (AstroWind, AstroDeck and the like); they put content in code.
  Take the look, rebuild it with blocks and tokens.
- **Look it up before inventing a pattern:** EmDash's docs MCP (`https://docs.emdashcms.com/mcp`)
  and EmDash's agent skills and templates.

## Rules

1. **`npm run verify` must pass** before you commit (format, type check, build).
2. **Work on a branch.** A push to `main` is released automatically once CI is green. Look at
   the **screenshots** artifact on every pull request before merging a design change.
3. **No secrets in git.** Customers may have write access to the repo. Never write keys, tokens
   or passwords into code or config. `.dev.vars` is for local values and is ignored.
4. **Only the bindings the platform provides** (`DB`, `MEDIA`, `EMAIL`, `HIMLIO_SLUG`) plus what
   `defineHimlioConfig({ himlio: ... })` declares. No KV, queues or service bindings; the build
   fails on them. Ask Walter & Co if you need one.
5. **Parameterised SQL only.** `env.DB.prepare('... WHERE id = ?').bind(id)`.
6. **Migrations are append-only**, D1 and content model alike. Never edit one that has been
   released.
7. **Every route needs a decision about access.** Public endpoints need input validation with
   length limits and abuse protection. Anything non-public must check the EmDash session.
8. **Privacy (GDPR).** No third-party fonts, analytics, trackers or embeds without asking.
   Fonts are self-hosted via `@fontsource` (not Astro's Google font provider). Store only the
   personal data a feature needs.
9. **Honest content.** No invented text, testimonials, customers or numbers. Testimonials,
   pricing, logos and stats sections are for the customer's real ones only.
10. **Keep it simple.** Prefer plain Astro and CSS. Ask before adding a framework or library.
11. **Platform changes go to `@himlio/site`**, not into the site. Don't copy platform code into
    the site to change it; ask for an extension point or a fix in `Walter-Co-AB/himlio-site`.
    The same goes for these rules: a rule every site should follow belongs here, not in one
    site's `AGENTS.md`.

## Updating `@himlio/site`

1. Read `CHANGELOG.md` in the package (or on GitHub) for every version since the site's: each
   says what sites need to do, usually nothing.
2. Change `@himlio/site` in `package.json` and `build.yml@vX.Y.Z` in `.github/workflows/ci.yml`
   to the same version, then `npm install`.
3. Do the steps the release notes list. "Optional" ones (a new section type, a fix to a starter
   component the site still uses) are up to the site.
4. `npm run verify`, then `npm run dev`, `npm run fixtures` and look at the pages and the block
   gallery. Content-model migrations run by themselves on the first request.

## Changing content over an AI connector (MCP)

When you change a **published** item with `content_update` (contact details, a page), pass
`status: "published"` or call `content_publish` afterwards. Otherwise the change can stay a
draft and not show on the site. The contact details are the one entry `company-details` in
`company`: `content_get` it, then `content_update` with its `_rev`. Connectors can also change
the content model, the site settings (not the site URL), forms and booking, and read form
submissions and bookings; see "AI connectors" in the `@himlio/site` README.

## Working alongside other agents

- **Your dev server, your port.** `npm run dev` uses the site's fixed port (`npx himlio-site
port`) and fails if it is taken; find out who holds it rather than changing it. Before sending
  requests to a local server, check it is yours (`npx astro dev status`). Never send requests,
  especially writes, to a server you didn't start.
- **Stay in your own checkout.** Run git only in your repo. Merge with
  `gh pr merge <n> -R <owner>/<repo> --squash`; `--delete-branch` only from your own checkout.
- **Hand over with commit hashes** when you ask another agent to review or sync something.

## Commands

```sh
npm install
npm run dev            # the site's port, admin at /_emdash/admin
npm run verify         # format, type check, build (what CI runs)
npm run fixtures       # sample content and the block gallery (-- --empty for the empty state)
npm run screenshots    # screenshots of the local dev server into screenshots/
```
