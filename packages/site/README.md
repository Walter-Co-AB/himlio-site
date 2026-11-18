# @himlio/site

The Himlio platform for a customer website: an [EmDash](https://github.com/emdash-cms/emdash)
(Astro CMS) site on Cloudflare Workers for Platforms. A site's repo holds its design and its own
code. This package brings everything the platform owns, and updates by version.

## Use

```js
// astro.config.mjs
import { defineHimlioConfig } from '@himlio/site';

export default defineHimlioConfig({
  integrations: [], // the site's own
});
```

```astro
---
// in a page or component
import { contactDetails, siteDescription, himlio } from '@himlio/site/runtime';
const details = await contactDetails(Astro.cache);
---
```

```json
// package.json
"scripts": { "dev": "himlio-site dev", "build": "himlio-site build" }
```

`defineHimlioConfig()` adds:

- EmDash on D1 (`DB`) and R2 (`MEDIA`), set up from `himlio.json` (name, locale, URL, email
  sender), with the admin in English (the site itself is Swedish);
- sessions in D1, and email through the platform's `EMAIL` binding once `himlio.json` has
  `email.from`;
- the Cloudflare adapter with a generated Worker config (`.himlio/wrangler.json`; there is no
  `wrangler.jsonc` in a site);
- the platform middleware, the Worker entry (`/_himlio/cron`, OAuth scope limits for AI
  connectors, MCP guidance for connectors);
- the platform content model (`company`, Company details) and D1 tables, applied to every
  site automatically;
- the dev port: 4321 for the starter, 4400–4899 per customer site from its slug.

EmDash is pinned by this package, so a site can't drift to another EmDash version.

## Runtime helpers (`@himlio/site/runtime`)

| Export                                         | What                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `himlio`                                       | Platform facts from `himlio.json`: slug, name, locale, url, email.                                                       |
| `contactDetails(Astro.cache)`                  | Phone, email, address, org number and opening hours from the admin (the one `company` entry). Empty fields are left out. |
| `hasContactDetails(details)`, `telHref(phone)` | Helpers for the above.                                                                                                   |
| `siteDescription(Astro.cache)`                 | The Tagline from the admin (Settings → General), or `undefined`.                                                         |

Pass `Astro.cache` so cached pages are purged when the content changes.

## EmDash (`@himlio/site/emdash`)

EmDash is a dependency of this package, pinned to one version, not of the site. Import it
through the package, so a site always uses the EmDash the platform was tested with:

| Instead of       | Import from                   |
| ---------------- | ----------------------------- |
| `emdash`         | `@himlio/site/emdash`         |
| `emdash/ui`      | `@himlio/site/emdash/ui`      |
| `emdash/page`    | `@himlio/site/emdash/page`    |
| `emdash/runtime` | `@himlio/site/emdash/runtime` |

They re-export EmDash's own modules unchanged, so EmDash's documentation applies. An EmDash
update that breaks what they export is a major version of this package. (`emdash-env.d.ts`,
which EmDash generates with the collection types, still names `emdash`; leave it as it is.)

## Forms (`@himlio/site/forms`)

Every site has EmDash's Forms plugin ([`@emdash-cms/plugin-forms`](https://www.npmjs.com/package/@emdash-cms/plugin-forms),
pinned): the customer builds forms in the admin under Forms and reads the submissions there.
A form goes on a page as a Form block in rich text (a Text section's body), rendered by the
plugin with `.ec-form` classes for the site to style (the starter does it in
`src/styles/forms.css`). Outside rich text: `import { Form } from '@himlio/site/forms'`, then
`<Form id="kontakt" />` (the form's slug or id).

- Spam protection is a honeypot by default. Turnstile needs a key pair per site; ask Walter & Co.
- Notifications go to the form's addresses through the platform's email, with Reply-To set to the
  sender's address. In `astro dev` they are written to the log instead.
- Submissions are personal data: set a retention period on each form (Forms → settings); the
  plugin deletes expired submissions weekly. The autoresponder emails whatever address a visitor
  enters, so leave it off unless the form needs it.
- AI connectors can't create forms or read submissions (plugin routes need the `admin` scope,
  which connectors never get); they can place an existing form on a page.
- The plugin's own texts (validation errors, "Submitting...", the notification email) are in
  English; the submit button and confirmation message are set per form.

## Extension points

This table is the whole public API. A breaking change to it is a major version.

| Need                               | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Own integrations and Astro options | `defineHimlioConfig({ integrations, vite, image, ... })`. The platform's adapter, output, session, site URL and dev port win.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Own middleware                     | `src/middleware.ts` (plain Astro). The platform's middleware is registered by `defineHimlioConfig()` and runs first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Own scheduled work                 | `defineHimlioConfig({ himlio: { crons: { '0 3 * * *': './src/cron/nightly.ts' } } })`. The module's default export is `(controller, env, ctx) => void \| Promise<void>`. At most 2; UTC; only `*`, numbers, `a-b`, `*/n`, `a,b`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Own content model                  | `himlio: { modelMigrations: 'src/model-migrations' }`: `NNNN_name.json`, partial EmDash seeds (`blockTypes`, `collections`, `content`). Applied once per site, in the background after the first request after a deploy, in EmDash's "skip" mode: what exists is kept; new block types, collections, entries, and new fields on existing collections are created. A field's type can't be changed this way (EmDash forbids e.g. `portableText` → `blocks`). `relabel: [{ collection, field?, label: ["from", "to"] }]` renames a collection (`label`, `labelSingular`, `description`) or field (`label`) while it still has the old label. Append-only. |
| Own Durable Objects                | `himlio: { durableObjects: [{ binding: 'COUNTER', className: 'Counter' }] }`, and `src/worker.ts` that exports the class and re-exports the platform Worker: `export { default, EmDashRoom, EmDashRoomSite, PluginBridge } from '@himlio/site/worker';`                                                                                                                                                                                                                                                                                                                                                                                                 |
| Own D1 tables                      | `migrations/0100_name.sql` and up (0001–0099 are the platform's). Merged into the build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Own API routes                     | `src/pages/api/*.ts` (plain Astro). Decide about access for each.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Own vars                           | `himlio: { vars: { NAME: 'value' } }`. Plain text, not secrets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Reserved binding names: `DB`, `MEDIA`, `EMAIL`, `HIMLIO_SLUG`, `ASSETS`, `EMDASH_ROOMS`.

## `himlio-site` command

| Command                                            | What                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `himlio-site dev`                                  | Apply D1 migrations to the local database, then `astro dev`.                                                               |
| `himlio-site build`                                | `astro build`, then the `himlio-build/` artifact the platform releases ([docs/build-artifact.md](docs/build-artifact.md)). |
| `himlio-site fixtures [--empty]`                   | Sample content on the local dev server, or the empty state. Refuses servers that aren't this checkout's.                   |
| `himlio-site screenshots [--out dir] [/path ...]`  | Full-page screenshots in light, dark and mobile. Scrolls through each page first, so scroll effects show.                  |
| `himlio-site install-browsers`, `himlio-site port` | For CI.                                                                                                                    |

CI: a site's `.github/workflows/ci.yml` calls the reusable workflow
`Walter-Co-AB/himlio-site/.github/workflows/build.yml@vX.Y.Z` (same version as the package).

## AI connectors (MCP)

Connectors authorised over OAuth get content work plus reading the schema and settings:
`content:read/write`, `media:read/write`, `taxonomies:manage`, `menus:manage`, `schema:read`,
`settings:read`. No schema or settings changes, no forms or submissions, and no access to the
404 log or settings sub-routes. On connect, they receive instructions, among them: **when changing a published
item with `content_update`, pass `status: "published"` (or call `content_publish`)**, or the
change may stay a draft and not show on the site.

## Licence

MIT. The licence covers the code, not the Himlio name or logo.
