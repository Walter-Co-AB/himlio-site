# AGENTS.md

Rules for AI coding tools (Claude Code, Codex, Cursor, Copilot and others) and for people
working on this site. The site runs on Himlio, the website platform from Walter & Co AB.

## Stack

- [EmDash](https://github.com/emdash-cms/emdash) (an Astro CMS) on Cloudflare Workers for
  Platforms. Server rendered (`output: 'server'`) with `@astrojs/cloudflare`.
- Admin at `/_emdash/admin`. Content, users and sessions are stored in D1 (`DB`), media in R2
  (`MEDIA`), and co-editing rooms in a Durable Object (`EMDASH_ROOMS`).
- Swedish first: `sv` is the site language and the admin is in Swedish for Swedish browsers.
  Write interface text and starter content in Swedish.

## What you may change

| What                        | Where                                                       |
| --------------------------- | ----------------------------------------------------------- |
| Content                     | In the admin. Pages are in the `pages` collection.          |
| Design                      | `src/styles/`, `src/layouts/`, `src/components/`, `public/` |
| Pages and templates         | `src/pages/`                                                |
| Content model for new sites | `seed/seed.json` (applied once, when a site is set up)      |
| Database tables of your own | New files in `migrations/`, numbered from 0100              |

## What the platform owns (don't edit)

| File or rule               | Why                                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `himlio.json`              | Slug, name, description, locale, URL, contact details and email sender. Written by Terraform and overwritten on every apply. Read it through `src/lib/himlio.ts`. |
| `.github/workflows/ci.yml` | Builds the `himlio-build` artifact that the platform releases.                                                                                                    |
| The build contract         | `docs/himlio-build.md`, `scripts/himlio-build.mjs`, the `/_himlio/cron` handler in `src/worker.ts`.                                                               |

## Rules

1. **`npm run verify` must pass** before you commit (format, type check, build, artifact).
2. **Work on a branch.** Walter & Co merges to `main`; every push to `main` can be released.
3. **No secrets in git.** Customers may have write access to this repo. Never write keys,
   tokens or passwords into code, config or `.env` files. `.dev.vars` is for local values and
   is ignored.
4. **Only the bindings the platform provides.** `DB`, `MEDIA`, `EMAIL`, `HIMLIO_SLUG`, plus what the
   build declares itself: assets, Durable Objects and plain-text vars. No KV, queues, service
   bindings or extra D1/R2; `scripts/himlio-build.mjs` fails on them. Ask Walter & Co if you
   need one.
5. **No Cron Triggers.** They don't run on the platform. Put scheduled work in the
   `/_himlio/cron` handler in `src/worker.ts`; the expressions come from `triggers.crons` in
   `wrangler.jsonc` (UTC, at most 3). The work must be safe to run twice or to skip.
6. **Parameterised SQL only.** `env.DB.prepare('... WHERE id = ?').bind(id)`. Never build SQL
   by joining strings.
7. **Migrations are append-only.** Add `migrations/NNNN_description.sql`; never edit one that
   has been applied. Numbers 0001–0099 belong to the platform and this template; a customer
   site's own migrations start at 0100. EmDash creates its own tables itself.
8. **Every route needs a decision about access.** Public endpoints (forms) need input
   validation with length limits and abuse protection. Anything that shows or changes data
   that isn't public must check the EmDash session. Return generic error messages; log
   details.
9. **Privacy (GDPR).** No third-party fonts, analytics, trackers or embeds without asking.
   Fonts are self-hosted via `@fontsource`. Store only the personal data a feature needs.
10. **Honest content.** No invented text, testimonials, customers or numbers. Use what is in
    `himlio.json` or what the customer has written.
11. **Keep it simple.** Prefer plain Astro and CSS. Ask before adding a framework, a UI
    library or a new dependency.

## Commands

```sh
npm install
npm run dev          # http://localhost:4321, admin at /_emdash/admin
npm run verify       # everything CI runs
```
