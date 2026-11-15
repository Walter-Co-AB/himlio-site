# AGENTS.md

Rules for AI coding tools (Claude Code, Codex, Cursor, Copilot and others) and for people
working on this site. The site runs on Himlio, the website platform from Walter & Co AB.

## Stack

- [EmDash](https://github.com/emdash-cms/emdash) (an Astro CMS) on Cloudflare Workers for
  Platforms. Server rendered (`output: 'server'`) with `@astrojs/cloudflare`.
- Admin at `/_emdash/admin`. Content, users and sessions are stored in D1 (`DB`), media in R2
  (`MEDIA`), and co-editing rooms in a Durable Object (`EMDASH_ROOMS`).
- The public URL is `url` in `himlio.json` (EmDash `siteUrl`, set for builds, not in `astro dev`).
  Passkeys, OAuth, MCP and links in emails use it.
- OAuth clients (MCP connectors, the EmDash CLI) get content work plus read-only schema and
  settings (`content:read/write`, `media:read/write`, `taxonomies:manage`, `menus:manage`,
  `schema:read`, `settings:read`): `src/lib/oauth-scopes.ts` limits them before EmDash sees the
  request, and keeps OAuth tokens out of the 404 log (visitor IP addresses). No `schema:write` or
  `settings:manage`. Don't widen the list without asking Walter & Co.
- Swedish first: `sv` is the site language and the admin is in Swedish for Swedish browsers.
  Write interface text and starter content in Swedish.

## What you may change

| What                        | Where                                                        |
| --------------------------- | ------------------------------------------------------------ |
| Content                     | In the admin. Pages are in the `pages` collection.           |
| Site description            | In the admin: Settings → General → Tagline                   |
| Contact details             | In the admin: the one entry in Företagsuppgifter (`company`) |
| Design                      | `src/styles/`, `src/layouts/`, `src/components/`, `public/`  |
| Pages and templates         | `src/pages/`                                                 |
| Content model for new sites | `seed/seed.json` (applied once, when a site is set up)       |
| Database tables of your own | New files in `migrations/`, numbered from 0100               |

## What the platform owns (don't edit)

| File or rule               | Why                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `himlio.json`              | Slug, name, locale, URL and email sender: platform facts only. Written by Terraform and overwritten on every apply. Read it through `src/lib/himlio.ts`. The description and contact details are the customer's and live in the admin: use `siteDescription()` (`src/lib/site-description.ts`) and `contactDetails()` (`src/lib/contact.ts`). |
| `.github/workflows/ci.yml` | Builds the `himlio-build` artifact that the platform releases.                                                                                                                                                                                                                                                                                |
| OAuth scope limits         | `src/lib/oauth-scopes.ts` and its use in `src/worker.ts`.                                                                                                                                                                                                                                                                                     |
| The build contract         | `docs/himlio-build.md`, `scripts/himlio-build.mjs`, the `/_himlio/cron` handler in `src/worker.ts`.                                                                                                                                                                                                                                           |

## Rules

1. **`npm run verify` must pass** before you commit (format, type check, tests, build, artifact).
2. **Work on a branch.** Walter & Co merges to `main`; a push to `main` is released automatically
   once CI is green.
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
10. **Honest content.** No invented text, testimonials, customers or numbers. Use what the
    customer has written in the admin.
11. **Keep it simple.** Prefer plain Astro and CSS. Ask before adding a framework, a UI
    library or a new dependency.

## Working alongside other agents

Several agents (and people) work on Himlio at once: one per site repo, one for this template and
one for the infrastructure. These rules keep them out of each other's way.

- **Your dev server, your port.** Each repo has a fixed port: 4321 for the template, 4400–4899
  for a customer site, derived from the slug in `himlio.json` (`devPort()` in
  `astro.config.mjs`). If it is taken, `npm run dev` fails instead of moving to another port.
  Don't change the port; find out who holds it. Before sending a request to a local server,
  check it is yours: `npx astro dev status` shows this repo's server (agents get one background
  server per repo), or check the listener's working directory with
  `lsof -a -p "$(lsof -nP -t -iTCP:<port> -sTCP:LISTEN)" -d cwd`. Never send requests,
  especially writes, to a server you didn't start.
- **Stay in your own checkout.** Run git commands only in your own repo's directory. To merge a
  PR, use `gh pr merge <number> -R Walter-Co-AB/<repo> --squash`. Add `--delete-branch` only when
  you run it from your own checkout of that repo: it also switches and pulls the local checkout.
- **Who owns what.**
  - Platform-owned files (see "What the platform owns") are written in `himlio-template`. Site
    repos copy them unchanged from a named template commit and never edit them; a change goes
    to the template first.
  - `himlio.json` is written by `himlio-infrastructure` (Terraform). No one edits it in a repo.
  - Everything else in a site repo (design, pages) belongs to that site. Content belongs in the
    admin.
- **Hand over with commit hashes.** When you ask another agent to sync or review, name the
  commit and the files.

## Commands

```sh
npm install
npm run dev          # this repo's port (4321 for the template), admin at /_emdash/admin
npm run verify       # everything CI runs
```
