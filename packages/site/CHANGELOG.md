# Changelog

What changed in each version of `@himlio/site`, and under "Sites" what a site needs to do when
it updates (see "Updating `@himlio/site`" in `docs/site-agents.md`). **Required** steps must be
done with the update; **Optional** ones are up to the site, usually because they concern code
the site owns (copied from the starter once). Starter changes are listed so a site can pick them
up; they never reach a site by themselves.

Format, which tools parse (the platform's upgrade pull requests): one `## X.Y.Z` heading per
version, newest first, each with a `### Sites` subsection.

## 1.15.0

- A built-in site plugin (`himlio-site`) for what every site needs:
  - business info for search engines (schema.org JSON-LD) on the home page, from the site
    settings, Company details and social links;
  - Cloudflare Web Analytics (cookieless) when `himlio.json` has `analytics.cloudflare_token`;
  - the Privacy policy block (`himlio-privacy`): a policy in the site's language, generated
    from what the site uses (forms, booking, Turnstile, analytics).
- Platform migration 0004: Company details get a Business type, and the site gets the privacy
  policy page as a draft (`/integritetspolicy` or `/privacy-policy`) unless it has one.
- `socialLinks()` and `privacyPolicyPath()` in `@himlio/site/runtime`.
- Fixtures publish the privacy page and set placeholder social links; screenshots include the
  privacy page.
- Site rules: where social links, favicon, share image, privacy policy and statistics live; a
  new version can take a few minutes to reach npm.
- Starter: the footer shows the social links (Settings → Social) and links to the privacy
  policy once it is published; `/favicon.svg` until a favicon is set in Settings.

### Sites

- Required: read the draft privacy policy page with the company, add what else the company
  does with personal data around the block, and publish it. If the site already has its own
  policy page, the platform added no draft: add the Privacy policy block to it or keep it as
  it is.
- Optional: in the footer, show the social links and link to the privacy policy, as in the
  starter (`Base.astro`: `socialLinksFrom(settings.social)`, `privacyPolicyPath()`;
  `Footer.astro`; `strings.ts`: `followUs`, `privacyPolicy`). In `emdash-env.d.ts`, add
  `business_type` to `Company`.
- Optional, in the admin: Company details → Business type; Settings → Social; Settings →
  General → Favicon; Settings → SEO → default share image.

## 1.14.1

- The changelog's format is fixed for tools: `## X.Y.Z` per version with a `### Sites`
  subsection.

### Sites

Nothing.

## 1.14.0

- The rules for working on a site ship in the package: `docs/site-agents.md`. The starter's
  `AGENTS.md` imports them and keeps only notes about the site itself.
- This changelog, with what sites need to do per version.

### Sites

- Required: replace the rules in `AGENTS.md` with the import, keeping anything that is only
  about this site under "This site":

  ```md
  # AGENTS.md

  This site runs on Himlio, the website platform from Walter & Co AB. The rules for working on it
  ship with the platform package and update with it:

  @node_modules/@himlio/site/docs/site-agents.md

  If your tool doesn't follow `@` imports, read `node_modules/@himlio/site/docs/site-agents.md`
  first (it is there after `npm install`), and `node_modules/@himlio/site/docs/design.md` before
  any design work.

  ## This site

  - (notes that only apply to this site)
  ```

  `CLAUDE.md` stays `@AGENTS.md`.

## 1.13.0

- Code and names inside the CMS are English; only page URLs and what visitors read are in the
  site's language, `locale` in `himlio.json`. A missing `locale` now means English.
- Booking: everything visitors read (the form, errors, their emails, the link pages) follows
  `locale`, in English or Swedish. The customer's notifications stay English; the calendar
  feed is called "Bookings".
- `localized({ en, sv })` in `@himlio/site/runtime`: interface text by the site's language.
- Model migrations: `renameEntries`. Platform migration 0003 renames the company entry
  `foretagsuppgifter` to `company-details` (and its title while it is still the Swedish one).
- Fixtures: sample content in the site's language, English internal names (form `sample-form`).
- The build workflow's `screenshot-pages` defaults to the CLI's defaults (home, about, contact
  in the site's language, the block gallery, a missing page).
- Starter: written in English; interface text from `src/utils/strings.ts` (`en`, `sv`).

### Sites

- Required: anything in the site that names the entry `foretagsuppgifter` (docs, scripts) now
  says `company-details`. `contactDetails()` finds the entry either way.
- Optional: move interface text written into markup ("Meny", "Hoppa till innehållet", the 404
  page) to `src/utils/strings.ts` with `localized()`, as in the starter; make editor-only
  hints English.

## 1.12.1

- The block gallery is `/block-gallery`, with English titles and labels.

### Sites

Nothing.

## 1.12.0

- Design guide: `docs/design.md`.
- Model migrations: `addBlockFields` adds optional fields to an existing block type (a design
  variant such as a `layout` select), on new and deployed sites.
- Fixtures: the block gallery, every section type with all fields, only the required ones and
  each select option; screenshots include it.
- Starter: `Base.astro` split into `Header.astro`, `Footer.astro` and `src/styles/global.css`;
  Hero `layout` (`standard`, `cover`) with migration `0003_hero_layout`; headings hyphenate long
  words; a long pricing badge wraps.

### Sites

- Optional: in `global.css` (or the site's heading styles), `hyphens: auto` and
  `overflow-wrap: anywhere` on `h1`–`h6`; in `Pricing.astro`, let `.plan__badge` wrap (no
  `white-space: nowrap`, `min-height` instead of `height`). Check with the block gallery.

## 1.11.0

- Booking for salons, tattoo studios and the like: staff and resources, prices, request mode,
  questions, cancellation deadline, rebooking, Turnstile one-step booking.

### Sites

Nothing. Turnstile turns on when the platform sets its keys.

## 1.10.0

- Visitors' booking emails get Reply-To from `himlio.json` `email.reply_to`.

### Sites

Nothing.

## 1.9.0

- Booking (`himlio-booking`): services, opening hours, email confirmation, calendars.
- Starter: a Booking section (`marketing_booking`, `BookingSection.astro`, migration
  `0002_booking_section`).

### Sites

- Optional: to place booking in its own section, copy `BookingSection.astro`, its registration
  in `blocks/index.ts` and `MarketingBlocks.astro`, the migration and the seed entry from the
  starter. Without it, booking can be placed as a Booking block in a Text section.

## Earlier versions

Versions 1.8.0 and earlier: see the git history of `Walter-Co-AB/himlio-site`.
