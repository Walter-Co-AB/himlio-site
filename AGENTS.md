# AGENTS.md

Rules for AI coding tools and people working on the Himlio platform repo.

## Layout

- `packages/site`: `@himlio/site`, published to npm. TypeScript in `src/` (compiled to `dist/`
  with `tsc`), the `himlio-site` command in `cli/` (plain ESM), platform D1 migrations in
  `migrations/` (0001–0099), platform content-model migrations in `model-migrations/`, tests in
  `test/` (against `dist/`). Its README is the public documentation.
- `starter/`: the design new sites start from, consuming the package through the npm workspace.
  It is copied once per new site and never synced, so changes here only reach new sites.
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
   SHA, new npm packages at a version at least two weeks old.
6. **Don't publish by hand** except the first 1.0.0. Releases go through the tag and
   `publish.yml` (npm Trusted Publishing).

## Working alongside other agents

Several agents work on Himlio at once (this repo, each `site-*`, the infrastructure). Use your
own dev port and check a server is yours before sending requests (`npx astro dev status`); run
git only in your own checkout; merge with `gh pr merge <n> -R Walter-Co-AB/<repo> --squash`;
hand over with commit hashes.
