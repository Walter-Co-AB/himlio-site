# Himlio site

A website on Himlio, the hosted website platform from Walter & Co AB: an
[EmDash](https://github.com/emdash-cms/emdash) site (an Astro CMS) on Cloudflare Workers, built
on the package [`@himlio/site`](https://www.npmjs.com/package/@himlio/site).

- The site answers on `<slug>.himlio.app` and on the customer's own domains.
- Content is edited in the admin at `/_emdash/admin`.
- The site's name, locale and URL come from `himlio.json`, which the platform writes. The
  description (Tagline) and contact details are edited in the admin.
- This repo holds the site's design and its own code. The platform comes as `@himlio/site`.
- The design started from EmDash's marketing template: pages are built from sections (block
  types) in the admin. How to design it: `node_modules/@himlio/site/docs/design.md`.

## Development

```sh
npm install
npm run dev        # applies D1 migrations locally, then the site on its own port
npm run fixtures   # sample content and the block gallery /block-gallery (-- --empty: empty state)
npm run verify     # what CI runs
```

The first visit to `/_emdash/admin` starts the setup, where you create the first
administrator.

See [AGENTS.md](AGENTS.md) for the rules that apply to changes (they come from
`node_modules/@himlio/site/docs/site-agents.md`), and the package's `CHANGELOG.md` when you
update `@himlio/site`.
