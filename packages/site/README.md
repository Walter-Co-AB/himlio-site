# @himlio/site

The Himlio platform for a customer website: an [EmDash](https://github.com/emdash-cms/emdash)
(Astro CMS) site on Cloudflare Workers for Platforms. A site's repo holds its design and its own
code. This package brings everything the platform owns, and updates by version.

Working on a site: [docs/site-agents.md](docs/site-agents.md) (the rules a site's `AGENTS.md`
imports), [docs/design.md](docs/design.md) (designing it) and [CHANGELOG.md](CHANGELOG.md) (what
each version needs from sites).

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
  sender), with the admin in English (the site itself is in its `locale`, e.g. `sv`; English when unset);
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

| Export                                                         | What                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `himlio`                                                       | Platform facts from `himlio.json`: slug, name, locale, url, email.                                                              |
| `localized({ en, sv })`                                        | The object for the site's language (`locale`; `sv-SE` → `sv`, unknown → `en`): interface text visitors read that isn't content. |
| `contactDetails(Astro.cache)`                                  | Phone, email, address, org number and opening hours from the admin (the one `company` entry). Empty fields are left out.        |
| `hasContactDetails(details)`, `telHref(phone)`                 | Helpers for the above.                                                                                                          |
| `siteDescription(Astro.cache)`                                 | The Tagline from the admin (Settings → General), or `undefined`.                                                                |
| `socialLinks(Astro.cache)`, `socialLinksFrom(settings.social)` | The social profiles from Settings → Social as `{ network, label, url }`; a username or a full URL both work.                    |
| `newsPath()`, `postPath(slug)`, `feedPath()`                   | News URLs in the site's language: `"nyheter"`, `/nyheter/<slug>`, `/nyheter/rss.xml` on a Swedish site.                         |
| `privacyPolicyPath()`                                          | The path of the published page with the Privacy policy block (for a footer link), or `undefined`.                               |

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
`<Form id="contact" />` (the form's slug or id).

- Spam protection is a honeypot by default. Turnstile needs a key pair per site; ask Walter & Co.
- Notifications go to the form's addresses through the platform's email, with Reply-To set to the
  sender's address. In `astro dev` they are written to the log instead.
- **Recipients come from the platform config** (`himlio.json` `forms.notify`, set by Walter & Co)
  until the plugin's admin has a field for them: a form saved without recipients gets that list,
  and on the platform's minute cron so does any stored form that has none. A form that already
  has recipients keeps them. No `forms` in `himlio.json` means no default, and no notifications.
- Submissions are personal data, so they are kept at most 12 months: a form's retention is
  1–365 days, 365 by default. "0 = forever" in the admin and anything over 365 are saved as 365.
  The plugin deletes expired submissions weekly, on the platform's cron.
- No autoresponder: it would email any address a visitor types in, from the platform's sender.
  The admin still shows the setting, but the platform drops it when a form is saved.
- These rules are enforced in the Worker on the plugin's `forms/create` and `forms/update` routes, the
  only ones that take form settings. A request it can't read is refused.
- AI connectors get MCP tools for forms (see "AI connectors" below): list, create and change
  forms, and read submissions. The same rules apply there, and connectors can't set the
  recipients, the webhook or the autoresponder; deleting forms, and changing, deleting or
  exporting submissions, stay in the admin.
- The plugin's visitor-facing texts (validation errors, "Submitting...", the fallback success
  and error messages) are in English for now; Swedish will come later. The submit button and
  confirmation message are set per form, so those can be Swedish. The notification email is
  English, like the admin.

## Booking

Every site has Himlio's booking plugin (`himlio-booking`): visitors book a time, in the site's language,
without a separate booking service. It fits salons, tattoo studios, therapists and the like.

- **Language**: everything visitors read (the form, its messages, the emails to them and the
  link pages) is in the site's language, `locale` in `himlio.json`: Swedish for `sv`, English
  otherwise (`src/booking/strings.ts`, also `@himlio/site/booking/text`). Code, admin and the
  business's notifications are English.

- **Services**: name, length, buffer after each booking, price (fixed or "from"), up to 5
  questions in the form (e.g. placement and size for a tattoo), a cancellation deadline in
  hours, and a mode: **instant** (booked at once) or **request** (the business approves or
  declines each one; the time is held up to 72 hours, then the request lapses and the visitor is
  told).
- **Staff and resources**: people, chairs or rooms. Each can have its own working hours (or the
  site's opening hours), time off, services, own lengths per service, its own calendar in and
  its own feed out. Visitors pick one or "anyone" (whoever is free). A site without
  resources books the business as a whole; bookings made before resources were added block
  everyone.
- **Opening hours**: per weekday, dates with other hours or closed (they apply to everyone),
  step between start times, minimum notice and how far ahead people can book. Times are
  Europe/Stockholm, across daylight saving changes; lengths, buffers and times on whole 5 minutes.
- **Admin**: Bookings (a week of bookings and blocked time, filter by person, requests to answer
  with approve/decline, details with answers, cancel with or without emailing the visitor,
  block time for everyone or one person) and Booking settings (services, staff and resources,
  opening hours, notifications, calendars and feeds).
- **On a page**: a Booking section (`marketing_booking` in the starter; the section's service by
  name, or empty to let the visitor choose), a Booking block in rich text (service and person
  optional), or in code `import { Booking } from '@himlio/site/booking'` and
  `<Booking service="Haircut" resource="Anna" />` (both optional, by name or id). The contact
  fields use the Forms classes (`.ec-form-*`), so a site's form styles apply; the picker uses
  `.hb-booking-*`, and the picked date and time take `--hb-booking-selected` /
  `--hb-booking-on-selected`. Needs JavaScript.
- **One step or two**: with Cloudflare Turnstile (`himlio.json` `turnstile.site_key` and the
  Worker secret `TURNSTILE_SECRET`, both set by the platform), the form has a bot check and the
  booking counts at once. Without it, or if the check fails, the visitor confirms by a link in
  an email within 30 minutes (or later, if the time is still free). Tokens must be for the
  request's hostname; Cloudflare's test keys work only on localhost.
- **After booking**: the visitor gets a confirmation with an .ics file and links to cancel and
  to move the booking (a page at `/_booking` lists free times with the same person), until the
  service's deadline; the customer gets a notification with an .ics file, and notices when a
  visitor cancels or moves. Reminders go out a day before (not for bookings made or moved less
  than 36 hours ahead). A booking can be moved at most 3 times this way.
- **No double bookings**: every 5 minutes a booking keeps busy (length and buffer) is stored
  once per resource, create-if-absent, so of two overlapping bookings only one is made.
- **Calendars**: secret iCal feeds of the bookings (all, and per person) to subscribe to in any
  calendar app, and calendars in: the business's (blocks everyone) and each person's (blocks
  that person), read every 5 minutes; only busy times are kept, never what the events are;
  recurring events included, events marked free ignored.
- **Notifications** go to the addresses set in the booking settings, or else `himlio.json`
  `forms.notify`, with Reply-To set to the visitor. Emails to visitors have Reply-To
  `himlio.json` `email.reply_to` when it is set (none otherwise). Emails are sent through the
  platform's `EMAIL` binding with the .ics attached; without `email.from` in `himlio.json` they
  are written to the log.
- **Abuse protection**: Turnstile when on, a honeypot, at most 5 bookings per IP address an
  hour, 5 per email address a day, 3 upcoming per email address, 30 unconfirmed per site an
  hour. The first email to an unproven address contains nothing the visitor typed.
- **Personal data**: bookings are deleted 12 months after the appointment; unconfirmed,
  declined and lapsed ones after 30 days. Blocked time is deleted a year after it ends.
- Maintenance (expiring holds and requests, reminders, deletion, reading calendars) runs on the
  platform's minute cron, every 5 minutes.
- Not yet: SMS reminders, payments and deposits.

## Built in for every site

The platform's site plugin (`himlio-site`) adds these to every site, with no code in the site:

- **Business info for search engines.** On the home page, schema.org JSON-LD (`LocalBusiness`
  or the Company details' Business type) with the site title, tagline, logo, phone, email,
  address (Swedish postcodes are parsed) and the social profiles. Google uses it for the
  business's search result and map listing.
- **Visitor statistics.** Cloudflare Web Analytics, cookieless, on every public page when
  `himlio.json` has `analytics.cloudflare_token` (set by the platform).
- **Privacy policy.** A rich-text block, Privacy policy (`himlio-privacy`), that renders a
  policy in the site's language from what the site uses: forms, booking (with its retention
  times), Turnstile, analytics, cookies, Cloudflare as processor, the visitor's rights. The
  platform adds the page (`/integritetspolicy` or `/privacy-policy`) as a draft with the block
  in a Text section, unless a page has the block already or the slug is taken. The company
  reads it, adds what else it does around the block and publishes it; it is responsible for
  the text. Outside content: `import { PrivacyPolicy } from '@himlio/site/site'`.

- **News.** The `posts` collection (title, excerpt, image, text), with URLs in the site's
  language: `newsPath()`, `postPath(slug)` (`/news/<slug>`, `/nyheter/<slug>`) and the RSS feed
  at `feedPath()`, which the platform serves. The site shows posts in its own design: a News
  section and a post page (the starter has both).

EmDash itself handles the favicon (Settings → General), the default share image for social
media (Settings → SEO), redirects, `sitemap.xml` and `robots.txt`.

## Extension points

This table is the whole public API. A breaking change to it is a major version.

| Need                               | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Own integrations and Astro options | `defineHimlioConfig({ integrations, vite, image, ... })`. The platform's adapter, output, session, site URL and dev port win.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Own middleware                     | `src/middleware.ts` (plain Astro). The platform's middleware is registered by `defineHimlioConfig()` and runs first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Own scheduled work                 | `defineHimlioConfig({ himlio: { crons: { '0 3 * * *': './src/cron/nightly.ts' } } })`. The module's default export is `(controller, env, ctx) => void \| Promise<void>`. At most 2; UTC; only `*`, numbers, `a-b`, `*/n`, `a,b`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Own content model                  | `himlio: { modelMigrations: 'src/model-migrations' }`: `NNNN_name.json`, partial EmDash seeds (`blockTypes`, `collections`, `content`). Applied once per site, in the background after the first request after a deploy, in EmDash's "skip" mode: what exists is kept; new block types, collections, entries, and new fields on existing collections are created. A field's type can't be changed this way (EmDash forbids e.g. `portableText` → `blocks`). `relabel: [{ collection, field?, label: ["from", "to"] }]` renames a collection (`label`, `labelSingular`, `description`) or field (`label`) while it still has the old label. `allowBlockTypes: [{ collection, field, add: ["block_type"] }]` adds block types to a blocks field's allowed list (a new section type on `pages.content`); it only adds. `addBlockFields: [{ blockType, fields: [...] }]` adds optional fields to an existing block type, e.g. a `layout` select for a design variant ([docs/design.md](docs/design.md)); fields it has already are kept. A collection's `urlPattern` may be given per language, `{ "en": "/news/{slug}", "sv": "/nyheter/{slug}" }`: the site's `locale` picks one (`en` when its language has none), so URLs are in the site's language. Append-only. |
| Own Durable Objects                | `himlio: { durableObjects: [{ binding: 'COUNTER', className: 'Counter' }] }`, and `src/worker.ts` that exports the class and re-exports the platform Worker: `export { default, EmDashRoom, EmDashRoomSite, PluginBridge } from '@himlio/site/worker';`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Own D1 tables                      | `migrations/0100_name.sql` and up (0001–0099 are the platform's). Merged into the build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Own API routes                     | `src/pages/api/*.ts` (plain Astro). Decide about access for each.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Own vars                           | `himlio: { vars: { NAME: 'value' } }`. Plain text, not secrets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Reserved binding names: `DB`, `MEDIA`, `EMAIL`, `HIMLIO_SLUG`, `ASSETS`, `EMDASH_ROOMS`, `TURNSTILE_SECRET`.

## `himlio-site` command

| Command                                            | What                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `himlio-site dev`                                  | Apply D1 migrations to the local database, then `astro dev`.                                                                                                                                                                          |
| `himlio-site build`                                | `astro build`, then the `himlio-build/` artifact the platform releases ([docs/build-artifact.md](docs/build-artifact.md)).                                                                                                            |
| `himlio-site fixtures [--empty]`                   | Sample content on the local dev server, or the empty state, and the block gallery `/block-gallery` (every section type with all fields, only the required ones, and each select option). Refuses servers that aren't this checkout's. |
| `himlio-site screenshots [--out dir] [/path ...]`  | Full-page screenshots in light, dark and mobile. Scrolls through each page first, so scroll effects show.                                                                                                                             |
| `himlio-site install-browsers`, `himlio-site port` | For CI.                                                                                                                                                                                                                               |

CI: a site's `.github/workflows/ci.yml` calls the reusable workflow
`Walter-Co-AB/himlio-site/.github/workflows/build.yml@vX.Y.Z` (same version as the package).

## AI connectors (MCP)

Connectors authorised over OAuth (Claude's custom connector, the EmDash CLI) may get every scope
but `admin` (users, roles, plugin installs) and `transfer:*` (exporting the whole site):
`content:read/write`, `media:read/write`, `taxonomies:manage`, `menus:manage`,
`schema:read/write`, `settings:read/manage`, `mcp:tools` and `mcp:tools:<plugin>`. What a token
can do is still capped by the signing-in user's role. The Worker rewrites the requested scopes,
and enforces:

- **Settings**: everything but the site URL (passkeys and the connector itself depend on it): a
  write with `url`, over MCP (`settings_update`) or REST, is refused. Title, tagline, logo,
  staging/noindex, SEO and social are the customer's. The 404 log (visitor IP addresses) and the
  settings sub-routes (email, domain, backups) stay closed to connector tokens.
- **Schema**: `schema:write` can create, change and **delete** collections and fields, and
  deleting a field or collection deletes its content. There is no undo in EmDash; the recovery
  path is D1 Time Travel (ask Walter & Co, within 30 days). Model migrations don't fight such
  changes: each runs once per site, in skip mode, so a field or collection a connector removed
  later is not recreated, and `relabel` only changes a label that still has its old value.
- **Forms** (MCP tools of the Forms plugin, scope `mcp:tools:emdash-forms` or `mcp:tools`; the
  platform keeps them turned on): `emdash-forms__list_forms`, `__create_form` and `__update_form`
  (fields, labels, button, confirmation message, retention, status; admins only, like the form
  builder), `__list_submissions` (per form, paged) and `__get_submission` (editors and up). The
  forms rules above apply; recipients, webhook and autoresponder can't be set; nothing deletes
  or exports. Submissions are personal data, and the instructions say so.
- **Booking** (scope `mcp:tools:himlio-booking` or `mcp:tools`; turned on by the platform):
  `himlio-booking__list_services`, `__save_service`, `__delete_service`, `__list_resources`,
  `__save_resource`, `__delete_resource`, `__get_schedule`, `__update_schedule`,
  `__list_blocked_time`, `__block_time`, `__unblock_time` (writes: admins), `__list_bookings`,
  `__get_booking` (editors and up), `__approve_booking`, `__decline_booking` and
  `__cancel_booking` (admins). The notification addresses, calendar addresses and feed
  addresses can't be read or set by connectors.

On connect, connectors receive instructions, among them: **when changing a published item with
`content_update`, pass `status: "published"` (or call `content_publish`)**, or the change may
stay a draft and not show on the site.

## Licence

MIT. The licence covers the code, not the Himlio name or logo.
