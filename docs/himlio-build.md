# The build artifact (`himlio-build`)

This is the contract between a Himlio site repo and the platform that releases it. It is
copied from `docs/release.md` in `Walter-Co-AB/himlio-infrastructure`. The check there
(`scripts/release/prepare.mjs`) is the source of truth: if the two disagree, the check wins.

## In this repo

- `.github/workflows/ci.yml` runs `npm run verify` and, on pushes to `main`, uploads the
  `himlio-build` artifact.
- `npm run himlio-build` runs `wrangler deploy --dry-run --outdir himlio-build/worker` and
  `scripts/himlio-build.mjs`, which writes `himlio-build.json` from the Worker config Astro
  generates from `wrangler.jsonc`, and copies `dist/client/` to `assets/` and `migrations/`.
- `DB`, `MEDIA`, `EMAIL` and `HIMLIO_SLUG` in `wrangler.jsonc` are for local development and
  are left out. Any other binding the platform can't provide (KV, services, queues, D1 or R2 under
  another name) fails the build.
- Migrations 0001–0099 belong to the platform and this template (0001 creates the session
  table, 0002 the list of applied content-model migrations); a customer site's own migrations
  start at 0100. EmDash creates its own tables at
  runtime, not through `migrations/`.
- Content-model changes for existing sites are `seed/migrations/NNNN_name.json` (partial EmDash
  seeds). The site applies pending ones itself on the first request after a deploy
  (`src/middleware.ts`), in "skip" mode, and records them in D1. Nothing to do at release.
- Email: when `himlio.json` has `email.from`, the build adds EmDash's Cloudflare email provider,
  which sends through the `EMAIL` (`send_email`) binding, with the site name as sender name
  and no Reply-To. Without it, the site has no email provider and invites give a
  link to share instead.
- `src/worker.ts` answers `POST /_himlio/cron` (scheduled publishing in EmDash and session
  cleanup). The work is safe to run twice or to skip.

## Layout

```
himlio-build.json   description of the build (below)
worker/             bundled Worker: output of `wrangler deploy --dry-run --outdir worker`
assets/             static files (optional)
migrations/         D1 migrations: 0001_name.sql, 0002_name.sql, ... (optional, flat)
```

Nothing else may be at the root. No symlinks. At most 100,000 files, each at
most 25 MiB. `worker/` at most 10 MiB gzipped (Cloudflare's limit is on the
compressed upload) and 64 MiB uncompressed.

## `himlio-build.json`

```json
{
  "version": 1,
  "main": "index.js",
  "compatibility_date": "2026-11-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "binding": "ASSETS", "not_found_handling": "404-page" },
  "durable_objects": [{ "binding": "EMDASH_ROOMS", "class_name": "EmDashRoom" }],
  "durable_object_migrations": [{ "tag": "v1", "new_sqlite_classes": ["EmDashRoom"] }],
  "crons": ["* * * * *"],
  "vars": { "EMDASH_LOCALE": "sv" }
}
```

| Key                         | Required | Notes                                                                                          |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `version`                   | yes      | `1`                                                                                            |
| `main`                      | yes      | entry module, relative to `worker/` (`.js`/`.mjs`)                                             |
| `compatibility_date`        | yes      | `YYYY-MM-DD`                                                                                   |
| `compatibility_flags`       | no       | list of flag names                                                                             |
| `assets`                    | no       | requires `assets/`. Keys: `binding`, `html_handling`, `not_found_handling`, `run_worker_first` |
| `durable_objects`           | no       | `{binding, class_name}`; SQLite-backed only, so they need `durable_object_migrations`          |
| `durable_object_migrations` | with DOs | Wrangler `migrations`: `tag`, `new_sqlite_classes`, `renamed_classes`, `deleted_classes`       |
| `crons`                     | no       | at most 3, UTC. See "Scheduled work"                                                           |
| `vars`                      | no       | plain-text variables, at most 32                                                               |

Any other key is rejected, including `d1_databases`, `r2_buckets`,
`services`, `kv_namespaces` and `name`.

## Bindings the platform adds

| Binding       | What                                                                                    |
| ------------- | --------------------------------------------------------------------------------------- |
| `DB`          | D1 database `himlio-<slug>` (EU). Migrations from `migrations/` run before each deploy. |
| `MEDIA`       | R2 bucket `himlio-<slug>-media` (EU)                                                    |
| `HIMLIO_SLUG` | the site's slug                                                                         |

These names are reserved; the build can't use them for its own bindings.

## Scheduled work

Sites in the dispatch namespace can't have Cron Triggers. The `crons` in
`himlio-build.json` are stored in the release record, and the platform calls
the site instead: `POST /_himlio/cron` with header `X-Himlio-Cron: <expression>`.
The site does its scheduled work in that request. `/_himlio/*` is only
reachable from the platform; the router answers 404 to the outside.

Expressions have five fields (minute, hour, day of month, month, day of
week) in **UTC**, with `*`, numbers, ranges `a-b`, steps `*/n` and `a-b/n`,
and lists `a,b`. No names (`MON`), `L`, `W` or `#`. The platform Worker
`himlio-cron` checks every minute; a call can arrive a few seconds late.

## Customer CI, in short

```yaml
- run: npm ci
- run: npm run build
- run: npx wrangler deploy --dry-run --outdir himlio-build/worker
- run: node scripts/himlio-build.mjs # writes himlio-build.json, copies assets/ and migrations/
- uses: actions/upload-artifact@<sha> # pin
  with:
    name: himlio-build
    path: himlio-build/
    include-hidden-files: false
```

The workflow file must be `.github/workflows/ci.yml` and run on pushes to
`main`. It needs no secrets: `wrangler deploy --dry-run` does not log in.
