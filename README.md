# Himlio site template

The starting point for websites on Himlio, the hosted website platform from Walter & Co AB.
Each customer site is an [EmDash](https://github.com/emdash-cms/emdash) site (an Astro CMS)
that runs on Cloudflare Workers for Platforms. The platform creates customer repos from this
template as `Walter-Co-AB/site-<slug>`.

- The site answers on `<slug>.himlio.app` and on the customer's own domains.
- Content is edited in the admin at `/_emdash/admin`. Content and users are stored in the
  site's D1 database and media in its R2 bucket, both in the EU.
- The site's name, description and contact details come from `himlio.json`, which the
  platform writes.

## Development

```sh
npm install
npm run dev       # applies D1 migrations locally, then http://localhost:4321
npm run verify    # what CI runs: format, type check, build, himlio-build artifact
```

The first visit to `/_emdash/admin` starts the setup, where you create the first
administrator.

## Releasing

Pushes to `main` build the `himlio-build` artifact in CI. Walter & Co releases it to the
platform. See [docs/himlio-build.md](docs/himlio-build.md) for the contract and
[AGENTS.md](AGENTS.md) for what may be changed.
