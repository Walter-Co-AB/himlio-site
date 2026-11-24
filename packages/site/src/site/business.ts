// The business info search engines read (schema.org JSON-LD): name, address, phone, email,
// logo and social profiles, from the site settings and Company details. Google uses it for the
// business's search result and map listing. Pure functions; the plugin (./plugin.ts) adds it to
// the home page.
import type { ContactDetails } from '../runtime/contact.js';
import type { SocialLink } from '../runtime/social.js';

/** The schema.org types the Company details' "Business type" offers. */
export const BUSINESS_TYPES = [
  'LocalBusiness',
  'HairSalon',
  'BeautySalon',
  'NailSalon',
  'DaySpa',
  'TattooParlor',
  'HealthAndBeautyBusiness',
  'ProfessionalService',
  'Restaurant',
  'CafeOrCoffeeShop',
  'Store',
  'AutoRepair',
  'HomeAndConstructionBusiness',
  'MedicalBusiness',
  'Organization',
] as const;

export interface BusinessInput {
  name: string;
  /** The site's public origin, e.g. "https://walterco.se". */
  url: string;
  description?: string;
  /** An absolute logo URL. */
  logo?: string;
  type?: string;
  details: ContactDetails;
  social: SocialLink[];
}

/** "Exempelgatan 1\n123 45 Stockholm" → a schema.org PostalAddress (Swedish postcodes parsed). */
export function postalAddress(address: string): Record<string, string> | undefined {
  const lines = address
    .split(/\n|,/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  const result: Record<string, string> = { '@type': 'PostalAddress' };
  const last = lines[lines.length - 1].match(/^(?:SE-?\s*)?(\d{3}\s?\d{2})\s+(\p{L}[\p{L} .-]*)$/u);
  if (last && lines.length > 1) {
    const [, code, city] = last;
    result.streetAddress = lines.slice(0, -1).join(', ');
    result.postalCode = code.replace(/^(\d{3})(\d{2})$/, '$1 $2');
    result.addressLocality = city.trim();
    result.addressCountry = 'SE';
  } else {
    result.streetAddress = lines.join(', ');
  }
  return result;
}

/** The JSON-LD graph for the business, or null without a name or URL. */
export function businessJsonLd(input: BusinessInput): Record<string, unknown> | null {
  const name = input.name.trim();
  if (!name || !input.url) return null;
  const url = input.url.replace(/\/$/, '');
  const type = (BUSINESS_TYPES as readonly string[]).includes(input.type ?? '')
    ? input.type!
    : 'LocalBusiness';
  const { details } = input;
  const graph: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': type,
    '@id': `${url}/#business`,
    name,
    url: `${url}/`,
  };
  if (input.description) graph.description = input.description;
  if (input.logo) {
    graph.logo = input.logo;
    graph.image = input.logo;
  }
  if (details.phone) graph.telephone = details.phone;
  if (details.email) graph.email = details.email;
  const address = details.address ? postalAddress(details.address) : undefined;
  if (address) graph.address = address;
  if (input.social.length) graph.sameAs = input.social.map((s) => s.url);
  return graph;
}
