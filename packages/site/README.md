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

## Booking (Bokning)

Every site has Himlio's booking plugin (`himlio-booking`): visitors book a time for a service,
in Swedish, without a separate booking service.

- **Setup**: services (name, length, buffer after each booking), opening hours per weekday,
  dates with other hours or closed, step between start times, minimum notice and how far ahead
  people can book, and blocked time. Times are Europe/Stockholm, across daylight saving changes.
  Lengths, buffers and times are on whole 5 minutes.
- **Booking**: the visitor picks a time and gets an email with a link; the booking counts once
  they confirm it (within 30 minutes, or later if the time is still free). Then the visitor gets
  a confirmation with an .ics file and a cancel link, and the customer a notification with an
  .ics file. Reminders go out a day before (not for bookings made less than 36 hours ahead).
  Visitors can cancel until the start. The links open a page at `/_booking` (rendered by the
  platform middleware; a GET only shows the booking, the button confirms or cancels).
- **No double bookings**: every 5 minutes a booking keeps busy (length and buffer) is stored once,
  create-if-absent, so of two overlapping bookings only one is made.
- **Calendars**: a secret iCal feed of the bookings to subscribe to in any calendar app, and the
  customer's own calendar's secret iCal address in: read every 5 minutes, only busy times are kept
  (never what the events are), recurring events included, events marked free ignored.
- **Notifications** go to the addresses set in the booking settings, or else `himlio.json`
  `forms.notify`. Emails are sent through the platform's `EMAIL` binding with the .ics attached;
  without `email.from` in `himlio.json` they are written to the log.
- **Abuse protection**: a honeypot, at most 5 bookings per IP address an hour, 5 per email
  address a day, 3 upcoming per email address, 30 unconfirmed per site an hour. The first email
  (to an unproven address) contains nothing the visitor typed.
- **Personal data**: bookings are deleted 12 months after the appointment; unconfirmed and
  cancelled-before-confirmation ones after 30 days. Blocked time is deleted a year after it ends.
- Maintenance (expiring unconfirmed bookings, reminders, deletion, reading the calendar) runs on
  the platform's minute cron, every 5 minutes.

## Extension points

This table is the whole public API. A breaking change to it is a major version.

| Need                               | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Own integrations and Astro options | `defineHimlioConfig({ integrations, vite, image, ... })`. The platform's adapter, output, session, site URL and dev port win.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Own middleware                     | `src/middleware.ts` (plain Astro). The platform's middleware is registered by `defineHimlioConfig()` and runs first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Own scheduled work                 | `defineHimlioConfig({ himlio: { crons: { '0 3 * * *': './src/cron/nightly.ts' } } })`. The module's default export is `(controller, env, ctx) => void \| Promise<void>`. At most 2; UTC; only `*`, numbers, `a-b`, `*/n`, `a,b`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Own content model                  | `himlio: { modelMigrations: 'src/model-migrations' }`: `NNNN_name.json`, partial EmDash seeds (`blockTypes`, `collections`, `content`). Applied once per site, in the background after the first request after a deploy, in EmDash's "skip" mode: what exists is kept; new block types, collections, entries, and new fields on existing collections are created. A field's type can't be changed this way (EmDash forbids e.g. `portableText` → `blocks`). `relabel: [{ collection, field?, label: ["from", "to"] }]` renames a collection (`label`, `labelSingular`, `description`) or field (`label`) while it still has the old label. `allowBlockTypes: [{ collection, field, add: ["block_type"] }]` adds block types to a blocks field's allowed list (a new section type on `pages.content`); it only adds. Append-only. |
| Own Durable Objects                | `himlio: { durableObjects: [{ binding: 'COUNTER', className: 'Counter' }] }`, and `src/worker.ts` that exports the class and re-exports the platform Worker: `export { default, EmDashRoom, EmDashRoomSite, PluginBridge } from '@himlio/site/worker';`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Own D1 tables                      | `migrations/0100_name.sql` and up (0001–0099 are the platform's). Merged into the build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Own API routes                     | `src/pages/api/*.ts` (plain Astro). Decide about access for each.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Own vars                           | `himlio: { vars: { NAME: 'value' } }`. Plain text, not secrets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

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
  `himlio-booking__list_services`, `__save_service`, `__delete_service`, `__get_schedule`,
  `__update_schedule`, `__list_blocked_time`, `__block_time`, `__unblock_time` (writes: admins),
  `__list_bookings`, `__get_booking` (editors and up) and `__cancel_booking` (admins). The
  notification addresses, the customer's calendar address and the feed address can't be read or
  set by connectors.

On connect, connectors receive instructions, among them: **when changing a published item with
`content_update`, pass `status: "published"` (or call `content_publish`)**, or the change may
stay a draft and not show on the site.

## Licence

MIT. The licence covers the code, not the Himlio name or logo.
