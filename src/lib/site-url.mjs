// Works out the site URL at build time. Plain .mjs so astro.config.mjs can import it.
//
// Production (branch = site.config.json "branch"): https://<domain>, or the pages.dev
// address while no domain is set. Preview branches: the Cloudflare Pages branch alias,
// https://<branch>.<project>.pages.dev, so canonical links, sitemap and the CMS point at
// the preview and not at production.
import config from '../../site.config.json' with { type: 'json' };

// Cloudflare Pages turns a branch name into a subdomain label: lowercase,
// anything other than a-z/0-9 becomes "-", at most 28 characters.
export function branchAlias(branch) {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 28)
    .replace(/^-+|-+$/g, '');
}

const pagesBranch = process.env.CF_PAGES_BRANCH;

export const isPreview = Boolean(pagesBranch) && pagesBranch !== config.branch;

/** The git branch this build comes from (the production branch outside Pages). */
export const buildBranch = pagesBranch || config.branch;

export const productionUrl = config.domain
  ? `https://${config.domain}`
  : `https://${config.pagesProject}.pages.dev`;

export const siteUrl = isPreview
  ? `https://${branchAlias(pagesBranch)}.${config.pagesProject}.pages.dev`
  : productionUrl;
