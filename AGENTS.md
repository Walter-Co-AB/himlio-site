# AGENTS.md

Rules for AI coding tools (Claude Code, Codex, Cursor, Copilot and others) and for people
working on this site. The site is hosted by Walter & Co on Cloudflare Pages.

## Stack

- Astro, static output. Pages are built from `src/content/` (Markdown and JSON).
- Sveltia CMS at `/admin/`. Editors log in with GitHub and every save is a git commit.
- Optional server code in `functions/` (Cloudflare Pages Functions) and an optional D1
  database bound as `env.DB` with migrations in `migrations/`. Neither exists until it is
  needed; see `examples/`.

## Files and who owns them

| File                                | What it is                                                              |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `site.config.json`                  | Repo, domain, Pages project, CMS login. Set by Walter & Co; don't edit. |
| `src/content/settings/site.json`    | Name, contact details and colours. Edited in the CMS.                   |
| `src/content/pages/<slug>/index.md` | One page each, images in the same folder. `start` is the home page.     |
| `cms/config.yml`                    | CMS fields. Must match `src/schemas.ts`.                                |
| `src/schemas.ts`                    | Zod schemas for the content. Must match `cms/config.yml`.               |
| `src/pages/admin/config.yml.ts`     | Builds `/admin/config.yml` from the two files above.                    |

## Rules

1. **`npm run verify` must pass** before you commit (format, type check, CMS check, build).
2. **Preview before production.** Work on a branch. Every branch gets a preview at
   `https://<branch>.<project>.pages.dev`. Merge to `main` only after the preview has been
   checked and approved.
3. **Keep the CMS and the schemas in sync.** When you add, rename or remove a content field,
   change both `cms/config.yml` and `src/schemas.ts`. A field is `.optional()` in Zod
   exactly when it is `required: false` in the CMS.
4. **No secrets in git.** API keys, tokens and passwords are set as secrets in Cloudflare by
   Walter & Co and read from `env` at runtime. Never write them into code, config, `.env`
   files that get committed, or the CMS. `.dev.vars` is for local values and is ignored.
5. **Use bindings, not URLs and keys.** Talk to D1, KV and the Walter & Co API through the
   bindings on `env` (`env.DB` and so on). Ask Walter & Co to add a binding; don't create
   Cloudflare resources yourself and don't add a `wrangler.toml` (the Pages project is
   managed by Walter & Co).
6. **Parameterised SQL only.** `env.DB.prepare('... WHERE id = ?').bind(id)`. Never build
   SQL by joining strings.
7. **Every route needs a decision about access.** Files in `functions/` are public URLs.
   Public endpoints (forms) need Turnstile, input validation with length limits, and rate
   limiting. Anything that shows or changes data that isn't public must be behind
   Cloudflare Access or check a session. Return generic error messages; log details.
8. **Migrations are append-only.** Add `migrations/NNNN_description.sql`; never edit one that
   has been applied.
9. **Privacy (GDPR).** No third-party fonts, analytics, trackers or embeds without asking.
   Fonts are self-hosted via `@fontsource`. Store only the personal data a feature needs.
10. **Keep it simple.** Prefer plain Astro and CSS. Ask before adding a framework, a UI
    library or a new dependency.

## Bindings and environment

Set by Walter & Co on the Pages project, for both production and previews. They only exist
when the feature is turned on for this site; check before relying on one.

| Name                        | Kind                | When               | Notes                                                                                                                |
| --------------------------- | ------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `env.DB`                    | D1                  | database turned on | Previews use a separate preview database, never production data.                                                     |
| `env.API`                   | Service binding     | forms turned on    | The Walter & Co API. Call it with `env.API.fetch(...)`; it has no public URL.                                        |
| `env.API_KEY`               | Secret              | forms turned on    | Send as `Authorization: Bearer <key>` to `env.API`. The API derives the site from the key; never send a customer id. |
| `env.TURNSTILE_SECRET`      | Secret              | forms turned on    | Server-side Turnstile check.                                                                                         |
| `PUBLIC_TURNSTILE_SITE_KEY` | Build-time variable | forms turned on    | `import.meta.env.PUBLIC_TURNSTILE_SITE_KEY` in Astro, for the widget.                                                |

Previews (`*.<project>.pages.dev`) may be behind Cloudflare Access, so requests from outside
the browser (curl, webhooks, tests) to a preview need an Access login or service token.

## Commands

```sh
npm install
npm run dev          # http://localhost:4321 (the CMS needs the deployed site to log in)
npm run verify       # everything CI runs
```
