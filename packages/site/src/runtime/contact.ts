// The company's contact details, edited in the admin: the single entry in the
// "Företagsuppgifter" collection (slug `company`, created by seed/seed.json). Connectors can
// update it over MCP with content:write.
//
// Missing or empty fields are left out, and so is everything when the collection or its entry
// doesn't exist (sites set up before it was added). If there is more than one entry, the most
// recently updated one is used.
import { getEmDashCollection } from 'emdash';

export interface ContactDetails {
  phone?: string;
  email?: string;
  address?: string;
  org_number?: string;
  opening_hours?: string;
}

const FIELDS = ['phone', 'email', 'address', 'org_number', 'opening_hours'] as const;

type CacheHint = Awaited<ReturnType<typeof getEmDashCollection>>['cacheHint'];

/**
 * Pass `Astro.cache` so cached pages are purged when the details change.
 */
export async function contactDetails(cache?: {
  enabled?: boolean;
  set(hint: CacheHint): void;
}): Promise<ContactDetails> {
  const { entries, cacheHint, error } = await getEmDashCollection('company', {
    limit: 1,
    orderBy: { updated_at: 'desc' },
  });
  if (cache?.enabled && cacheHint) cache.set(cacheHint);
  if (error || !entries[0]) return {};

  const data = entries[0].data;
  const details: ContactDetails = {};
  for (const field of FIELDS) {
    const value = data[field];
    if (typeof value === 'string' && value.trim()) details[field] = value.trim();
  }
  return details;
}

export const hasContactDetails = (details: ContactDetails) => Object.keys(details).length > 0;

/** A phone number as a tel: link, e.g. "08-123 456 78" → "tel:0812345678". */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
