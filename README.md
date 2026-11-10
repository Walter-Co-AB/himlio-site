# Walter & Co site template

Starter for customer websites hosted by Walter & Co: Astro + Sveltia CMS on Cloudflare Pages.
New customer repos are created from this template by the provisioning in the
`infrastructure` repo.

## What onboarding fills in

Two files hold everything that differs between customers:

**`site.config.json`** (infrastructure-owned, not editable in the CMS)

| Key            | Example                                           | Used for                                        |
| -------------- | ------------------------------------------------- | ----------------------------------------------- |
| `slug`         | `"acme"`                                          | Identifier                                      |
| `pagesProject` | `"acme"`                                          | Preview URLs `<branch>.<project>.pages.dev`     |
| `domain`       | `"acme.se"` or `null`                             | Production URL (`null` → `<project>.pages.dev`) |
| `repo`         | `"Walter-Co-AB/acme"`                             | CMS backend                                     |
| `branch`       | `"main"`                                          | Production branch                               |
| `cmsAuthUrl`   | `"https://sveltia-cms-auth.walterco.workers.dev"` | CMS GitHub login                                |
| `locale`       | `"sv"`                                            | `<html lang>`                                   |

**`src/content/settings/site.json`** (initial values; the customer edits them in the CMS)

`name`, `description`, optional `email`, `phone`, `address`, `orgNumber`, and
`colors.primary`, `colors.background`, `colors.text` as `#rrggbb`.

## How it works

- `src/lib/site-url.mjs` picks the site URL from `CF_PAGES_BRANCH`: the production URL on the
  production branch, the branch alias on previews. Previews get `noindex` and a blocking
  `robots.txt`.
- `/admin/config.yml` is generated at build time from `site.config.json` and
  `cms/config.yml`. On a preview the CMS commits to that preview's branch.
- `npm run check:cms` checks that `cms/config.yml` and `src/schemas.ts` agree, and validates
  the content.

See [AGENTS.md](AGENTS.md) for the rules that apply to changes.
