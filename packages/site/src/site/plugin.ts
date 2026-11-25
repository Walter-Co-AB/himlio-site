// The Himlio site plugin as EmDash loads it (entrypoint of the descriptor in ../site-plugin.ts):
// what every site gets from the platform without code of its own.
//   - The business info for search engines (schema.org JSON-LD) on the home page, from the site
//     settings, Company details and social links (./business.ts).
//   - Cloudflare Web Analytics on every public page, when himlio.json has a token.
//   - Form validation messages in the site's language (./validation.ts), on every public page.
//   - The Privacy policy block for rich text (./privacy.ts, rendered by ./astro).
import { definePlugin, getEmDashCollection, getSiteSettings } from 'emdash';
import type { PageFragmentContribution, PageMetadataContribution, PublicPageContext } from 'emdash';
import { facts } from 'virtual:himlio/config';
import { contactDetails } from '../runtime/contact.js';
import { socialLinksFrom } from '../runtime/social.js';
import { businessJsonLd } from './business.js';
import { validationScript } from './validation.js';

export const SITE_PLUGIN_ID = 'himlio-site';
export const SITE_PLUGIN_VERSION = '1.0.0';
export const PRIVACY_BLOCK = 'himlio-privacy';
export const ANALYTICS_BEACON = 'https://static.cloudflareinsights.com/beacon.min.js';

function origin(page: PublicPageContext, siteUrl?: string): string {
  if (facts.url) return facts.url.replace(/\/$/, '');
  if (siteUrl) return siteUrl.replace(/\/$/, '');
  if (page.siteUrl) return page.siteUrl.replace(/\/$/, '');
  try {
    return new URL(page.url).origin;
  } catch {
    return '';
  }
}

async function businessType(): Promise<string | undefined> {
  const { entries } = await getEmDashCollection('company', {
    limit: 1,
    orderBy: { updated_at: 'desc' },
  });
  const value = entries[0]?.data.business_type;
  return typeof value === 'string' ? value : undefined;
}

async function businessInfo(page: PublicPageContext): Promise<PageMetadataContribution | null> {
  if (page.path !== '/') return null;
  const [settings, details, type] = await Promise.all([
    getSiteSettings(),
    contactDetails(),
    businessType().catch(() => undefined),
  ]);
  const url = origin(page, settings.url);
  const logo = settings.logo?.url;
  const graph = businessJsonLd({
    name: settings.title?.trim() || facts.name,
    url,
    description: settings.tagline?.trim() || undefined,
    logo: logo ? new URL(logo, `${url}/`).href : undefined,
    type,
    details,
    social: socialLinksFrom(settings.social),
  });
  return graph ? { kind: 'jsonld', id: 'himlio-business', graph } : null;
}

const VALIDATION_SCRIPT = validationScript(facts.locale);

function analytics(): PageFragmentContribution | null {
  const token = facts.analytics?.cloudflareToken;
  if (!token) return null;
  return {
    kind: 'external-script',
    placement: 'body:end',
    src: ANALYTICS_BEACON,
    defer: true,
    attributes: { 'data-cf-beacon': JSON.stringify({ token }) },
    key: 'himlio-analytics',
  };
}

export function createPlugin() {
  return definePlugin({
    id: SITE_PLUGIN_ID,
    version: SITE_PLUGIN_VERSION,
    capabilities: ['hooks.page-fragments:register'],
    hooks: {
      'page:metadata': async (event) => {
        try {
          return await businessInfo(event.page);
        } catch (error) {
          console.error('[himlio] business info:', error);
          return null;
        }
      },
      'page:fragments': () => [
        ...(analytics() ? [analytics()!] : []),
        {
          kind: 'inline-script',
          placement: 'body:end',
          code: VALIDATION_SCRIPT,
          key: 'himlio-validation',
        },
      ],
    },
    admin: {
      portableTextBlocks: [
        {
          type: PRIVACY_BLOCK,
          label: 'Privacy policy',
          icon: 'shield',
          description:
            "The platform's privacy policy text, generated from the features the site uses (forms, booking, analytics). Add what else the company does around it; the company is responsible for the whole page.",
          fields: [],
        },
      ],
    },
  });
}

export default createPlugin;
