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
- Admin at `/_emdash/admin`. Content and users in D1 (`DB`), media in R2 (`MEDIA`).
- Swedish first: `sv` is the site language. Write interface text and content in Swedish.

## What's where

| What                                                                      | Where                                                                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Content                                                                   | In the admin. Pages are in the `pages` collection; the home page shows the page with slug `start`.                                       |
| Site description                                                          | In the admin: Settings → General → Tagline. Read it with `siteDescription()`.                                                            |
| Contact details                                                           | In the admin: the one entry in Företagsuppgifter (`company`). Read them with `contactDetails()`.                                         |
| Design                                                                    | `src/styles/`, `src/layouts/`, `src/components/`, `public/`                                                                              |
| Pages                                                                     | `src/pages/`                                                                                                                             |
| Astro config                                                              | `astro.config.mjs`: the site's integrations and options, in `defineHimlioConfig()`                                                       |
| Own middleware, API routes, tables, crons, content model, Durable Objects | See "Extension points" in the `@himlio/site` README. Tables: `migrations/0100_*.sql` and up.                                             |
| Platform facts                                                            | `himlio.json`: slug, name, locale, URL, email sender. Written by the platform (Terraform) and overwritten on every apply; never edit it. |
| CI                                                                        | `.github/workflows/ci.yml` calls the platform's build workflow. Keep its version equal to `@himlio/site` in `package.json`.              |

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
   Fonts are self-hosted via `@fontsource`. Store only the personal data a feature needs.
9. **Honest content.** No invented text, testimonials, customers or numbers.
10. **Keep it simple.** Prefer plain Astro and CSS. Ask before adding a framework or library.
11. **Platform changes go to `@himlio/site`**, not into this repo. Don't copy platform code
    here to change it; ask for an extension point or a fix in `Walter-Co-AB/himlio-site`.

## Changing content over an AI connector (MCP)

When you change a **published** item with `content_update` (contact details, a page), pass
`status: "published"` or call `content_publish` afterwards. Otherwise the change can stay a
draft and not show on the site. The contact details are the one entry `foretagsuppgifter` in
`company`: `content_get` it, then `content_update` with its `_rev`. The Tagline can only be
changed in the admin.

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
