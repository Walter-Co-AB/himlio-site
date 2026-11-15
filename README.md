# Himlio site template

The starting point for websites on Himlio, the hosted website platform from Walter & Co AB.
Each customer site is an [EmDash](https://github.com/emdash-cms/emdash) site (an Astro CMS)
that runs on Cloudflare Workers for Platforms. The platform creates customer repos from this
template as `Walter-Co-AB/site-<slug>`.

- The site answers on `<slug>.himlio.app` and on the customer's own domains.
- Content is edited in the admin at `/_emdash/admin`. Content and users are stored in the
  site's D1 database and media in its R2 bucket, both in the EU.
- The site's name, locale and URL come from `himlio.json`, which the platform writes. The
  description (Tagline) and contact details are edited in the admin.

## Development

```sh
npm install
npm run dev       # applies D1 migrations locally, then the repo's own port (4321 for the template;
                  # customer sites 4400–4899 from the slug, see devPort() in astro.config.mjs)
npm run dev:fixtures   # sample content on the dev server (-- --empty for the empty state)
npm run screenshots    # screenshots of the dev server into screenshots/
npm test          # unit tests (tests/*.test.mjs, Node's test runner)
npm run verify    # what CI runs: format, type check, tests, build, himlio-build artifact
```

The first visit to `/_emdash/admin` starts the setup, where you create the first
administrator.

## Releasing

Pushes to `main` build the `himlio-build` artifact in CI. Walter & Co releases it to the
platform. See [docs/himlio-build.md](docs/himlio-build.md) for the contract and
[AGENTS.md](AGENTS.md) for what may be changed.
