# AGENTS.md

Rules for AI coding tools and people working on the Himlio platform repo.

## Layout

- `packages/site`: `@himlio/site`, published to npm. TypeScript in `src/` (compiled to `dist/`
  with `tsc`), the `himlio-site` command in `cli/` (plain ESM), platform D1 migrations in
  `migrations/` (0001–0099), platform content-model migrations in `model-migrations/`, tests in
  `test/` (against `dist/`). Its README is the public documentation.
- `starter/`: the design new sites start from: EmDash's marketing template (block-type pages)
  adapted to Himlio, consuming the package through the npm workspace. `starter/UPSTREAM.md` lists
  the EmDash version it follows and every Himlio change; keep `src/` close to upstream. (Sites own
  their copy and change it freely; `packages/site/docs/design.md` is the design guide they follow.)
  Infra copies it once per new site, at the tag of the latest `@himlio/site`, and never syncs it,
  so it must be a complete site on its own, and its `@himlio/site` version and `build.yml@vX.Y.Z`
  must equal the package version (a test checks).
- `.github/workflows/build.yml`: the reusable workflow sites call. `ci.yml` runs it on the
  starter, against the package in the same commit.

## Rules

1. **`npm run verify` must pass** before you commit.
2. **The extension-point table in `packages/site/README.md` is the public API.** A breaking
   change to it, to the runtime helpers or to the build is a major version.
3. **Migrations are append-only**, D1 (`packages/site/migrations/00NN_*.sql`) and content model
   (`packages/site/model-migrations/NNNN_*.json`) alike.
4. **No secrets in git.** The repo is public.
5. **Pin what sites depend on:** EmDash and `@emdash-cms/cloudflare` exactly, actions by commit
   SHA, new npm packages at a version at least 7 days old.
6. **Releases go through a tag.** Bump `packages/site/package.json`, merge, then ask Anton or the
   infrastructure agent to push `vX.Y.Z` (only org admins may create `v*` tags). `publish.yml`
   publishes it with npm Trusted Publishing. Never publish by hand.

## Working alongside other agents

Several agents work on Himlio at once (this repo, each `site-*`, the infrastructure). Use your
own dev port and check a server is yours before sending requests (`npx astro dev status`); run
git only in your own checkout; merge with `gh pr merge <n> -R Walter-Co-AB/<repo> --squash`;
hand over with commit hashes.
