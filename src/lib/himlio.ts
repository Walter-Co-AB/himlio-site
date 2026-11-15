// himlio.json is written by the Himlio platform (Terraform) and rewritten on every apply.
// Read it; never edit it from the site.
import data from '../../himlio.json';

export interface Contact {
  email?: string;
  phone?: string;
  address?: string;
  org_number?: string;
}

export interface Himlio {
  slug: string;
  name: string;
  /** Starting value only; use siteDescription() from ./site-description, which prefers the admin. */
  description?: string;
  locale: string;
  url?: string | null;
  contact: Contact;
  /** Set by the platform when the EMAIL binding is available. */
  email?: { from: string };
}

const raw = data as Partial<Himlio>;

export const himlio: Himlio = {
  slug: raw.slug ?? '',
  name: raw.name ?? '',
  description: raw.description || undefined,
  locale: raw.locale || 'sv',
  url: raw.url ?? null,
  contact: raw.contact ?? {},
  email: raw.email?.from ? { from: raw.email.from } : undefined,
};

/** A phone number as a tel: link, e.g. "08-123 456 78" → "tel:0812345678". */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
